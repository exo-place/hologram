import { ApplicationCommandOptionTypes } from "@discordeno/bot";
import { registerCommand, respond, type CommandContext } from "./index";
import {
  addMute,
  removeMute,
  listActiveMutes,
  recordModEvent,
  type MuteScopeType,
} from "../../db/moderation";
import { getEntityWithFacts, getEntityWithFactsByName } from "../../db/entities";
import { canUserEdit } from "./cmd-permissions";
import { parseDuration, discordRelative } from "../duration";

// =============================================================================
// Permission helpers
// =============================================================================

function hasPermission(ctx: CommandContext, perm: string): boolean {
  const perms = ctx.interaction.member?.permissions;
  if (!perms) return false;
  return (perms as { has(p: string): boolean }).has(perm) ||
    (perms as { has(p: string): boolean }).has("ADMINISTRATOR");
}

function hasTimeout(ctx: CommandContext): boolean {
  return hasPermission(ctx, "MODERATE_MEMBERS");
}

function isAdmin(ctx: CommandContext): boolean {
  return hasPermission(ctx, "ADMINISTRATOR");
}

// =============================================================================
// Sentinel for "all bots" kill-switch
// =============================================================================

const ALL_BOTS_SENTINEL = "__all_bots__";

// =============================================================================
// decideMuteAuth — pure, testable permission matrix
// =============================================================================

export interface MuteAuthInput {
  target: "entity" | "allbots";
  scope: "channel" | "server" | "everywhere";
  hasTimeout: boolean;
  canEdit: boolean;
  isAdmin: boolean;
}

export type MuteAuthResult =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * Decide whether the acting user may mute/unmute this target at this scope.
 *
 * Matrix:
 * - entity, channel|server  → allow if hasTimeout OR canEdit
 * - entity, everywhere      → allow if canEdit only (timeout alone is insufficient)
 * - allbots, channel|server → allow if hasTimeout
 * - allbots, everywhere     → allow if isAdmin (scoped everywhere is not supported — see TODO.md)
 */
export function decideMuteAuth(input: MuteAuthInput): MuteAuthResult {
  const { target, scope, hasTimeout: ht, canEdit: ce, isAdmin: ia } = input;

  if (target === "entity") {
    if (scope === "channel" || scope === "server") {
      if (ht || ce) return { allow: true };
      return { allow: false, reason: "You need Moderate Members permission or entity edit access to mute this entity here." };
    }
    // scope === "everywhere"
    if (ce) return { allow: true };
    return { allow: false, reason: "Muting everywhere requires entity edit access (Moderate Members alone is not sufficient for a cross-server mute)." };
  }

  // target === "allbots"
  if (scope === "channel" || scope === "server") {
    if (ht) return { allow: true };
    return { allow: false, reason: "You need Moderate Members permission to use the all-bots kill switch." };
  }
  // scope === "everywhere"
  if (ia) return { allow: true };
  return { allow: false, reason: "Muting all bots everywhere requires Administrator permission. Note: cross-server global kill switch is not currently supported — this would only affect bots on this server." };
}

// =============================================================================
// Scope label helpers
// =============================================================================

function scopeLabel(scope: string, ctx: CommandContext): string {
  if (scope === "channel") return `<#${ctx.channelId}>`;
  if (scope === "server") return "this server";
  return "everywhere";
}

// =============================================================================
// Build mute params from target + scope
// =============================================================================

interface MuteParams {
  scope_type: MuteScopeType;
  scope_id: string;
  channel_id: string | null;
  guild_id: string | null;
}

/**
 * Compute the mute record fields for the given target and scope.
 *
 * All-bots kill-switch mapping (must match filterMutedEntities check order):
 *   channel scope → scope_type="channel", scope_id=channelId — checked as isMuted("channel", channelId, channelId, guildId)
 *   server scope  → scope_type="guild",   scope_id=guildId   — checked as isMuted("guild", guildId, null, null)
 *                   stored with guild_id=NULL, channel_id=NULL (global scope in isMuted's matching)
 *   everywhere    → scope_type="guild",   scope_id=guildId (current guild only, see TODO.md)
 *
 * Entity mute mapping:
 *   channel scope → scope_type="entity", scope_id=entityId, channel_id=channelId, guild_id=guildId
 *   server scope  → scope_type="entity", scope_id=entityId, channel_id=null, guild_id=guildId
 *   everywhere    → scope_type="entity", scope_id=entityId, channel_id=null, guild_id=null
 */
