import { ApplicationCommandOptionTypes, TextStyles } from "@discordeno/bot";
import { registerCommand, registerModalHandler, respond, respondWithModal } from "./index";
import type { CommandContext } from "./index";
import {
  addMute,
  removeMute,
  listActiveMutes,
  recordModEvent,
  getModEvents,
  type MuteScopeType,
  type GetModEventsFilter,
} from "../../db/moderation";
import { setDiscordConfig } from "../../db/discord";
import { getEntityByName } from "../../db/entities";
import { debug } from "../../logger";

// =============================================================================
// Permission helpers
// =============================================================================

function hasPerm(ctx: CommandContext, perm: string): boolean {
  const perms = ctx.interaction.member?.permissions;
  if (!perms) return false;
  return (perms as { has(p: string): boolean }).has(perm) ||
    (perms as { has(p: string): boolean }).has("ADMINISTRATOR");
}

function hasManageMessages(ctx: CommandContext) { return hasPerm(ctx, "MANAGE_MESSAGES"); }
function hasManageChannels(ctx: CommandContext) { return hasPerm(ctx, "MANAGE_CHANNELS"); }
function hasManageWebhooks(ctx: CommandContext) { return hasPerm(ctx, "MANAGE_WEBHOOKS"); }

/** Ephemeral permission-denied reply */
async function denyPerm(ctx: CommandContext, perm: string): Promise<void> {
  await respond(ctx.bot, ctx.interaction, `Missing required permission: **${perm}**`, true);
}

// =============================================================================
// Duration parsing
// =============================================================================

const DURATION_PATTERNS: Record<string, number> = {
  "10m": 10 * 60 * 1000,
  "1h":  60 * 60 * 1000,
  "1d":  24 * 60 * 60 * 1000,
};

