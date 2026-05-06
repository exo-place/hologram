import { ApplicationCommandOptionTypes, BitwisePermissionFlags } from "@discordeno/bot";
import { registerCommand, respond, type CommandContext } from "./index";
import { getEntityWithFacts } from "../../db/entities";
import {
  getRecentChannelMessages,
  searchChannelMessages,
  deleteWebhookMessageRecord,
  deleteSystemNote,
  type RecentChannelMessage,
} from "../../db/discord";
import { recordModEvent } from "../../db/moderation";
import { deleteWebhookMessageFromDiscord } from "../webhooks";
import { canUserDelete } from "./cmd-permissions";
import { debug } from "../../logger";

const MANAGE_WEBHOOKS = BitwisePermissionFlags.MANAGE_WEBHOOKS;

/** Parse "N-M" range string. Returns [n, m] (1-indexed, inclusive) or null if invalid. */
export function parseRange(input: string): [number, number] | null {
  const m = input.trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  const endStr = m[2];
  const end = endStr !== undefined ? parseInt(endStr) : n;
  if (isNaN(n) || isNaN(end) || n < 1 || end < n || end - n + 1 > 20) return null;
  return [n, end];
}

/** Check if a member permission bitfield contains MANAGE_WEBHOOKS. */
function hasManageWebhooks(memberPermissions: bigint | null | undefined): boolean {
  if (!memberPermissions) return false;
  return (memberPermissions & MANAGE_WEBHOOKS) === MANAGE_WEBHOOKS;
}