function buildMuteParams(
  target: "entity" | "allbots",
  entityId: string | null,
  scope: "channel" | "server" | "everywhere",
  ctx: CommandContext,
): MuteParams {
  const guildId = ctx.guildId ?? null;

  if (target === "allbots") {
    if (scope === "channel") {
      // Channel kill-switch: filterMutedEntities calls isMuted("channel", channelId, channelId, guildId)
      // isMuted checks scope_type="channel", scope_id=channelId.
      // For the location match, we need channel_id=channelId, guild_id=guildId (channel-specific record).
      return {
        scope_type: "channel",
        scope_id: ctx.channelId,
        channel_id: ctx.channelId,
        guild_id: guildId,
      };
    }
    if (scope === "server") {
      // Guild kill-switch: filterMutedEntities calls isMuted("guild", guildId, null, null)
      // isMuted with channelId=null, guildId=null only matches records with guild_id IS NULL AND channel_id IS NULL.
      // So we store: scope_type="guild", scope_id=guildId, guild_id=NULL, channel_id=NULL.
      return {
        scope_type: "guild",
        scope_id: guildId ?? "",
        channel_id: null,
        guild_id: null,
      };
    }
    // everywhere — same as server scope but acknowledged to be current-guild-only (see TODO.md)
    return {
      scope_type: "guild",
      scope_id: guildId ?? "",
      channel_id: null,
      guild_id: null,
    };
  }

  // entity target
  const sid = entityId ?? "";
  if (scope === "channel") {
    return { scope_type: "entity", scope_id: sid, channel_id: ctx.channelId, guild_id: guildId };
  }
  if (scope === "server") {
    return { scope_type: "entity", scope_id: sid, channel_id: null, guild_id: guildId };
  }
  // everywhere
  return { scope_type: "entity", scope_id: sid, channel_id: null, guild_id: null };
}

// =============================================================================
// /mute command
// =============================================================================

registerCommand({
  name: "mute",
  description: "Mute an entity or silence all bots in a channel/server",
  options: [
    {
      name: "entity",
      description: "Entity to mute, or select '🔇 All bots' to silence all bots",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "duration",
      description: "How long: 30s, 10m, 1h, 2d, 1h30m, 30 minutes, forever",
      type: ApplicationCommandOptionTypes.String,
      required: true,
    },
    {
      name: "scope",
      description: "Where to apply the mute (default: this channel)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
        { name: "Everywhere (all servers)", value: "everywhere" },
      ],
    },
  ],

  async handler(ctx: CommandContext, options) {
    const entityInput = options.entity as string;
    const durationInput = options.duration as string;
    const scope = (options.scope as "channel" | "server" | "everywhere") ?? "channel";

    // Parse duration first
    const durationResult = parseDuration(durationInput);
    if (!durationResult.ok) {
      await respond(ctx.bot, ctx.interaction,
        "Invalid duration. Examples: `30s`, `10m`, `1h`, `2d`, `30 minutes`, `1h30m`, `forever`.",
        true,
      );
      return;
    }
    const expiresAt = durationResult.expiresAt;

    // Resolve target
    const isAllBots = entityInput === ALL_BOTS_SENTINEL;
    let entityName = "all bots";
    let entityId: string | null = null;

    if (!isAllBots) {
      // Resolve entity by ID or name
      const idNum = parseInt(entityInput, 10);
      let entity = isNaN(idNum) ? null : getEntityWithFacts(idNum);
      if (!entity) entity = getEntityWithFactsByName(entityInput);
      if (!entity) {
        await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
        return;
      }
      entityName = entity.name;
      entityId = String(entity.id);

      // Check permission
      const ce = canUserEdit(entity, ctx.userId, ctx.username, ctx.userRoles);
      const auth = decideMuteAuth({
        target: "entity",
        scope,
        hasTimeout: hasTimeout(ctx),
        canEdit: ce,
        isAdmin: isAdmin(ctx),
      });
      if (!auth.allow) {
        await respond(ctx.bot, ctx.interaction, auth.reason, true);
        return;
      }
    } else {
      // All-bots kill-switch
      const auth = decideMuteAuth({
        target: "allbots",
        scope,
        hasTimeout: hasTimeout(ctx),
        canEdit: false,
        isAdmin: isAdmin(ctx),
      });
      if (!auth.allow) {
        await respond(ctx.bot, ctx.interaction, auth.reason, true);
        return;
      }
    }

    const muteParams = buildMuteParams(
      isAllBots ? "allbots" : "entity",
      entityId,
      scope,
      ctx,
    );

    const mute = addMute({
      scope_type: muteParams.scope_type,
      scope_id: muteParams.scope_id,
      channel_id: muteParams.channel_id,
      guild_id: muteParams.guild_id,
      expires_at: expiresAt,
      created_by: ctx.userId,
    });

    recordModEvent({
      event_type: "muted",
      actor_id: ctx.userId,
      target_type: muteParams.scope_type,
      target_id: muteParams.scope_id,
      channel_id: ctx.channelId,
      guild_id: ctx.guildId ?? null,
      details: { mute_id: mute.id, target: entityName, scope, duration: durationInput },
    });

    const scopeStr = scopeLabel(scope, ctx);
    let reply: string;
    if (expiresAt === null) {
      reply = `🔇 Muted **${entityName}** in ${scopeStr} indefinitely (until \`/unmute\`).`;
    } else {
      reply = `🔇 Muted **${entityName}** in ${scopeStr} until ${discordRelative(expiresAt)}.`;
    }
    if (scope === "everywhere" && isAllBots) {
      reply += "\n⚠ Note: cross-server global kill-switch is not fully supported — this applies to the current server only.";
    }

    await respond(ctx.bot, ctx.interaction, reply, true);
  },
});