/** Parse a duration string to an expires_at timestamp (SQLite CURRENT_TIMESTAMP format) or null for "forever". */
export function parseDuration(s: string): string | null {
  if (s === "forever" || !s) return null;
  const ms = DURATION_PATTERNS[s];
  if (!ms) return null;
  const d = new Date(Date.now() + ms);
  // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS"
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// =============================================================================
// Subcommand option parsing helper
// =============================================================================

interface AdminOptions {
  group: string;
  sub: string;
  opts: Record<string, unknown>;
}

/** Extract subcommand group, subcommand, and leaf options from an /admin interaction. */
export function parseAdminOptions(interactionDataOptions: unknown[]): AdminOptions | null {
  if (!interactionDataOptions || interactionDataOptions.length === 0) return null;
  const first = interactionDataOptions[0] as { type: number; name: string; options?: unknown[] };

  if (first.type === ApplicationCommandOptionTypes.SubCommandGroup) {
    // /admin <group> <sub> [opts...]
    const groupName = first.name;
    const subOptions = first.options ?? [];
    if (subOptions.length === 0) return null;
    const sub = subOptions[0] as { type: number; name: string; options?: unknown[] };
    const leafOpts = sub.options ?? [];
    const opts: Record<string, unknown> = {};
    for (const o of leafOpts as Array<{ name: string; value: unknown }>) {
      opts[o.name] = o.value;
    }
    return { group: groupName, sub: sub.name, opts };
  }

  if (first.type === ApplicationCommandOptionTypes.SubCommand) {
    // /admin <sub> [opts...] (top-level subcommand, no group)
    const leafOpts = first.options ?? [];
    const opts: Record<string, unknown> = {};
    for (const o of leafOpts as Array<{ name: string; value: unknown }>) {
      opts[o.name] = o.value;
    }
    return { group: "", sub: first.name, opts };
  }

  return null;
}

// =============================================================================
// /admin command
// =============================================================================

registerCommand({
  name: "admin",
  description: "Moderation tools: mutes, kill switches, rate config, and audit log",
  defaultMemberPermissions: "8192", // Manage Messages — tighter checks per subcommand in handler
  noDefer: true, // config rate/chain use modals; other subcommands will defer manually
  options: [
    // ── mute group ──────────────────────────────────────────────────────────
    {
      name: "mute",
      description: "Manage entity mutes",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "create",
          description: "Mute an entity or owner",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "target", description: "Entity name or user ID to mute", type: ApplicationCommandOptionTypes.String, required: true },
            { name: "scope", description: "Mute scope", type: ApplicationCommandOptionTypes.String, required: true, choices: [
              { name: "entity — mute a specific entity", value: "entity" },
              { name: "owner — mute all entities owned by a user", value: "owner" },
              { name: "channel — disable this channel (kill switch)", value: "channel" },
              { name: "server — disable this server (kill switch)", value: "server" },
              { name: "global — disable everywhere (admin only)", value: "global" },
            ] },
            { name: "duration", description: "How long", type: ApplicationCommandOptionTypes.String, required: true, choices: [
              { name: "10 minutes", value: "10m" },
              { name: "1 hour", value: "1h" },
              { name: "1 day", value: "1d" },
              { name: "Permanent", value: "forever" },
            ] },
            { name: "reason", description: "Reason (optional)", type: ApplicationCommandOptionTypes.String, required: false },
          ],
        },
        {
          name: "list",
          description: "List active mutes",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "scope", description: "Filter by scope type", type: ApplicationCommandOptionTypes.String, required: false, choices: [
              { name: "entity", value: "entity" },
              { name: "owner", value: "owner" },
              { name: "channel", value: "channel" },
              { name: "server", value: "server" },
            ] },
            { name: "target", description: "Filter by entity name or user ID", type: ApplicationCommandOptionTypes.String, required: false },
          ],
        },
        {
          name: "remove",
          description: "Remove a mute by ID",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "id", description: "Mute ID (from /admin mute list)", type: ApplicationCommandOptionTypes.Integer, required: true },
          ],
        },
        {
          name: "clear",
          description: "Remove the latest matching mute for a target",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "target", description: "Entity name or user ID", type: ApplicationCommandOptionTypes.String, required: true },
            { name: "scope", description: "Scope type to clear", type: ApplicationCommandOptionTypes.String, required: false, choices: [
              { name: "entity", value: "entity" },
              { name: "owner", value: "owner" },
            ] },
          ],
        },
      ],
    },
    // ── disable group ────────────────────────────────────────────────────────
    {
      name: "disable",
      description: "Disable entity responses in a channel or server",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "channel",
          description: "Disable all entity responses in this channel",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "reason", description: "Reason (optional)", type: ApplicationCommandOptionTypes.String, required: false },
          ],
        },
        {
          name: "server",
          description: "Disable all entity responses server-wide",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "reason", description: "Reason (optional)", type: ApplicationCommandOptionTypes.String, required: false },
          ],
        },
      ],
    },
    // ── enable group ─────────────────────────────────────────────────────────
    {
      name: "enable",
      description: "Re-enable entity responses in a channel or server",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "channel",
          description: "Re-enable entity responses in this channel",
          type: ApplicationCommandOptionTypes.SubCommand,
        },
        {
          name: "server",
          description: "Re-enable entity responses server-wide",
          type: ApplicationCommandOptionTypes.SubCommand,
        },
      ],
    },
    // ── config group ─────────────────────────────────────────────────────────
    {
      name: "config",
      description: "Configure rate limits and chain limits",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "rate",
          description: "Set per-channel and per-owner rate limits (msg/min)",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "scope", description: "Apply to channel or server", type: ApplicationCommandOptionTypes.String, required: true, choices: [
              { name: "channel", value: "channel" },
              { name: "server", value: "server" },
            ] },
          ],
        },
        {
          name: "chain",
          description: "Set the maximum response chain depth",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            { name: "scope", description: "Apply to channel or server", type: ApplicationCommandOptionTypes.String, required: true, choices: [
              { name: "channel", value: "channel" },
              { name: "server", value: "server" },
            ] },
          ],
        },
      ],
    },
    // ── audit (top-level subcommand) ─────────────────────────────────────────
    {
      name: "audit",
      description: "View recent moderation events",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        { name: "filter", description: "Event type filter", type: ApplicationCommandOptionTypes.String, required: false, choices: [
          { name: "rate limits", value: "rate_limited" },
          { name: "mutes", value: "muted" },
          { name: "config changes", value: "config_changed" },
          { name: "all", value: "all" },
        ] },
        { name: "target", description: "Filter by entity name or user ID", type: ApplicationCommandOptionTypes.String, required: false },
        { name: "hours", description: "How many hours back (default 24)", type: ApplicationCommandOptionTypes.Integer, required: false },
      ],
    },
  ],

  async handler(ctx, _options) {
    const parsed = parseAdminOptions(ctx.interaction.data?.options as unknown[] ?? []);
    if (!parsed) {
      await respond(ctx.bot, ctx.interaction, "Unknown subcommand.", true);
      return;
    }

    const { group, sub, opts } = parsed;

    // ── mute subcommands ───────────────────────────────────────────────────
    if (group === "mute") {
      if (!hasManageMessages(ctx)) {
        await denyPerm(ctx, "Manage Messages");
        return;
      }

      // Defer (mute commands respond with text, not modal)
      await ctx.bot.helpers.sendInteractionResponse(ctx.interaction.id, ctx.interaction.token, {
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
        data: { flags: 64 },
      });

      if (sub === "create") {
        const target = opts.target as string;
        const scope = opts.scope as string;
        const duration = opts.duration as string;
        const reason = opts.reason as string | undefined;

        // Extra permission checks for broader scopes
        if (scope === "server" || scope === "global") {
          if (!hasManageWebhooks(ctx)) {
            await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
              content: "Missing required permission: **Manage Webhooks** (server/global scope requires this)",
            });
            return;
          }
        }
        if (scope === "global" && !hasPerm(ctx, "ADMINISTRATOR")) {
          await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
            content: "Missing required permission: **Administrator** (global scope requires this)",
          });
          return;
        }

        const expiresAt = parseDuration(duration);
        let scopeId: string;
        let scopeType: MuteScopeType;
        let guildId: string | null = ctx.guildId ?? null;
        let channelId: string | null = null;

        if (scope === "entity") {
          const entity = getEntityByName(target);
          if (!entity) {
            await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
              content: `Entity "${target}" not found.`,
            });
            return;
          }
          scopeType = "entity";
          scopeId = String(entity.id);
          channelId = ctx.channelId;
        } else if (scope === "owner") {
          scopeType = "owner";
          scopeId = target;
          channelId = ctx.channelId;
        } else if (scope === "channel") {
          scopeType = "channel";
          scopeId = ctx.channelId;
          channelId = ctx.channelId;
        } else if (scope === "server") {
          scopeType = "guild";
          scopeId = ctx.guildId ?? "";
          guildId = ctx.guildId ?? null;
          channelId = null;
        } else {
          // global
          scopeType = "entity"; // Not used - but TypeScript requires it
          scopeType = "owner";
          scopeId = "global";
          guildId = null;
          channelId = null;
        }

        const mute = addMute({
          scope_type: scopeType,
          scope_id: scopeId,
          guild_id: guildId,
          channel_id: channelId,
          expires_at: expiresAt,
          created_by: ctx.userId,
          reason: reason ?? null,
        });

        recordModEvent({
          event_type: "muted",
          actor_id: ctx.userId,
          target_type: scopeType,
          target_id: scopeId,
          channel_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          details: { mute_id: mute.id, scope, target, duration, reason },
        });

        const expiry = expiresAt ? `until ${expiresAt}` : "permanently";
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: `Mute created (ID: ${mute.id}): **${scope}** \`${target}\` muted ${expiry}.${reason ? ` Reason: ${reason}` : ""}`,
        });

      } else if (sub === "list") {
        const scopeFilter = opts.scope as string | undefined;
        const targetFilter = opts.target as string | undefined;

        let filter: Parameters<typeof listActiveMutes>[0] = {};
        if (scopeFilter && scopeFilter !== "server") {
          filter.scope_type = scopeFilter as MuteScopeType;
        } else if (scopeFilter === "server") {
          filter.scope_type = "guild";
        }
        if (targetFilter) {
          // Try to resolve as entity name
          const entity = getEntityByName(targetFilter);
          filter.scope_id = entity ? String(entity.id) : targetFilter;
        }

        const mutes = listActiveMutes(filter);
        if (mutes.length === 0) {
          await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
            content: "No active mutes found.",
          });
          return;
        }

        const lines = mutes.map(m => {
          const expiry = m.expires_at ? `until ${m.expires_at}` : "permanent";
          const reason = m.reason ? ` (${m.reason})` : "";
          return `**[${m.id}]** ${m.scope_type} \`${m.scope_id}\` — ${expiry}, by <@${m.created_by}>${reason}`;
        });

        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: `**Active mutes** (${mutes.length}):\n${lines.slice(0, 20).join("\n")}${mutes.length > 20 ? `\n…and ${mutes.length - 20} more` : ""}`,
        });

      } else if (sub === "remove") {
        const id = opts.id as number;
        const removed = removeMute(id);
        if (!removed) {
          await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
            content: `Mute ID ${id} not found.`,
          });
          return;
        }
        recordModEvent({
          event_type: "unmuted",
          actor_id: ctx.userId,
          channel_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          details: { mute_id: id },
        });
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: `Mute ID ${id} removed.`,
        });

      } else if (sub === "clear") {
        const target = opts.target as string;
        const scopeFilter = opts.scope as MuteScopeType | undefined;

        const entity = getEntityByName(target);
        const scopeId = entity ? String(entity.id) : target;
        const filter: Parameters<typeof listActiveMutes>[0] = { scope_id: scopeId };
        if (scopeFilter) filter.scope_type = scopeFilter;

        const mutes = listActiveMutes(filter);
        if (mutes.length === 0) {
          await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
            content: `No active mute found for "${target}".`,
          });
          return;
        }
        const latest = mutes[0]!;
        removeMute(latest.id);
        recordModEvent({
          event_type: "unmuted",
          actor_id: ctx.userId,
          channel_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          details: { mute_id: latest.id, target },
        });
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: `Removed mute ID ${latest.id} for "${target}".`,
        });
      }

    // ── disable subcommands ────────────────────────────────────────────────
    } else if (group === "disable") {
      if (sub === "channel") {
        if (!hasManageChannels(ctx)) { await denyPerm(ctx, "Manage Channels"); return; }
        await ctx.bot.helpers.sendInteractionResponse(ctx.interaction.id, ctx.interaction.token, {
          type: 5, data: { flags: 64 },
        });
        const reason = opts.reason as string | undefined;
        addMute({
          scope_type: "channel",
          scope_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          channel_id: ctx.channelId,
          expires_at: null,
          created_by: ctx.userId,
          reason: reason ?? null,
        });
        recordModEvent({
          event_type: "channel_disabled",
          actor_id: ctx.userId,
          channel_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          details: { reason },
        });
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: `Channel <#${ctx.channelId}> disabled. No entities will respond here until re-enabled with \`/admin enable channel\`.`,
        });

      } else if (sub === "server") {
        if (!hasManageWebhooks(ctx)) { await denyPerm(ctx, "Manage Webhooks"); return; }
        await ctx.bot.helpers.sendInteractionResponse(ctx.interaction.id, ctx.interaction.token, {
          type: 5, data: { flags: 64 },
        });
        const guildId = ctx.guildId;
        if (!guildId) {
          await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
            content: "This command must be used in a server.",
          });
          return;
        }
        const reason = opts.reason as string | undefined;
        addMute({
          scope_type: "guild",
          scope_id: guildId,
          guild_id: guildId,
          channel_id: null,
          expires_at: null,
          created_by: ctx.userId,
          reason: reason ?? null,
        });
        recordModEvent({
          event_type: "guild_disabled",
          actor_id: ctx.userId,
          guild_id: guildId,
          details: { reason },
        });
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: `Server disabled. No entities will respond anywhere in this server until re-enabled with \`/admin enable server\`.`,
        });
      }

    // ── enable subcommands ─────────────────────────────────────────────────
    } else if (group === "enable") {
      if (sub === "channel") {
        if (!hasManageChannels(ctx)) { await denyPerm(ctx, "Manage Channels"); return; }
        await ctx.bot.helpers.sendInteractionResponse(ctx.interaction.id, ctx.interaction.token, {
          type: 5, data: { flags: 64 },
        });
        const mutes = listActiveMutes({ scope_type: "channel", scope_id: ctx.channelId });
        for (const m of mutes) removeMute(m.id);
        recordModEvent({
          event_type: "channel_enabled",
          actor_id: ctx.userId,
          channel_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          details: { removed: mutes.length },
        });
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: mutes.length > 0
            ? `Channel <#${ctx.channelId}> re-enabled (removed ${mutes.length} mute${mutes.length > 1 ? "s" : ""}).`
            : `Channel <#${ctx.channelId}> was not disabled.`,
        });

      } else if (sub === "server") {
        if (!hasManageWebhooks(ctx)) { await denyPerm(ctx, "Manage Webhooks"); return; }
        await ctx.bot.helpers.sendInteractionResponse(ctx.interaction.id, ctx.interaction.token, {
          type: 5, data: { flags: 64 },
        });
        const guildId = ctx.guildId ?? "";
        const mutes = listActiveMutes({ scope_type: "guild", scope_id: guildId });
        for (const m of mutes) removeMute(m.id);
        recordModEvent({
          event_type: "guild_enabled",
          actor_id: ctx.userId,
          guild_id: guildId,
          details: { removed: mutes.length },
        });
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: mutes.length > 0
            ? `Server re-enabled (removed ${mutes.length} mute${mutes.length > 1 ? "s" : ""}).`
            : `Server was not disabled.`,
        });
      }

    // ── config subcommands ─────────────────────────────────────────────────
    } else if (group === "config") {
      if (!hasManageWebhooks(ctx)) { await denyPerm(ctx, "Manage Webhooks"); return; }
      const scope = opts.scope as "channel" | "server";
      const discordId = scope === "channel" ? ctx.channelId : (ctx.guildId ?? ctx.channelId);
      const discordType = scope === "channel" ? "channel" : "guild";

      if (sub === "rate") {
        const existing = { rateChannel: "" as string, rateOwner: "" as string };
        try {
          const { rateChannel, rateOwner } = await import("../../db/discord").then(m =>
            m.resolveDiscordConfig(
              scope === "channel" ? ctx.channelId : undefined,
              scope === "server" ? ctx.guildId : undefined,
            )
          );
          existing.rateChannel = rateChannel !== null ? String(rateChannel) : "";
          existing.rateOwner = rateOwner !== null ? String(rateOwner) : "";
        } catch { /* no config yet */ }

        await respondWithModal(ctx.bot, ctx.interaction, `admin-rate:${discordId}:${discordType}`, `Rate limits (${scope})`, [
          {
            customId: "rate_channel",
            label: "Max entity responses/min in this " + scope,
            style: TextStyles.Short,
            required: false,
            placeholder: "e.g. 10 — leave blank to remove limit",
            value: existing.rateChannel,
          },
          {
            customId: "rate_owner",
            label: "Max responses/min per owner in this " + scope,
            style: TextStyles.Short,
            required: false,
            placeholder: "e.g. 5 — leave blank to remove limit",
            value: existing.rateOwner,
          },
        ]);

      } else if (sub === "chain") {
        const existing = { chainLimit: "" };
        try {
          const { chainLimit } = await import("../../db/discord").then(m =>
            m.resolveDiscordConfig(
              scope === "channel" ? ctx.channelId : undefined,
              scope === "server" ? ctx.guildId : undefined,
            )
          );
          existing.chainLimit = chainLimit !== null ? String(chainLimit) : "";
        } catch { /* no config yet */ }

        await respondWithModal(ctx.bot, ctx.interaction, `admin-chain:${discordId}:${discordType}`, `Chain limit (${scope})`, [
          {
            customId: "chain_limit",
            label: "Max consecutive entity-to-entity responses",
            style: TextStyles.Short,
            required: false,
            placeholder: "e.g. 3 — 0 = block, blank = inherit/default",
            value: existing.chainLimit,
          },
        ]);
      }

    // ── audit (top-level) ──────────────────────────────────────────────────
    } else if (sub === "audit") {
      if (!hasManageMessages(ctx)) { await denyPerm(ctx, "Manage Messages"); return; }
      await ctx.bot.helpers.sendInteractionResponse(ctx.interaction.id, ctx.interaction.token, {
        type: 5, data: { flags: 64 },
      });

      const filterVal = opts.filter as string | undefined;
      const targetVal = opts.target as string | undefined;
      const hours = (opts.hours as number | undefined) ?? 24;

      const filter: GetModEventsFilter = {
        guild_id: ctx.guildId,
        hours,
        limit: 30,
      };
      if (filterVal && filterVal !== "all") {
        filter.event_type = filterVal as GetModEventsFilter["event_type"];
      }
      if (targetVal) {
        const entity = getEntityByName(targetVal);
        filter.target_id = entity ? String(entity.id) : targetVal;
      }

      const events = getModEvents(filter);
      if (events.length === 0) {
        await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
          content: "No moderation events found.",
        });
        return;
      }

      const lines = events.map(ev => {
        const when = ev.created_at;
        const actor = ev.actor_id ? `<@${ev.actor_id}>` : "system";
        const target = ev.target_id ? ` → ${ev.target_type}:${ev.target_id}` : "";
        return `\`${when}\` **${ev.event_type}** by ${actor}${target}`;
      });

      await ctx.bot.helpers.editOriginalInteractionResponse(ctx.interaction.token, {
        content: `**Audit log** (last ${hours}h, up to 30 events):\n${lines.join("\n")}`,
      });

    } else {
      await respond(ctx.bot, ctx.interaction, "Unknown subcommand.", true);
    }

    debug("admin command handled", { group, sub });
  },
});