registerCommand({
  name: "purge",
  description: "Delete bot messages and system notes in this channel by substring or index range (1 = most recent)",
  options: [
    {
      name: "query",
      description: "Substring to match against recent messages",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
    {
      name: "range",
      description: "Index range, e.g. 1 (most recent) or 1-4 (four most recent)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
  ],
  async handler(ctx, options) {
    const query = options.query as string | undefined;
    const rangeStr = options.range as string | undefined;

    if (!query && !rangeStr) {
      await respond(ctx.bot, ctx.interaction, "Provide either `query` or `range`", true);
      return;
    }
    if (query && rangeStr) {
      await respond(ctx.bot, ctx.interaction, "Provide only one of `query` or `range`, not both", true);
      return;
    }

    // Resolve invoker's permissions (for MANAGE_WEBHOOKS check)
    const memberPermBig = ctx.interaction.member?.permissions?.bitfield ?? null;
    const invokerHasManageWebhooks = hasManageWebhooks(memberPermBig);

    if (rangeStr !== undefined) {
      await handleRange(ctx, rangeStr, invokerHasManageWebhooks);
    } else if (query !== undefined) {
      await handleQuery(ctx, query, invokerHasManageWebhooks);
    }
  },
});

async function canDelete(
  msg: RecentChannelMessage,
  ctx: CommandContext,
  invokerHasManageWebhooks: boolean,
): Promise<boolean> {
  if (invokerHasManageWebhooks) return true;
  // System notes can be deleted by anyone with Manage Webhooks (already checked above)
  // or by the author themselves
  if (msg.isSystemNote) {
    return false; // Only Manage Webhooks can purge system notes
  }
  if (msg.entityId === null) return false;
  const entity = getEntityWithFacts(msg.entityId);
  if (!entity) return false;
  return canUserDelete(entity, ctx.userId, ctx.username, ctx.userRoles);
}

/**
 * Delete a single channel message: skips Discord API for system notes,
 * calls Discord API for webhook messages.
 * Returns true on success.
 */
async function deleteChannelMessage(
  msg: RecentChannelMessage,
  channelId: string,
): Promise<boolean> {
  if (msg.isSystemNote) {
    // DB-only deletion — no Discord message to remove
    return deleteSystemNote(msg.dbId);
  }
  // Webhook message — delete from Discord first, then DB
  if (!msg.messageId) return false;
  const ok = await deleteWebhookMessageFromDiscord(channelId, msg.messageId);
  if (ok) {
    deleteWebhookMessageRecord(msg.messageId);
  }
  return ok;
}

async function handleQuery(
  ctx: CommandContext,
  query: string,
  invokerHasManageWebhooks: boolean,
) {
  if (!query.trim()) {
    await respond(ctx.bot, ctx.interaction, "Query cannot be empty", true);
    return;
  }

  const matches = searchChannelMessages(ctx.channelId, query);
  if (matches.length === 0) {
    await respond(ctx.bot, ctx.interaction, "No matching messages found", true);
    return;
  }

  if (matches.length > 1) {
    // Ambiguous — show top 5 matches and ask to use range
    const preview = matches.slice(0, 5).map((m, i) =>
      `**${i + 1}.** \`${m.entityName}\`: ${m.content.slice(0, 80).replace(/\n/g, " ")}…`,
    );
    await respond(
      ctx.bot,
      ctx.interaction,
      `Multiple matches (${matches.length} total). Use \`/delete range:1\` for the most recent, or be more specific:\n${preview.join("\n")}`,
      true,
    );
    return;
  }

  const msg = matches[0];
  if (!(await canDelete(msg, ctx, invokerHasManageWebhooks))) {
    await respond(ctx.bot, ctx.interaction, "You don't have permission to delete that message", true);
    return;
  }

  const ok = await deleteChannelMessage(msg, ctx.channelId);
  if (ok) {
    if (!msg.isSystemNote) {
      recordModEvent({
        event_type: "delete_message",
        actor_id: ctx.userId,
        target_type: "message",
        target_id: msg.messageId!,
        channel_id: ctx.channelId,
        guild_id: ctx.guildId ?? null,
        details: { entityId: msg.entityId, mode: "substring" },
      });
    }
    debug("Deleted message via /purge query", { messageId: msg.messageId, isSystemNote: msg.isSystemNote, entity: msg.entityName, actor: ctx.userId });
    const label = msg.isSystemNote ? "system note" : `message from **${msg.entityName}**`;
    await respond(ctx.bot, ctx.interaction, `Deleted ${label}`, true);
  } else {
    await respond(ctx.bot, ctx.interaction, "Failed to delete message (webhook may have changed, or missing Manage Messages permission)", true);
  }
}

async function handleRange(
  ctx: CommandContext,
  rangeStr: string,
  invokerHasManageWebhooks: boolean,
) {
  const parsed = parseRange(rangeStr);
  if (!parsed) {
    await respond(ctx.bot, ctx.interaction, "Invalid range. Use a number (e.g. `1`) or range like `1-4` (max 20)", true);
    return;
  }
  const [n, m] = parsed;

  // Fetch top M messages, take [n-1, m)
  const recent = getRecentChannelMessages(ctx.channelId, m);
  const targets = recent.slice(n - 1, m);

  if (targets.length === 0) {
    await respond(ctx.bot, ctx.interaction, `No messages found at position${n === m ? ` ${n}` : `s ${n}–${m}`}`, true);
    return;
  }

  let deleted = 0;
  const skipped: string[] = [];

  for (const msg of targets) {
    if (!(await canDelete(msg, ctx, invokerHasManageWebhooks))) {
      skipped.push(`**${msg.entityName}**`);
      continue;
    }
    const ok = await deleteChannelMessage(msg, ctx.channelId);
    if (ok) {
      if (!msg.isSystemNote) {
        recordModEvent({
          event_type: "delete_message",
          actor_id: ctx.userId,
          target_type: "message",
          target_id: msg.messageId!,
          channel_id: ctx.channelId,
          guild_id: ctx.guildId ?? null,
          details: { entityId: msg.entityId, mode: "range", range: rangeStr },
        });
      }
      deleted++;
    } else {
      skipped.push(`**${msg.entityName}** (API error)`);
    }
  }

  const parts: string[] = [];
  if (deleted > 0) parts.push(`Deleted ${deleted} message${deleted !== 1 ? "s" : ""}`);
  if (skipped.length > 0) parts.push(`Skipped: ${skipped.join(", ")}`);
  await respond(ctx.bot, ctx.interaction, parts.join(". ") || "Nothing to delete", true);
}