// =============================================================================
// /unmute command
// =============================================================================

registerCommand({
  name: "unmute",
  description: "Remove an active mute from an entity or all-bots kill switch",
  options: [
    {
      name: "entity",
      description: "Entity to unmute, or select '🔇 All bots' for kill-switch removal",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "scope",
      description: "Where to remove the mute (default: this channel)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
        { name: "Everywhere (all servers)", value: "everywhere" },
      ],
    },
  ],

  async handler(ctx: CommandContext, options) {
    const entityInput = options.entity as string;
    const scope = (options.scope as "channel" | "server" | "everywhere") ?? "channel";

    const isAllBots = entityInput === ALL_BOTS_SENTINEL;
    let entityName = "all bots";
    let entityId: string | null = null;

    if (!isAllBots) {
      const idNum = parseInt(entityInput, 10);
      let entity = isNaN(idNum) ? null : getEntityWithFacts(idNum);
      if (!entity) entity = getEntityWithFactsByName(entityInput);
      if (!entity) {
        await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
        return;
      }
      entityName = entity.name;
      entityId = String(entity.id);

      const ce = canUserEdit(entity, ctx.userId, ctx.username, ctx.userRoles);
      const auth = decideMuteAuth({
        target: "entity",
        scope,
        hasTimeout: hasTimeout(ctx),
        canEdit: ce,
        isAdmin: isAdmin(ctx),
      });
      if (!auth.allow) {
        await respond(ctx.bot, ctx.interaction, auth.reason, true);
        return;
      }
    } else {
      const auth = decideMuteAuth({
        target: "allbots",
        scope,
        hasTimeout: hasTimeout(ctx),
        canEdit: false,
        isAdmin: isAdmin(ctx),
      });
      if (!auth.allow) {
        await respond(ctx.bot, ctx.interaction, auth.reason, true);
        return;
      }
    }

    const muteParams = buildMuteParams(
      isAllBots ? "allbots" : "entity",
      entityId,
      scope,
      ctx,
    );

    // Find matching active mutes
    const filter: Parameters<typeof listActiveMutes>[0] = {
      scope_type: muteParams.scope_type,
      scope_id: muteParams.scope_id,
    };
    // Narrow by location
    if (muteParams.channel_id !== null) {
      filter.channel_id = muteParams.channel_id;
    } else {
      filter.channel_id = null;
    }
    if (muteParams.guild_id !== null) {
      filter.guild_id = muteParams.guild_id;
    } else {
      filter.guild_id = null;
    }

    const mutes = listActiveMutes(filter);
    if (mutes.length === 0) {
      await respond(ctx.bot, ctx.interaction,
        `No active mute found for **${entityName}** in ${scopeLabel(scope, ctx)}.`,
        true,
      );
      return;
    }

    for (const m of mutes) {
      removeMute(m.id);
    }

    recordModEvent({
      event_type: "unmuted",
      actor_id: ctx.userId,
      target_type: muteParams.scope_type,
      target_id: muteParams.scope_id,
      channel_id: ctx.channelId,
      guild_id: ctx.guildId ?? null,
      details: { removed: mutes.length, target: entityName, scope },
    });

    const count = mutes.length;
    await respond(ctx.bot, ctx.interaction,
      `🔊 Removed ${count} mute${count !== 1 ? "s" : ""} for **${entityName}** in ${scopeLabel(scope, ctx)}.`,
      true,
    );
  },
});