// =============================================================================
// Modal handlers
// =============================================================================

registerModalHandler("admin-rate", async (bot, interaction, values) => {
  const parts = interaction.data?.customId?.split(":") ?? [];
  const discordId = parts[1] ?? "";
  const discordType = (parts[2] ?? "channel") as "channel" | "guild";

  const rawChannel = values.rate_channel?.trim() ?? "";
  const rawOwner = values.rate_owner?.trim() ?? "";
  const rateChannel = rawChannel === "" ? null : parseInt(rawChannel, 10);
  const rateOwner = rawOwner === "" ? null : parseInt(rawOwner, 10);

  if ((rawChannel !== "" && isNaN(rateChannel!)) || (rawOwner !== "" && isNaN(rateOwner!))) {
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: "Invalid value — rate limits must be integers.",
    });
    return;
  }

  setDiscordConfig(discordId, discordType, {
    config_rate_channel_per_min: rateChannel,
    config_rate_owner_per_min: rateOwner,
  });

  recordModEvent({
    event_type: "config_changed",
    actor_id: interaction.user?.id?.toString() ?? "",
    target_type: discordType,
    target_id: discordId,
    details: { config: "rate", rateChannel, rateOwner },
  });

  const channelStr = rateChannel !== null ? `${rateChannel}/min` : "unlimited";
  const ownerStr = rateOwner !== null ? `${rateOwner}/min` : "unlimited";
  await bot.helpers.editOriginalInteractionResponse(interaction.token, {
    content: `Rate limits updated for ${discordType} ${discordId}: channel=${channelStr}, owner=${ownerStr}`,
  });
});

registerModalHandler("admin-chain", async (bot, interaction, values) => {
  const parts = interaction.data?.customId?.split(":") ?? [];
  const discordId = parts[1] ?? "";
  const discordType = (parts[2] ?? "channel") as "channel" | "guild";

  const rawChain = values.chain_limit?.trim() ?? "";
  const chainLimit = rawChain === "" ? null : parseInt(rawChain, 10);

  if (rawChain !== "" && isNaN(chainLimit!)) {
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: "Invalid value — chain limit must be an integer.",
    });
    return;
  }

  setDiscordConfig(discordId, discordType, { config_chain_limit: chainLimit });

  recordModEvent({
    event_type: "config_changed",
    actor_id: interaction.user?.id?.toString() ?? "",
    target_type: discordType,
    target_id: discordId,
    details: { config: "chain", chainLimit },
  });

  const chainStr = chainLimit !== null ? (chainLimit === 0 ? "blocked (0)" : String(chainLimit)) : "default";
  await bot.helpers.editOriginalInteractionResponse(interaction.token, {
    content: `Chain limit updated for ${discordType} ${discordId}: ${chainStr}`,
  });
});
