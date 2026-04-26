import { createBot, Intents } from "@discordeno/bot";
import { MessageFlags } from "@discordeno/types";
import type { DiscordMessage } from "@discordeno/types";
import { buildMsgDataAndContent, channelTypeString, guildNsfwLevelString, serializeComponents, serializeEmbed, serializeDiscordEmbed } from "./client-serialization";
import { info, debug, warn, error } from "../logger";
import { registerCommands, handleInteraction } from "./commands";
import { handleMessage } from "../ai/handler";
import type { GeneratedFile } from "../ai/handler";
import { handleMessageStreaming } from "../ai/streaming";
import { InferenceError, isDedicatedImageModel, isModelAllowed, parseModelSpec } from "../ai/models";
import type { EvaluatedEntity } from "../ai/context";
import { retrieveRelevantMemories, type MemoryScope } from "../db/memories";
import { resolveDiscordEntity, resolveDiscordEntities, isNewUser, markUserWelcomed, addMessage, updateMessageByDiscordId, mergeMessageData, deleteMessageByDiscordId, trackWebhookMessage, getWebhookMessageEntity, getMessages, getFilteredMessages, formatMessagesForContext, recordEvalError, isOurWebhookUserId, countUnreadMessages, getLastMessageSnowflake, getAllBoundChannelIds, getChannelScopedEntities, storeChannelMeta, resolveChainLimit, type MessageData } from "../db/discord";
import { getEntity, getEntityWithFacts, getSystemEntity, getFactsForEntity, getEntityEvalDefaults, getEntityKeywords, getEntityConfig, getPermissionDefaults, type EntityWithFacts } from "../db/entities";
import { evaluateFacts, getTickInterval, createBaseContext, parsePermissionDirectives, isUserBlacklisted, isUserAllowed, compileContextExpr, ExprError } from "../logic/expr";
import { DEFAULT_CONTEXT_EXPR } from "../ai/context";
import { executeWebhook, editWebhookMessage, setBot } from "./webhooks";
import { runOnChannel } from "./channel-queue";
import { broadcastSSE } from "../api/routes/chat";
import { setBotBridge } from "./bridge";
import "./commands/commands"; // Register /create, /view, /delete, /transfer, /bind, /unbind, /config, /trigger, /forget
import "./commands/cmd-edit";   // Register /edit command + modals
import "./commands/cmd-debug";  // Register /debug command
import "./commands/cmd-admin";  // Register /admin command
import { ensureHelpEntities } from "./commands/help";
import { checkRateLimits, shouldWarnRateLimit, type TriggerType } from "./rate-limit";
import { filterMutedEntities } from "./mute-filter";
import { recordEntityEvent } from "../db/moderation";
import { canOwnerReadChannel, type ChannelCheckBot } from "./commands/cmd-permissions";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN environment variable is required");
}

// =============================================================================
// Discord snowflake utilities
// =============================================================================

const DISCORD_EPOCH = 1420070400000n;

/** Extract the Unix timestamp (ms) from a Discord snowflake. */
function snowflakeToTimestamp(snowflake: bigint): number {
  return Number((snowflake >> 22n) + DISCORD_EPOCH);
}

export const bot = createBot({
  token,
  intents:
    Intents.Guilds |
    Intents.GuildMessages |
    Intents.MessageContent |
    Intents.DirectMessages,
  desiredProperties: {
    user: {
      id: true,
      username: true,
      globalName: true,
      toggles: true,
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      member: true,
      mentions: true, // Enables computed mentionedUserIds
      messageReference: true,
      messageSnapshots: true,
      webhookId: true,
      stickerItems: true,
      embeds: true,
      attachments: true,
      components: true,
      flags: true,
    },
    interaction: {
      id: true,
      type: true,
      data: true,
      channelId: true,
      guildId: true,
      user: true,
      token: true,
      member: true,
    },
    component: {
      // v1 (ActionRow, Button, Select, TextInput)
      type: true,
      customId: true,
      value: true,
      values: true,
      components: true,
      component: true,
      // v2 (Container, TextDisplay, Section, MediaGallery, Separator, etc.)
      id: true,
      content: true,
      accentColor: true,
      spoiler: true,
      label: true,
      style: true,
      emoji: true,
      url: true,
      disabled: true,
      items: true,
      media: true,
      accessory: true,
      file: true,
      name: true,
      size: true,
      description: true,
      divider: true,
      spacing: true,
      skuId: true,
      placeholder: true,
      minLength: true,
      maxLength: true,
      minValues: true,
      maxValues: true,
      required: true,
      options: true,
      channelTypes: true,
      defaultValues: true,
    },
    unfurledMediaItem: {
      url: true,
      proxyUrl: true,
      height: true,
      width: true,
      contentType: true,
      attachmentId: true,
    },
    mediaGalleryItem: {
      media: true,
      description: true,
      spoiler: true,
    },
    guild: {
      id: true,
      name: true,
      description: true,
      nsfwLevel: true,
    },
    role: {
      id: true,
      permissions: true,
    },
    webhook: {
      id: true,
      name: true,
      token: true,
    },
    channel: {
      id: true,
      type: true,
      parentId: true,
      name: true,
      topic: true,
      // needed by canOwnerReadChannel to check user access
      permissionOverwrites: true,
      // toggles is always present (per Discordeno metadata)
    },
    messageReference: {
      messageId: true,
      channelId: true,
      guildId: true,
    },
    messageSnapshot: {
      message: true,
    },
    sticker: {
      id: true,
      name: true,
      formatType: true,
    },
    attachment: {
      id: true,
      filename: true,
      url: true,
      contentType: true,
      title: true,
      description: true,
      size: true,
      height: true,
      width: true,
      ephemeral: true,
      duration_secs: true,
    },
    member: {
      roles: true,
      permissions: true,
    },
  },
});

// Initialize webhook module with bot instance
setBot(bot);

// =============================================================================
// Message serialization helpers — see client-serialization.ts
// =============================================================================

let botUserId: bigint | null = null;

// Lazily-fetched bot application owner IDs (single-owner app: [ownerId]; team app: [ownerUserId])
let botOwnerIds: string[] | null = null;

async function getBotOwnerIds(): Promise<string[]> {
  if (botOwnerIds !== null) return botOwnerIds;
  try {
    const app = await bot.helpers.getApplicationInfo();
    const ids: string[] = [];
    if (app.team) {
      ids.push(app.team.ownerUserId.toString());
    } else if (app.owner) {
      ids.push(app.owner.id.toString());
    }
    botOwnerIds = ids;
  } catch (err) {
    warn("Failed to fetch application info for bot owner", { err });
    botOwnerIds = [];
  }
  return botOwnerIds;
}

// Track last response time per channel (for response_ms in expressions)
const lastResponseTime = new Map<string, number>();

// Track last message time per channel (for idle_ms in expressions)
const lastMessageTime = new Map<string, number>();

// Channel/guild metadata cache with 5-min TTL
interface ChannelMeta { id: string; name: string; description: string; is_nsfw: boolean; type: string; mention: string; fetchedAt: number }
interface GuildMeta { id: string; name: string; description: string; nsfw_level: string; fetchedAt: number }
const channelMetaCache = new Map<string, ChannelMeta>();
const guildMetaCache = new Map<string, GuildMeta>();
const META_TTL_MS = 5 * 60 * 1000;


export async function getChannelMetadata(channelId: string): Promise<Omit<ChannelMeta, "fetchedAt">> {
  const cached = channelMetaCache.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < META_TTL_MS) {
    return cached;
  }
  try {
    const ch = await bot.helpers.getChannel(BigInt(channelId));
    const meta: ChannelMeta = {
      id: channelId,
      name: ch.name ?? "",
      description: ch.topic ?? "",
      is_nsfw: ch.toggles?.nsfw ?? false,
      type: channelTypeString(ch.type ?? 0),
      mention: `<#${channelId}>`,
      fetchedAt: Date.now(),
    };
    channelMetaCache.set(channelId, meta);
    return meta;
  } catch {
    return { id: channelId, name: "", description: "", is_nsfw: false, type: "text", mention: `<#${channelId}>` };
  }
}

export async function getGuildMetadata(guildId: string): Promise<Omit<GuildMeta, "fetchedAt">> {
  const cached = guildMetaCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < META_TTL_MS) {
    return cached;
  }
  try {
    const g = await bot.helpers.getGuild(BigInt(guildId));
    const meta: GuildMeta = {
      id: guildId,
      name: g.name ?? "",
      description: g.description ?? "",
      nsfw_level: guildNsfwLevelString(g.nsfwLevel ?? 0),
      fetchedAt: Date.now(),
    };
    guildMetaCache.set(guildId, meta);
    return meta;
  } catch {
    return { id: guildId, name: "", description: "", nsfw_level: "default" };
  }
}

// Track consecutive self-response chain depth per channel (resets on real user message)
const responseChainDepth = new Map<string, number>();
const _maxResponseChainRaw = process.env.MAX_RESPONSE_CHAIN
  ? parseInt(process.env.MAX_RESPONSE_CHAIN, 10)
  : 3;
if (_maxResponseChainRaw === 0) {
  warn(
    "MAX_RESPONSE_CHAIN=0 is invalid (it would disable the self-response loop guard entirely). " +
    "Defaulting to 3. Use a positive integer or unset the variable to use the default."
  );
}
// Default chain limit — can be overridden per channel/guild via /config-chain.
const MAX_RESPONSE_CHAIN_DEFAULT = _maxResponseChainRaw === 0 ? 3 : _maxResponseChainRaw;

// Pending retry timers per channel:entity
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Periodic tick timers per entity (one timer, round-robins across bound channels)
const tickTimers = new Map<number, ReturnType<typeof setInterval>>();
const tickChannels = new Map<number, string[]>();
const tickChannelIndex = new Map<number, number>();
const lastTickTime = new Map<number, number>();

function retryKey(channelId: string, entityId: number): string {
  return `${channelId}:${entityId}`;
}

/** Split $model result into conversation modelSpec + imageModelSpec (for dedicated image models). */
function splitModelSpec(
  resultModelSpec: string | null,
  configModelSpec: string | null,
): { modelSpec: string | null; imageModelSpec: string | null } {
  if (resultModelSpec && isDedicatedImageModel(parseModelSpec(resultModelSpec).modelName)) {
    return { modelSpec: configModelSpec, imageModelSpec: resultModelSpec };
  }
  return { modelSpec: resultModelSpec, imageModelSpec: null };
}

// Message deduplication
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

// Track bot-sent message IDs (for reply detection)
const botMessageIds = new Set<string>();
const MAX_BOT_MESSAGES = 1000;

// In-memory tracking of our own webhook messages (for recursion limit)
// This must be updated synchronously when we send, before yielding control.
// The entity map is also populated here to handle the race condition where Discord
// fires MESSAGE_CREATE via WebSocket before our HTTP webhook response arrives.
const ownWebhookMessageIds = new Set<string>();
const ownWebhookEntityMap = new Map<string, { entityId: number; entityName: string }>();
const MAX_OWN_WEBHOOK_IDS = 1000;

// =============================================================================
// Startup catch-up (backfill missed messages while offline)
// =============================================================================

/** Channels that have been caught up in this session (lazy mode). */
const caughtUpChannels = new Set<string>();

/** Fetch and store messages missed while the bot was offline for one channel.
 *
 * Cursor: last stored discord_message_id for the channel, if any.
 * Everything Discord returns after that ID is guaranteed new — no deduplication needed.
 * For channels with no history, fetches without a cursor (gets latest 100 messages).
 *
 * CATCHUP_ON_STARTUP=all|lazy|off (default: all)
 * CATCHUP_RESPOND=true|false (default: false) — evaluate + respond to recent missed messages
 * CATCHUP_RESPOND_MAX_AGE_MS (default: 300000ms / 5 min) — max age to respond to
 */
async function catchUpChannel(channelId: string): Promise<void> {
  if (caughtUpChannels.has(channelId)) return;
  caughtUpChannels.add(channelId);

  // Use last stored message as cursor so we fetch exactly the gap.
  // null = no history; Discord will return the latest messages without an after cursor.
  const lastStored = getLastMessageSnowflake(channelId);

  const shouldRespond = process.env.CATCHUP_RESPOND === "true";
  const respondMaxAge = parseInt(process.env.CATCHUP_RESPOND_MAX_AGE_MS ?? "300000", 10);
  const now = Date.now();
  let totalStored = 0;
  let cursor = lastStored;

  while (true) {
    let messages: Awaited<ReturnType<typeof bot.helpers.getMessages>>;
    try {
      messages = await bot.helpers.getMessages(BigInt(channelId), {
        ...(cursor !== null && { after: cursor }),
        limit: 100,
      });
    } catch (err) {
      warn("Catch-up fetch failed", { channelId, error: String(err) });
      return;
    }

    if (messages.length === 0) break;

    // Sort chronologically (ascending) — Discord returns newest-first by default
    const sorted = [...messages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    for (const message of sorted) {
      // Skip our own bot messages
      if (botUserId && message.author.id === botUserId) continue;

      const messageAge = now - snowflakeToTimestamp(message.id);

      if (shouldRespond && messageAge < respondMaxAge) {
        // Full pipeline: evaluate facts and respond if warranted
        await bot.events.messageCreate?.(message);
      } else {
        // Store for context only — skipped by markProcessed on next messageCreate
        const { content, msgData } = buildMsgDataAndContent(message);
        const authorName = message.author.globalName ?? message.author.username;
        addMessage(channelId, message.author.id.toString(), authorName, content, message.id.toString(), msgData);
        totalStored++;
      }
    }

    if (sorted.length < 100) break;
    cursor = sorted[sorted.length - 1].id;
  }

  if (totalStored > 0) {
    info("Caught up channel history", { channelId, count: totalStored });
  }
}

/** Run catch-up for all channels with entity bindings. Errors per-channel are logged, not thrown. */
async function catchUpAllChannels(): Promise<void> {
  const channelIds = getAllBoundChannelIds();
  if (channelIds.length === 0) return;
  info("Starting startup catch-up", { channels: channelIds.length });
  for (const channelId of channelIds) {
    await catchUpChannel(channelId);
  }
  info("Startup catch-up complete");
}

function isOwnWebhookMessage(messageId: string): boolean {
  // Check in-memory first (handles race condition), then DB
  return ownWebhookMessageIds.has(messageId) || !!getWebhookMessageEntity(messageId);
}

function trackOwnWebhookMessage(messageId: string, entityId: number, entityName: string): void {
  // Add to in-memory structures immediately (synchronous), before the DB write.
  // This handles the race where Discord fires MESSAGE_CREATE via WebSocket before
  // our HTTP webhook response arrives, making the DB lookup miss.
  ownWebhookMessageIds.add(messageId);
  ownWebhookEntityMap.set(messageId, { entityId, entityName });
  if (ownWebhookMessageIds.size > MAX_OWN_WEBHOOK_IDS) {
    const iter = ownWebhookMessageIds.values();
    for (let i = 0; i < MAX_OWN_WEBHOOK_IDS / 2; i++) {
      const v = iter.next().value;
      if (v) {
        ownWebhookMessageIds.delete(v);
        ownWebhookEntityMap.delete(v);
      }
    }
  }
  // Also persist to DB for reply detection across restarts
  trackWebhookMessage(messageId, entityId, entityName);
}

/** Look up entity info for a webhook message, checking in-memory cache before DB. */
function lookupWebhookEntity(messageId: string): { entityId: number; entityName: string } | null {
  return ownWebhookEntityMap.get(messageId) ?? getWebhookMessageEntity(messageId);
}

function markProcessed(messageId: bigint): boolean {
  const id = messageId.toString();
  if (processedMessages.has(id)) return false;
  processedMessages.add(id);
  if (processedMessages.size > MAX_PROCESSED) {
    const iter = processedMessages.values();
    for (let i = 0; i < MAX_PROCESSED / 2; i++) {
      const v = iter.next().value;
      if (v) processedMessages.delete(v);
    }
  }
  return true;
}

bot.events.ready = async (payload) => {
  info("Bot ready", { username: payload.user.username });
  botUserId = payload.user.id;

  // Seed help entities
  ensureHelpEntities();

  await registerCommands(bot);

  // Start catch-up for missed messages (non-blocking — runs in background)
  const catchupMode = process.env.CATCHUP_ON_STARTUP ?? "all";
  if (catchupMode === "all") {
    catchUpAllChannels().catch(err => {
      warn("Startup catch-up encountered an error", { error: String(err) });
    });
  }

  // Start $tick timers for entities with periodic check-in directives
  initTickTimers();
};

bot.events.messageCreate = async (message) => {
  // Ignore own messages
  if (botUserId && message.author.id === botUserId) return;
  const hasEmbeds = (message.embeds?.length ?? 0) > 0;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  const hasSnapshots = (message.messageSnapshots?.length ?? 0) > 0;
  const isBot = !!message.author.toggles?.bot;
  const hasComponents = (message.components?.length ?? 0) > 0;
  // Always store bot messages — embeds often arrive late via MESSAGE_UPDATE
  if (!isBot && !hasComponents && !message.content && !message.stickerItems?.length && !hasEmbeds && !hasAttachments && !hasSnapshots) return;
  if (!markProcessed(message.id)) return;

  const channelId = message.channelId.toString();
  const guildId = message.guildId?.toString();

  // Check if all channel-bound entities have opted out of the response queue.
  // Skips serialization only when EVERY entity is opted out — mixing opt-out and
  // non-opt-out entities would break ordering for the non-exempt ones.
  const preCheckIds = [
    ...resolveDiscordEntities(channelId, "channel", guildId, channelId),
    ...(guildId ? resolveDiscordEntities(guildId, "guild", guildId, channelId) : []),
  ];
  const uniquePreCheckIds = [...new Set(preCheckIds)];
  const allQueueDisabled = uniquePreCheckIds.length > 0 &&
    uniquePreCheckIds.every(id => getEntityConfig(id)?.config_queue_disabled === 1);

  const enqueue = allQueueDisabled
    ? (fn: () => Promise<void>) => fn()
    : (fn: () => Promise<void>) => runOnChannel(channelId, fn, { label: "messageCreate" });

  enqueue(async () => {
  // Lazy catch-up: on first message in a channel, backfill history before processing
  if ((process.env.CATCHUP_ON_STARTUP ?? "all") === "lazy") {
    await catchUpChannel(channelId);
  }

  const { content, msgData } = buildMsgDataAndContent(message);

  // mentionedUserIds is unreliable in Discordeno, parse from content as fallback
  const isBotMentioned = botUserId !== null && (
    message.mentionedUserIds?.includes(botUserId) ||
    content.includes(`<@${botUserId}>`)
  );
  const messageTime = Date.now();

  // Detect reply to bot and forwarded messages
  const messageRef = message.messageReference;
  const refMessageId = messageRef?.messageId?.toString();
  const isRepliedToBot = refMessageId ? botMessageIds.has(refMessageId) : false;
  const repliedToWebhookEntity = refMessageId ? lookupWebhookEntity(refMessageId) : undefined;
  const isReplied = isRepliedToBot || !!repliedToWebhookEntity;
  const isForward = hasSnapshots; // forwarded messages have messageSnapshots
  // flags is always present (Discordeno alwaysPresents) but not reflected in SetupDesiredProps
  const isSilent = (message as unknown as { flags?: { contains(flag: number): boolean } }).flags?.contains(MessageFlags.SuppressNotifications) ?? false;

  // Check if any mentioned user ID is one of our webhook IDs
  // (handles reply-with-@ping to webhook entity messages)
  let isWebhookMentioned = false;
  if (!isBotMentioned && message.mentionedUserIds?.length) {
    for (const uid of message.mentionedUserIds) {
      if (isOurWebhookUserId(uid.toString())) {
        isWebhookMentioned = true;
        break;
      }
    }
  }
  const isMentioned = isBotMentioned || isWebhookMentioned;

  // Track response chain depth to prevent infinite self-response loops
  const isWebhookMessage = !!message.webhookId;
  const isHologram = isWebhookMessage && isOurWebhookUserId(message.webhookId!.toString());
  if (isHologram) {
    // This is our own webhook - increment chain depth
    const depth = (responseChainDepth.get(channelId) ?? 0) + 1;
    responseChainDepth.set(channelId, depth);
    const chainLimit = resolveChainLimit(channelId, guildId) ?? MAX_RESPONSE_CHAIN_DEFAULT;
    if (depth > chainLimit) {
      debug("Response chain limit reached", { channel: channelId, depth, max: chainLimit });
      return;
    }
  } else if (!isBot && !isWebhookMessage) {
    // A genuine human message breaks any active self-response chain
    responseChainDepth.delete(channelId);
  }

  debug("Mention check", {
    botUserId: botUserId?.toString(),
    mentionedUserIds: message.mentionedUserIds?.map(id => id.toString()),
  });

  // Resolve author name: persona > display name > username
  const authorId = message.author.id.toString();
  const userEntityId = resolveDiscordEntity(authorId, "user", guildId, channelId);
  const userEntity = userEntityId ? getEntity(userEntityId) : null;
  const authorName = userEntity?.name
    ?? message.author.globalName
    ?? message.author.username;

  // Extract member roles (BigInt[] → string[])
  const authorRoles: string[] = (message.member?.roles ?? []).map((r) => r.toString());

  debug("Message", {
    channel: channelId,
    author: authorName,
    content: content.slice(0, 50),
    mentioned: isMentioned,
    replied: isReplied,
    is_forward: isForward,
    embedCount: message.embeds?.length ?? 0,
    isBot,
  });

  // Store message in history (before response decision so context builds up)
  const stored = addMessage(channelId, authorId, authorName, content, message.id.toString(), msgData);
  if (stored) broadcastSSE(channelId, { type: "message", message: stored });

  // Cache channel name for the web UI (fire-and-forget; getChannelMetadata has its own cache)
  if (!guildId) {
    // DM — use the author's name as the channel display name
    storeChannelMeta(channelId, authorName, true);
  } else {
    getChannelMetadata(channelId).then((meta) => {
      if (meta.name) storeChannelMeta(channelId, meta.name, false);
    }).catch(() => {});
  }

  // Get ALL channel entities (supports multiple characters)
  const channelEntityIds = resolveDiscordEntities(channelId, "channel", guildId, channelId);

  // Also get guild-level entities (bound to server) - only if in a guild
  const guildEntityIds = guildId
    ? resolveDiscordEntities(guildId, "guild", guildId, channelId)
    : [];

  // Combine unique entity IDs (channel bindings + guild bindings)
  const allEntityIds = [...new Set([...channelEntityIds, ...guildEntityIds])];

  // No binding = no response
  if (allEntityIds.length === 0) {
    if (isMentioned) {
      debug("Mentioned but no channel or guild binding - ignoring");
    }
    return;
  }

  // Welcome new users with a DM — only when they explicitly reply to a bot message
  const userId = message.author.id.toString();
  if (isReplied && isNewUser(userId)) {
    markUserWelcomed(userId);
    sendWelcomeDm(message.author.id).catch(err => {
      warn("Failed to send welcome DM", { userId: message.author.id.toString(), err });
    });
  }

  // Load all bound entities (channel + guild level)
  const allChannelEntities: EntityWithFacts[] = [];
  for (const entityId of allEntityIds) {
    const entity = getEntityWithFacts(entityId);
    if (entity) allChannelEntities.push(entity);
  }

  if (allChannelEntities.length === 0) return;

  // Confused-deputy check: skip entities whose owner cannot read this channel.
  // Guild-bound entities could otherwise let owners exfiltrate content from channels
  // they cannot access.  DM channels have no guild → skip the check entirely.
  let deputyFiltered: EntityWithFacts[] = allChannelEntities;
  if (guildId) {
    const guildIdBig = BigInt(guildId);
    const channelIdBig = BigInt(channelId);
    const kept: EntityWithFacts[] = [];
    const skippedOwners: string[] = [];
    await Promise.all(allChannelEntities.map(async (entity) => {
      if (!entity.owned_by) { kept.push(entity); return; }
      const allowed = await canOwnerReadChannel(bot as unknown as ChannelCheckBot, entity.owned_by, guildIdBig, channelIdBig);
      if (allowed) {
        kept.push(entity);
      } else {
        skippedOwners.push(entity.name);
        debug("Skipped entity: owner lacks channel access", {
          entity: entity.name,
          owner: entity.owned_by,
          channelId,
          guildId,
        });
      }
    }));
    deputyFiltered = kept;
    if (skippedOwners.length > 0) {
      debug("Confused-deputy filter", { skipped: skippedOwners, channelId, guildId });
    }
  }

  if (deputyFiltered.length === 0) return;

  // Filter muted entities before fact evaluation (avoids wasted LLM/memory work)
  const muteResult = filterMutedEntities(deputyFiltered, channelId, guildId ?? null);
  const channelEntities = muteResult.active;
  if (muteResult.muted.length > 0) {
    debug("Mute filter applied", { muted: muteResult.muted.map(m => `${m.entity.name}(${m.scope})`), channelId, guildId });
  }

  if (channelEntities.length === 0) return;

  // Evaluate each entity's facts independently
  const respondingEntities: EvaluatedEntity[] = [];
  const retryEntities: { entity: EntityWithFacts; retryMs: number }[] = [];
  const lastResponse = lastResponseTime.get(channelId) ?? 0;

  // Compute idle_ms (time since any message in channel)
  const lastMsg = lastMessageTime.get(channelId) ?? 0;
  const idleMs = lastMsg > 0 ? messageTime - lastMsg : Infinity;
  lastMessageTime.set(channelId, messageTime);

  // Pre-compute unread counts BEFORE async calls to avoid race conditions
  // (webhook messages from concurrent responses could be processed during awaits)
  const unreadCounts = new Map<number, number>();
  for (const entity of channelEntities) {
    unreadCounts.set(entity.id, countUnreadMessages(channelId, entity.id));
  }

  // Fetch channel/guild metadata (cached)
  const channelMeta = await getChannelMetadata(channelId);
  const guildMeta = guildId
    ? await getGuildMetadata(guildId)
    : { id: "", name: "", description: "", nsfw_level: "default" };

  for (const entity of channelEntities) {
    // Cancel any pending retry for this entity
    const key = retryKey(channelId, entity.id);
    const existingTimer = retryTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      retryTimers.delete(key);
    }

    // Check if message author is blacklisted from this entity
    const facts = entity.facts.map(f => f.content);
    const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
    if (isUserBlacklisted(permissions, authorId, authorName, entity.owned_by, authorRoles)) {
      debug("User blacklisted from entity", { entity: entity.name, user: authorName });
      continue;
    }

    // Check $use whitelist
    if (!isUserAllowed(permissions, authorId, authorName, entity.owned_by, authorRoles)) {
      debug("User not in $use whitelist", { entity: entity.name, user: authorName });
      continue;
    }

    // Build expression context for this entity
    // Check if this is the entity's own webhook message (self-triggered).
    // Prefer entity ID lookup via webhook_messages table over name comparison,
    // which breaks when two entities share a name or the webhook is renamed externally.
    let isSelf = false;
    if (message.webhookId) {
      const webhookEntity = lookupWebhookEntity(message.id.toString());
      if (webhookEntity !== null) {
        isSelf = webhookEntity.entityId === entity.id;
      } else {
        // Fallback: webhook message not tracked (sent before bot started, or external webhook)
        isSelf = entity.name.toLowerCase() === authorName.toLowerCase();
        debug('isSelf fallback to name comparison (message not in webhook_messages)', {
          entity: entity.name,
          authorName,
          messageId: message.id.toString(),
        });
      }
    }
    const ctx = createBaseContext({
      facts,
      has_fact: (pattern: string) => {
        const regex = new RegExp(pattern, "i");
        return facts.some(f => regex.test(f));
      },
      messages: (n = 1, format?: string, filter?: string) =>
        filter
          ? formatMessagesForContext(getFilteredMessages(channelId, n, filter), format)
          : formatMessagesForContext(getMessages(channelId, n), format),
      response_ms: lastResponse > 0 ? messageTime - lastResponse : Infinity,
      retry_ms: 0,
      idle_ms: idleMs,
      unread_count: unreadCounts.get(entity.id) ?? 0,
      mentioned: isMentioned ?? false,
      replied: isReplied,
      replied_to: repliedToWebhookEntity?.entityName ?? "",
      is_forward: isForward,
      is_self: isSelf,
      is_hologram: isHologram,
      silent: isSilent,
      interaction_type: "",
      name: entity.name,
      chars: channelEntities.map(e => e.name),
      channel: channelMeta,
      server: guildMeta,
      keywords: getEntityKeywords(entity.id),
    });

    const evalDefaults = getEntityEvalDefaults(entity.id);
    let result;
    try {
      result = evaluateFacts(facts, ctx, evalDefaults);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      warn("Fact evaluation failed", {
        entity: entity.name,
        error: errorMsg,
      });

      // Notify all editors of the error (deduped by error message)
      const editors = getEditorsToNotify(entity.id, entity.owned_by, facts);
      if (editors.length > 0) {
        const count = recordEvalError(entity.id, editors[0], errorMsg);
        if (count <= 2) {
          const isRecurring = count === 2;
          for (const userId of editors) {
            notifyUserOfError(userId, entity.name, errorMsg, undefined, undefined, isRecurring).catch(() => {
              // DMs may fail if user has them disabled
            });
          }
        }
      }
      continue;
    }

    debug("Fact evaluation", {
      entity: entity.name,
      shouldRespond: result.shouldRespond,
      respondSource: result.respondSource,
      retryMs: result.retryMs,
      factsCount: result.facts.length,
    });

    if (result.retryMs !== null && result.retryMs > 0) {
      // Entity wants to delay
      retryEntities.push({ entity, retryMs: result.retryMs });
    } else {
      // Default response logic (when no $respond directive):
      // 1. If only one character: respond to @mentions (ambiguous with multiple chars)
      // 2. Respond if reply is specifically to this entity's message (unambiguous)
      // 3. Respond if entity's name is mentioned in dialogue (not self-triggered)
      // 4. Respond if message matches any configured trigger keyword
      const nameMentioned = ctx.mentioned_in_dialogue(entity.name) && !isSelf;
      const repliedToThis = repliedToWebhookEntity?.entityName.toLowerCase() === entity.name.toLowerCase();
      const keywordMatch = ctx.keyword_match && !isSelf;
      const defaultRespond =
        (channelEntities.length === 1 && isMentioned) ||
        (repliedToThis && (!isHologram || Math.random() < 0.75)) ||
        nameMentioned ||
        keywordMatch;
      // @silent suppresses unless entity explicitly opts in via $if silent: $respond
      const shouldRespond = (!isSilent || result.shouldRespond === true) && (result.shouldRespond ?? defaultRespond);

      if (shouldRespond) {
        // Log the trigger source
        const source = result.respondSource
          ?? (nameMentioned ? `name mentioned in: "${content.slice(0, 50)}"`
            : keywordMatch ? `keyword match in: "${content.slice(0, 50)}"`
            : isMentioned ? "bot @mentioned"
            : isReplied ? "reply to bot"
            : "unknown");
        debug("Entity responding", { entity: entity.name, source });

        const { modelSpec: resolvedModelSpec, imageModelSpec } = splitModelSpec(result.modelSpec, evalDefaults.modelSpec ?? null);
        respondingEntities.push({
          id: entity.id,
          name: entity.name,
          ownedBy: entity.owned_by ?? null,
          facts: result.facts,
          avatarUrl: result.avatarUrl,
          streamMode: result.streamMode,
          streamDelimiter: result.streamDelimiter,
          memoryScope: result.memoryScope,
          contextExpr: result.contextExpr,
          isFreeform: result.isFreeform,
          modelSpec: resolvedModelSpec,
          imageModelSpec,
          stripPatterns: result.stripPatterns,
          thinkingLevel: result.thinkingLevel,
          collapseMessages: result.collapseMessages,
          contentFilters: result.contentFilters,
          template: entity.template,
          systemTemplate: entity.system_template,
          exprContext: ctx,
        });
      }
    }
  }

  // Respond immediately with entities that are ready
  if (respondingEntities.length > 0) {
    // Group entities by template so entities with different templates get separate LLM calls
    const templateGroups = new Map<string | null, EvaluatedEntity[]>();
    for (const entity of respondingEntities) {
      const key = entity.template ?? null;
      const group = templateGroups.get(key) ?? [];
      group.push(entity);
      templateGroups.set(key, group);
    }

    for (const [, groupEntities] of templateGroups) {
      await sendResponse(channelId, guildId, authorName, content, isMentioned ?? false, groupEntities, "message");
    }
  }

  // Schedule per-entity retries (don't block other characters)
  for (const { entity, retryMs } of retryEntities) {
    const key = retryKey(channelId, entity.id);
    debug("Scheduling entity retry", { entity: entity.name, retryMs });
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      processEntityRetry(channelId, guildId, entity.id, authorName, content, messageTime, channelEntities).catch(err => {
        error("Unhandled error in entity retry", err, { entity: entity.name, channelId });
      });
    }, retryMs);
    retryTimers.set(key, timer);
  }
  }).catch(err => {
    error("Unhandled error in messageCreate queue", err, { channelId });
  });
};

async function processEntityRetry(
  channelId: string,
  guildId: string | undefined,
  entityId: number,
  username: string,
  content: string,
  messageTime: number,
  allChannelEntities: EntityWithFacts[]
) {
  const entity = getEntityWithFacts(entityId);
  if (!entity) return;

  const facts = entity.facts.map(f => f.content);
  const lastResponse = lastResponseTime.get(channelId) ?? 0;
  const now = Date.now();

  // Compute idle_ms for retry context
  const lastMsg = lastMessageTime.get(channelId) ?? 0;
  const retryIdleMs = lastMsg > 0 ? now - lastMsg : Infinity;

  // Fetch channel/guild metadata (cached)
  const channelMeta = await getChannelMetadata(channelId);
  const guildMeta = guildId
    ? await getGuildMetadata(guildId)
    : { id: "", name: "", description: "", nsfw_level: "default" };

  const ctx = createBaseContext({
    facts,
    has_fact: (pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return facts.some(f => regex.test(f));
    },
    messages: (n = 1, format?: string, filter?: string) =>
      filter
        ? formatMessagesForContext(getFilteredMessages(channelId, n, filter), format)
        : formatMessagesForContext(getMessages(channelId, n), format),
    response_ms: lastResponse > 0 ? now - lastResponse : Infinity,
    retry_ms: now - messageTime,
    idle_ms: retryIdleMs,
    unread_count: countUnreadMessages(channelId, entity.id),
    mentioned: false, // Retry is never from a mention
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false, // Retry is never self-triggered
    is_hologram: false, // Retry re-evaluates without original message context
    silent: false,
    interaction_type: "",
    name: entity.name,
    chars: allChannelEntities.map(e => e.name),
    channel: channelMeta,
    server: guildMeta,
    keywords: getEntityKeywords(entityId),
  });

  const evalDefaults = getEntityEvalDefaults(entityId);
  let result;
  try {
    result = evaluateFacts(facts, ctx, evalDefaults);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    warn("Fact evaluation failed during retry", {
      entity: entity.name,
      error: errorMsg,
    });

    // Notify all editors of the error (deduped by error message)
    const editors = getEditorsToNotify(entity.id, entity.owned_by, facts);
    if (editors.length > 0) {
      const count = recordEvalError(entity.id, editors[0], errorMsg);
      if (count <= 2) {
        const isRecurring = count === 2;
        for (const userId of editors) {
          notifyUserOfError(userId, entity.name, errorMsg, undefined, undefined, isRecurring).catch(() => {
            // DMs may fail if user has them disabled
          });
        }
      }
    }
    return;
  }

  // Handle chained $retry
  if (result.retryMs !== null && result.retryMs > 0) {
    const key = retryKey(channelId, entityId);
    debug("Scheduling chained entity retry", { entity: entity.name, retryMs: result.retryMs });
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      processEntityRetry(channelId, guildId, entityId, username, content, messageTime, allChannelEntities).catch(err => {
        error("Unhandled error in chained entity retry", err, { entity: entity.name, channelId });
      });
    }, result.retryMs);
    retryTimers.set(key, timer);
    return;
  }

  // Default for retry: respond if entity's name is mentioned in dialogue, or keyword match
  const defaultRespond = ctx.mentioned_in_dialogue(entity.name) || ctx.keyword_match;
  const shouldRespond = result.shouldRespond ?? defaultRespond;

  if (!shouldRespond) {
    debug("Entity not responding after retry", { entity: entity.name });
    return;
  }

  // Respond with just this entity (as EvaluatedEntity)
  const { modelSpec: resolvedModelSpecRetry, imageModelSpec: imageModelSpecRetry } = splitModelSpec(result.modelSpec, evalDefaults.modelSpec ?? null);
  await sendResponse(channelId, guildId, username, content, false, [{
    id: entity.id,
    name: entity.name,
    ownedBy: entity.owned_by ?? null,
    facts: result.facts,
    avatarUrl: result.avatarUrl,
    streamMode: result.streamMode,
    streamDelimiter: result.streamDelimiter,
    memoryScope: result.memoryScope,
    contextExpr: result.contextExpr,
    isFreeform: result.isFreeform,
    modelSpec: resolvedModelSpecRetry,
    imageModelSpec: imageModelSpecRetry,
    stripPatterns: result.stripPatterns,
    thinkingLevel: result.thinkingLevel,
    collapseMessages: result.collapseMessages,
    contentFilters: result.contentFilters,
    template: entity.template,
    systemTemplate: entity.system_template,
    exprContext: ctx,
  }], "retry");
}

async function processEntityTick(
  channelId: string,
  guildId: string | undefined,
  entityId: number,
) {
  const entity = getEntityWithFacts(entityId);
  if (!entity) return;

  const facts = entity.facts.map(f => f.content);
  const lastResponse = lastResponseTime.get(channelId) ?? 0;
  const now = Date.now();
  const lastTick = lastTickTime.get(entityId) ?? now;
  const tickElapsed = now - lastTick;

  const lastMsg = lastMessageTime.get(channelId) ?? 0;
  const tickIdleMs = lastMsg > 0 ? now - lastMsg : Infinity;

  const channelMeta = await getChannelMetadata(channelId);
  const guildMeta = guildId
    ? await getGuildMetadata(guildId)
    : { id: "", name: "", description: "", nsfw_level: "default" };

  const allChannelEntityIds = getChannelScopedEntities(channelId);
  const allChannelEntities: EntityWithFacts[] = allChannelEntityIds
    .map(id => getEntityWithFacts(id))
    .filter((e): e is EntityWithFacts => e !== null);

  const ctx = createBaseContext({
    facts,
    has_fact: (pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return facts.some(f => regex.test(f));
    },
    messages: (n = 1, format?: string, filter?: string) =>
      filter
        ? formatMessagesForContext(getFilteredMessages(channelId, n, filter), format)
        : formatMessagesForContext(getMessages(channelId, n), format),
    response_ms: lastResponse > 0 ? now - lastResponse : Infinity,
    retry_ms: tickElapsed,
    idle_ms: tickIdleMs,
    unread_count: countUnreadMessages(channelId, entity.id),
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    is_hologram: false,
    silent: false,
    interaction_type: "",
    name: entity.name,
    chars: allChannelEntities.map(e => e.name),
    channel: channelMeta,
    server: guildMeta,
    keywords: getEntityKeywords(entityId),
  });

  const tickEvalDefaults = getEntityEvalDefaults(entityId);
  let result;
  try {
    result = evaluateFacts(facts, ctx, tickEvalDefaults);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    warn("Fact evaluation failed during tick", { entity: entity.name, error: errorMsg });
    return;
  }

  // $tick entities default to not responding — must explicitly opt in via $respond
  const shouldRespond = result.shouldRespond ?? false;
  if (!shouldRespond) {
    debug("Entity not responding on tick", { entity: entity.name });
    return;
  }

  const { modelSpec: resolvedModelSpecTick, imageModelSpec: imageModelSpecTick } = splitModelSpec(result.modelSpec, tickEvalDefaults.modelSpec ?? null);
  const evaluated: EvaluatedEntity = {
    id: entity.id,
    name: entity.name,
    ownedBy: entity.owned_by ?? null,
    facts: result.facts,
    avatarUrl: result.avatarUrl,
    streamMode: result.streamMode,
    streamDelimiter: result.streamDelimiter,
    memoryScope: result.memoryScope,
    contextExpr: result.contextExpr,
    isFreeform: result.isFreeform,
    modelSpec: resolvedModelSpecTick,
    imageModelSpec: imageModelSpecTick,
    stripPatterns: result.stripPatterns,
    thinkingLevel: result.thinkingLevel,
    collapseMessages: result.collapseMessages,
    contentFilters: result.contentFilters,
    template: entity.template,
    systemTemplate: entity.system_template,
    exprContext: ctx,
  };

  await sendResponse(channelId, guildId, "", "", false, [evaluated], "tick");
}

function initTickTimers() {
  // Group channels by entity — one timer per entity, round-robins across channels
  const entityChannels = new Map<number, string[]>();
  for (const channelId of getAllBoundChannelIds()) {
    for (const entityId of getChannelScopedEntities(channelId)) {
      const list = entityChannels.get(entityId) ?? [];
      list.push(channelId);
      entityChannels.set(entityId, list);
    }
  }

  for (const [entityId, channels] of entityChannels) {
    if (tickTimers.has(entityId)) continue;
    const entity = getEntityWithFacts(entityId);
    if (!entity) continue;
    const facts = entity.facts.map(f => f.content);
    const tickMs = getTickInterval(facts);
    if (tickMs === null || tickMs <= 0) continue;

    debug("Starting tick timer", { entity: entity.name, channels, tickMs });
    tickChannels.set(entityId, channels);
    tickChannelIndex.set(entityId, 0);
    lastTickTime.set(entityId, Date.now());

    const timer = setInterval(() => {
      const chans = tickChannels.get(entityId) ?? [];
      if (chans.length === 0) return;
      const idx = tickChannelIndex.get(entityId) ?? 0;
      const channelId = chans[idx % chans.length];
      tickChannelIndex.set(entityId, idx + 1);
      lastTickTime.set(entityId, Date.now());
      processEntityTick(channelId, undefined, entityId).catch(err => {
        error("Unhandled error in entity tick", err, { entityId, channelId });
      });
    }, tickMs);
    tickTimers.set(entityId, timer);
  }
}

/** Helper to send a message (webhook or regular) and immediately track it */
async function sendStreamMessage(
  channelId: string,
  content: string,
  entity?: EvaluatedEntity
): Promise<string | null> {
  if (!content.trim()) return null;
  if (entity) {
    // Try webhook first
    const ids = await executeWebhook(channelId, content, entity.name, entity.avatarUrl ?? undefined);
    if (ids && ids[0]) {
      // Track immediately to prevent race condition with messageCreate
      trackOwnWebhookMessage(ids[0], entity.id, entity.name);
      return ids[0];
    }
    // Fall back to regular message with name prefix
    try {
      const sent = await bot.helpers.sendMessage(BigInt(channelId), {
        content: `**${entity.name}:** ${content}`,
      });
      // Bot messages skip messageCreate, store in history manually
      const storedStream = addMessage(channelId, sent.author.id.toString(), entity.name, content, sent.id.toString());
      if (storedStream) broadcastSSE(channelId, { type: "message", message: storedStream });
      return sent.id.toString();
    } catch (err) {
      error("Failed to send stream message", err);
      return null;
    }
  } else {
    // No entity - regular message
    try {
      const sent = await bot.helpers.sendMessage(BigInt(channelId), { content });
      // Bot messages skip messageCreate, store in history manually
      const authorName = sent.author.globalName ?? sent.author.username;
      const storedStreamMsg = addMessage(channelId, sent.author.id.toString(), authorName, content, sent.id.toString());
      if (storedStreamMsg) broadcastSSE(channelId, { type: "message", message: storedStreamMsg });
      return sent.id.toString();
    } catch (err) {
      error("Failed to send stream message", err);
      return null;
    }
  }
}

/** Helper to edit a message (webhook or regular) */
async function editStreamMessage(
  channelId: string,
  messageId: string,
  content: string,
  entity?: EvaluatedEntity
): Promise<boolean> {
  if (entity) {
    // Try webhook edit first
    const success = await editWebhookMessage(channelId, messageId, content);
    if (success) return true;
    // Fall back to regular edit with name prefix
    try {
      await bot.helpers.editMessage(BigInt(channelId), BigInt(messageId), {
        content: `**${entity.name}:** ${content}`,
      });
      return true;
    } catch {
      return false;
    }
  } else {
    // No entity - regular edit
    try {
      await bot.helpers.editMessage(BigInt(channelId), BigInt(messageId), { content });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Handle streaming response with different modes.
 */
async function handleStreamingResponse(
  channelId: string,
  entities: EvaluatedEntity[],
  streamMode: "lines" | "full",
  delimiter: string[] | undefined,
  ctx: {
    channelId: string;
    guildId?: string;
    userId: string;
    username: string;
    content: string;
    isMentioned: boolean;
    entityMemories?: Map<number, Array<{ content: string }>>;
    triggerEntityFn?: (entityId: number, verb: string, authorName: string) => Promise<void>;
    triggerType?: TriggerType;
    rateLimitOwnerIds?: Map<number, string | null>;
  }
): Promise<void> {
  const allMessageIds: string[] = [];

  // Track current message per entity (for editing in full mode)
  const entityMessages = new Map<string, { messageId: string; content: string }>();
  // Track entities that already sent messages via char_line/char_line_delta/char_line_end
  // so char_end doesn't duplicate them
  const charLinesSent = new Set<string>();
  // Single message for full mode
  let fullMessage: { messageId: string; content: string } | null = null;
  // Current line message for "lines full" mode
  let currentLineMessage: { messageId: string; content: string } | null = null;
  // Track current line messages per character for multi-char "lines full" mode
  const charLineMessages = new Map<string, { messageId: string; content: string }>();

  const isSingleEntity = entities.length === 1;
  const entity = isSingleEntity ? entities[0] : null;

  for await (const event of handleMessageStreaming({
    ...ctx,
    entities,
    streamMode,
    delimiter,
  })) {
    switch (event.type) {
      case "line": {
        // Single entity lines mode: new message per chunk
        if (entity) {
          const msgId = await sendStreamMessage(channelId, event.content, entity);
          if (msgId) allMessageIds.push(msgId);
        }
        break;
      }

      case "line_start": {
        // Single entity lines full mode: prepare for new line
        currentLineMessage = null;
        break;
      }

      case "line_delta": {
        // Single entity lines full mode: delta within current line
        if (entity) {
          if (currentLineMessage) {
            currentLineMessage.content = event.content;
            await editStreamMessage(channelId, currentLineMessage.messageId, event.content, entity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.content, entity);
            if (msgId) {
              currentLineMessage = { messageId: msgId, content: event.content };
              allMessageIds.push(msgId);
            }
          }
        }
        break;
      }

      case "line_end": {
        // Single entity lines full mode: finalize current line
        if (entity && currentLineMessage) {
          await editStreamMessage(channelId, currentLineMessage.messageId, event.content, entity);
          // Update DB — messageUpdate skips own messages
          updateMessageByDiscordId(currentLineMessage.messageId, event.content);
        } else if (entity && !currentLineMessage) {
          // Line was too short for delta, send final content
          const msgId = await sendStreamMessage(channelId, event.content, entity);
          if (msgId) allMessageIds.push(msgId);
        }
        currentLineMessage = null;
        break;
      }

      case "delta": {
        // Single entity full mode: edit or create message
        if (entity && streamMode === "full") {
          if (fullMessage) {
            fullMessage.content = event.fullContent;
            await editStreamMessage(channelId, fullMessage.messageId, event.fullContent, entity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.fullContent, entity);
            if (msgId) {
              fullMessage = { messageId: msgId, content: event.fullContent };
              allMessageIds.push(msgId);
            }
          }
        }
        break;
      }

      case "char_start": {
        // Multi-character: prepare for new character
        entityMessages.delete(event.name);
        charLineMessages.delete(event.name);
        charLinesSent.delete(event.name);
        break;
      }

      case "char_line": {
        // Multi-character lines mode: new line/chunk for this character
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          // New message per chunk
          const msgId = await sendStreamMessage(channelId, event.content, charEntity);
          if (msgId) {
            allMessageIds.push(msgId);
            charLinesSent.add(event.name);
          }
        }
        break;
      }

      case "char_line_start": {
        // Multi-character lines full mode: new line starting for character
        charLineMessages.delete(event.name);
        break;
      }

      case "char_line_delta": {
        // Multi-character lines full mode: delta within current line
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          const existing = charLineMessages.get(event.name);
          if (existing) {
            existing.content = event.content;
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) {
              charLineMessages.set(event.name, { messageId: msgId, content: event.content });
              allMessageIds.push(msgId);
              charLinesSent.add(event.name);
            }
          }
        }
        break;
      }

      case "char_line_end": {
        // Multi-character lines full mode: finalize current line
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          const existing = charLineMessages.get(event.name);
          if (existing) {
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
            // Update DB — messageUpdate skips own messages
            updateMessageByDiscordId(existing.messageId, event.content);
          } else {
            // Line was too short for delta, send final content
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) {
              allMessageIds.push(msgId);
              charLinesSent.add(event.name);
            }
          }
          charLineMessages.delete(event.name);
        }
        break;
      }

      case "char_delta": {
        // Multi-character full mode: delta update for this character
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity && streamMode === "full") {
          const existing = entityMessages.get(event.name);
          if (existing) {
            existing.content = event.content;
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) {
              entityMessages.set(event.name, { messageId: msgId, content: event.content });
              allMessageIds.push(msgId);
            }
          }
        }
        break;
      }

      case "char_end": {
        // Multi-character: finalize character response
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          const existing = entityMessages.get(event.name);
          if (existing) {
            // Final edit with complete content (full mode)
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
            // Update DB — messageUpdate skips own messages
            updateMessageByDiscordId(existing.messageId, event.content);
          } else if (event.content && !charLinesSent.has(event.name)) {
            // No message created yet via any path, create one
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) allMessageIds.push(msgId);
          }
        }
        charLinesSent.delete(event.name);
        break;
      }

      case "files": {
        const fileEntity = entity ?? entities[0];
        if (fileEntity) {
          const ids = await executeWebhook(channelId, "", fileEntity.name, fileEntity.avatarUrl ?? undefined, event.files);
          if (ids) {
            for (const id of ids) {
              trackOwnWebhookMessage(id, fileEntity.id, fileEntity.name);
              allMessageIds.push(id);
            }
          } else {
            await sendFallbackMessage(channelId, fileEntity.name, "", event.files);
          }
        }
        break;
      }

      case "tools_auto_disabled": {
        // Tool calls auto-disabled for this model — notify editors + bot owner
        const notifyEntity = entity ?? entities[0];
        if (notifyEntity) {
          notifyToolsAutoDisabled(event.modelSpec, notifyEntity).catch(() => {});
        }
        break;
      }

      case "done": {
        // Update single-entity full mode message with final content
        if (fullMessage) {
          updateMessageByDiscordId(fullMessage.messageId, fullMessage.content);
        }
        debug("Streaming complete", { fullTextLength: event.fullText.length });
        break;
      }
    }
  }

  // Track all messages for reply detection and record entity events
  if (allMessageIds.length > 0) {
    if (isSingleEntity && entity) {
      trackWebhookMessages(allMessageIds, entity.id, entity.name);
      recordEntityEvent(entity.id, ctx.rateLimitOwnerIds?.get(entity.id) ?? null, channelId, ctx.guildId ?? null, ctx.triggerType ?? "message");
    } else {
      // For multi-char, track per character
      for (const [name, msg] of entityMessages) {
        const charEntity = entities.find(e => e.name === name);
        if (charEntity) {
          trackOwnWebhookMessage(msg.messageId, charEntity.id, charEntity.name);
          recordEntityEvent(charEntity.id, ctx.rateLimitOwnerIds?.get(charEntity.id) ?? null, channelId, ctx.guildId ?? null, ctx.triggerType ?? "message");
        }
      }
    }
  }
}

export async function sendResponse(
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  isMentioned: boolean,
  respondingEntities?: EvaluatedEntity[],
  triggerType: TriggerType = "message"
) {
  // Apply rate limits before touching the LLM or typing indicator
  let rateLimitOwnerIds: Map<number, string | null> | undefined;
  if (respondingEntities && respondingEntities.length > 0) {
    const decision = checkRateLimits(channelId, guildId, respondingEntities);
    for (const denied of decision.denied) {
      if (shouldWarnRateLimit(denied.entity.id, denied.scope) && denied.ownerId) {
        notifyRateLimitWarn(denied.ownerId, denied.entity.name, denied.scope, denied.limit, channelId).catch(() => {});
      }
    }
    respondingEntities = decision.allow;
    rateLimitOwnerIds = decision.ownerIds;
    if (respondingEntities.length === 0) return;
  }

  // Start typing indicator
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  try {
    await bot.helpers.triggerTypingIndicator(BigInt(channelId));
    typingInterval = setInterval(async () => {
      try {
        await bot.helpers.triggerTypingIndicator(BigInt(channelId));
      } catch {
        // Ignore typing errors
      }
    }, 8000);
  } catch {
    // Ignore typing errors
  }

  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  // Handle message via LLM
  try {
    // Retrieve memories for entities that have memory enabled
    const entityMemories = new Map<number, Array<{ content: string }>>();
    if (respondingEntities) {
      // Get context-filtered messages for memory search (same messages the entity sees)
      const contextExpr = respondingEntities.find(e => e.contextExpr !== null)?.contextExpr ?? DEFAULT_CONTEXT_EXPR;
      const contextFilter = compileContextExpr(contextExpr);
      const rawMessages = getMessages(channelId, 100);
      const now = Date.now();
      const contextMessages: string[] = [];
      let totalChars = 0;

      for (const m of rawMessages) {
        const formatted = `${m.author_name}: ${m.content}`;
        const len = formatted.length + 1;
        const msgAge = now - new Date(m.created_at).getTime();
        const shouldInclude = contextFilter({
          chars: totalChars + len,
          count: contextMessages.length,
          age: msgAge,
          age_h: msgAge / 3_600_000,
          age_m: msgAge / 60_000,
          age_s: msgAge / 1000,
        });
        if (!shouldInclude && contextMessages.length > 0) break;
        contextMessages.push(m.content);
        totalChars += len;
      }

      for (const entity of respondingEntities) {
        if (entity.memoryScope !== "none") {
          const memories = await retrieveRelevantMemories(
            entity.id,
            contextMessages,
            entity.memoryScope as MemoryScope,
            channelId,
            guildId,
          );
          if (memories.length > 0) {
            entityMemories.set(entity.id, memories.map(m => ({ content: m.content })));
            debug("Retrieved memories", { entity: entity.name, count: memories.length });
          }
        }
      }
    }

    // Validate model allowlist
    const entityModelSpec = respondingEntities?.[0]?.modelSpec;
    if (entityModelSpec && !isModelAllowed(entityModelSpec)) {
      debug("Model not allowed", { model: entityModelSpec });
      // DM owner about blocked model
      const entity = respondingEntities?.[0];
      if (entity) {
        const entityData = getEntityWithFacts(entity.id);
        if (entityData) {
          const editors = getEditorsToNotify(entity.id, entityData.owned_by, entityData.facts.map(f => f.content));
          const errorMsg = `Model "${entityModelSpec}" is not in the allowed models list`;
          const count = recordEvalError(entity.id, editors[0] ?? "", errorMsg);
          if (count <= 2) {
            const isRecurring = count === 2;
            for (const uid of editors) {
              notifyUserOfError(uid, entity.name, errorMsg, undefined, undefined, isRecurring).catch(() => {});
            }
          }
        }
      }
      stopTyping();
      return;
    }

    // Build triggerEntityFn: fires another entity's pipeline with interaction_type set.
    // Used by the trigger_entity tool and /trigger <entity> <verb> (with persona).
    // IMPORTANT: do NOT wrap this in runOnChannel. triggerEntityFn is called from within
    // an LLM tool call that is already executing inside the channel's queue slot.
    // Re-queuing here would deadlock — the parent slot never releases while waiting for
    // a child slot that can never start.
    const triggerEntityFn = async (entityId: number, verb: string, authorName: string): Promise<void> => {
      // Guard against infinite chains
      const depth = responseChainDepth.get(channelId) ?? 0;
      const triggerChainLimit = resolveChainLimit(channelId, guildId) ?? MAX_RESPONSE_CHAIN_DEFAULT;
      if (depth >= triggerChainLimit) {
        debug("trigger_entity blocked by chain depth", { channelId, depth, max: triggerChainLimit });
        return;
      }

      const targetEntity = getEntityWithFacts(entityId);
      if (!targetEntity) {
        debug("trigger_entity: entity not found", { entityId });
        return;
      }

      const facts = targetEntity.facts.map(f => f.content);
      const channelEntityNames = getChannelScopedEntities(channelId)
        .map(id => getEntity(id)?.name ?? "")
        .filter(Boolean);
      const [channelMeta, guildMeta] = await Promise.all([
        getChannelMetadata(channelId),
        guildId ? getGuildMetadata(guildId) : Promise.resolve({ id: "", name: "", description: "", nsfw_level: "default" as const }),
      ]);

      const ctx = createBaseContext({
        facts,
        has_fact: (pattern: string) => {
          const regex = new RegExp(pattern, "i");
          return facts.some(f => regex.test(f));
        },
        messages: (n = 1, format?: string, filter?: string) =>
          filter
            ? formatMessagesForContext(getFilteredMessages(channelId, n, filter), format)
            : formatMessagesForContext(getMessages(channelId, n), format),
        response_ms: 0,
        retry_ms: 0,
        idle_ms: 0,
        unread_count: 0,
        mentioned: true,
        replied: false,
        replied_to: "",
        is_forward: false,
        is_self: false,
        is_hologram: true,
        silent: false,
        interaction_type: verb,
        name: targetEntity.name,
        chars: channelEntityNames,
        channel: channelMeta,
        server: guildMeta,
        keywords: getEntityKeywords(targetEntity.id),
      });

      const triggerEvalDefaults = getEntityEvalDefaults(targetEntity.id);
      let triggerResult;
      try {
        triggerResult = evaluateFacts(facts, ctx, triggerEvalDefaults);
      } catch (err) {
        warn("trigger_entity: fact evaluation failed", { entity: targetEntity.name, error: String(err) });
        return;
      }

      debug("trigger_entity firing", { target: targetEntity.name, verb, author: authorName });

      const { modelSpec: resolvedModelSpecTrigger, imageModelSpec: imageModelSpecTrigger } = splitModelSpec(triggerResult.modelSpec, triggerEvalDefaults.modelSpec ?? null);
      await sendResponse(channelId, guildId, authorName, "", true, [{
        id: targetEntity.id,
        name: targetEntity.name,
        ownedBy: targetEntity.owned_by ?? null,
        facts: triggerResult.facts,
        avatarUrl: triggerResult.avatarUrl,
        streamMode: triggerResult.streamMode,
        streamDelimiter: triggerResult.streamDelimiter,
        memoryScope: triggerResult.memoryScope,
        contextExpr: triggerResult.contextExpr,
        isFreeform: triggerResult.isFreeform,
        modelSpec: resolvedModelSpecTrigger,
        imageModelSpec: imageModelSpecTrigger,
        stripPatterns: triggerResult.stripPatterns,
        thinkingLevel: triggerResult.thinkingLevel,
        collapseMessages: triggerResult.collapseMessages,
        contentFilters: triggerResult.contentFilters,
        template: targetEntity.template,
        systemTemplate: targetEntity.system_template,
        exprContext: ctx,
      }], "slash_trigger");
    };

    // Check for streaming mode
    const streamMode = respondingEntities?.[0]?.streamMode;
    const useStreaming = streamMode && respondingEntities && respondingEntities.length > 0;

    if (useStreaming) {
      const streamEntities = respondingEntities!;
      const streamDelimiter = streamEntities[0]?.streamDelimiter ?? undefined;
      debug("Using streaming mode", { mode: streamMode, delimiter: streamDelimiter, entities: streamEntities.map(e => e.name) });

      // Stop typing - we'll be sending messages as we stream
      stopTyping();

      try {
        await handleStreamingResponse(channelId, streamEntities, streamMode, streamDelimiter, {
          channelId,
          guildId,
          userId: "",
          username,
          content,
          isMentioned,
          entityMemories,
          triggerEntityFn,
          triggerType,
          rateLimitOwnerIds,
        });

        // Mark response time
        lastResponseTime.set(channelId, Date.now());
        return;
      } catch (streamErr) {
        // InferenceError = model/content issue, don't retry with non-streaming
        if (streamErr instanceof InferenceError) throw streamErr;
        // Template errors (ExprError) won't be fixed by retrying without streaming
        if (streamErr instanceof ExprError) throw streamErr;
        warn("Streaming failed, falling back to non-streaming", {
          error: streamErr instanceof Error ? streamErr.message : String(streamErr),
        });
        // Fall through to non-streaming path below
      }
    }

    // Non-streaming path
    const result = await handleMessage({
      channelId,
      guildId,
      userId: "",
      username,
      content,
      isMentioned,
      respondingEntities,
      entityMemories,
      triggerEntityFn,
    });

    // Mark response time
    lastResponseTime.set(channelId, Date.now());

    if (!result) {
      stopTyping();
      return;
    }

    // Notify if tool calls were auto-disabled for this model
    if (result.toolsAutoDisabledForModel && respondingEntities && respondingEntities.length > 0) {
      notifyToolsAutoDisabled(result.toolsAutoDisabledForModel, respondingEntities[0]).catch(() => {});
    }

    // Stop typing before sending response (indicator will expire naturally)
    stopTyping();

    // Use webhooks when we have responding entities (custom name/avatar)
    if (respondingEntities && respondingEntities.length > 0) {
      if (result.entityResponses && result.entityResponses.length > 0) {
        // Multiple entities: send separate webhook message for each
        // Files go on the first entity's message only
        for (let i = 0; i < result.entityResponses.length; i++) {
          const entityResponse = result.entityResponses[i];
          // Find the entity for this response
          const entity = respondingEntities.find(e => e.name === entityResponse.name);
          const messageIds = await executeWebhook(
            channelId,
            entityResponse.content,
            entityResponse.name,
            entityResponse.avatarUrl,
            i === 0 ? result.files : undefined
          );
          if (messageIds && entity) {
            trackWebhookMessages(messageIds, entity.id, entity.name);
            recordEntityEvent(entity.id, rateLimitOwnerIds?.get(entity.id) ?? null, channelId, guildId ?? null, triggerType);
          } else if (!messageIds) {
            await sendFallbackMessage(channelId, entityResponse.name, entityResponse.content, i === 0 ? result.files : undefined);
          }
        }
      } else {
        // Single entity: send via webhook with entity's name
        const entity = respondingEntities[0];
        const messageIds = await executeWebhook(
          channelId,
          result.response,
          entity.name,
          entity.avatarUrl ?? undefined,
          result.files
        );
        if (messageIds) {
          trackWebhookMessages(messageIds, entity.id, entity.name);
          recordEntityEvent(entity.id, rateLimitOwnerIds?.get(entity.id) ?? null, channelId, guildId ?? null, triggerType);
        } else {
          await sendFallbackMessage(channelId, entity.name, result.response, result.files);
        }
      }
    } else {
      // No entities - use regular message
      await sendRegularMessage(channelId, result.response);
    }
  } catch (err) {
    if (err instanceof InferenceError) {
      // DM owner + editors about LLM error
      const entity = respondingEntities?.[0];
      if (entity) {
        const entityData = getEntityWithFacts(entity.id);
        if (entityData) {
          const editors = getEditorsToNotify(entity.id, entityData.owned_by, entityData.facts.map(f => f.content));
          const blockReason = extractBlockReason(err.cause);
          const errorMsg = `LLM error with model "${err.modelSpec}": ${err.message}${blockReason ? ` (${blockReason})` : ""}`;
          const count = recordEvalError(entity.id, editors[0] ?? "", errorMsg);
          if (count <= 2) {
            const isRecurring = count === 2;
            for (const uid of editors) {
              notifyUserOfError(uid, entity.name, errorMsg, "LLM error", `Check the model config with \`/edit ${entity.name} type:config\`.`, isRecurring).catch(() => {});
            }
          }
        }
      }
    } else if (err instanceof ExprError) {
      // Template/expression error — DM owner + editors so they can fix it
      error("Template error in sendResponse", err);
      const entity = respondingEntities?.[0];
      if (entity) {
        const entityData = getEntityWithFacts(entity.id);
        if (entityData) {
          const editors = getEditorsToNotify(entity.id, entityData.owned_by, entityData.facts.map(f => f.content));
          const errorMsg = err.message;
          const count = recordEvalError(entity.id, editors[0] ?? "", errorMsg);
          if (count <= 2) {
            const isRecurring = count === 2;
            for (const uid of editors) {
              notifyUserOfError(uid, entity.name, errorMsg, undefined, undefined, isRecurring).catch(() => {});
            }
          }
        }
      }
    } else {
      error("Unexpected error in sendResponse", err);
    }
  } finally {
    // Safety net - ensure typing is stopped even on error
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

/** Send a regular message (no webhook) and track for reply detection.
 * Stores in message history since bot messages bypass messageCreate. */
async function sendRegularMessage(channelId: string, content: string): Promise<void> {
  if (!content.trim()) return;
  try {
    const sent = await bot.helpers.sendMessage(BigInt(channelId), { content });
    trackBotMessage(sent.id);
    // Bot messages skip messageCreate (filtered by botUserId check),
    // so store in history manually for LLM context
    const authorName = sent.author.globalName ?? sent.author.username;
    const storedMsg = addMessage(channelId, sent.author.id.toString(), authorName, content, sent.id.toString());
    if (storedMsg) broadcastSSE(channelId, { type: "message", message: storedMsg });
  } catch (err) {
    error("Failed to send message", err);
  }
}

/** Send fallback message with character name prefix.
 * Stores in message history since bot messages bypass messageCreate. */
async function sendFallbackMessage(channelId: string, name: string, content: string, files?: GeneratedFile[]): Promise<void> {
  if (!content.trim() && (!files || files.length === 0)) return;
  try {
    const discordFiles = files?.map((f, i) => {
      const ext = f.mediaType.split("/")[1] ?? "png";
      return { blob: new Blob([f.data], { type: f.mediaType }), name: `image_${i + 1}.${ext}` };
    });
    const sent = await bot.helpers.sendMessage(BigInt(channelId), {
      content: content.trim() ? `**${name}:** ${content}` : undefined,
      files: discordFiles,
    });
    trackBotMessage(sent.id);
    // Bot messages skip messageCreate (filtered by botUserId check),
    // so store in history manually for LLM context
    const storedFallback = addMessage(channelId, sent.author.id.toString(), name, content, sent.id.toString());
    if (storedFallback) broadcastSSE(channelId, { type: "message", message: storedFallback });
  } catch (err) {
    error("Failed to send fallback message", err);
  }
}

/** Track bot message ID for reply detection */
function trackBotMessage(messageId: bigint): void {
  botMessageIds.add(messageId.toString());
  if (botMessageIds.size > MAX_BOT_MESSAGES) {
    const iter = botMessageIds.values();
    for (let i = 0; i < MAX_BOT_MESSAGES / 2; i++) {
      const v = iter.next().value;
      if (v) botMessageIds.delete(v);
    }
  }
}

/** Track webhook message IDs with entity association for reply detection and recursion limit */
function trackWebhookMessages(messageIds: string[], entityId: number, entityName: string): void {
  for (const id of messageIds) {
    trackOwnWebhookMessage(id, entityId, entityName);
  }
}

async function sendWelcomeDm(userId: bigint): Promise<void> {
  // Get the help:start entity content
  const helpEntity = getSystemEntity("help:start");
  if (!helpEntity) {
    debug("No help:start entity found for welcome DM");
    return;
  }

  const facts = getFactsForEntity(helpEntity.id);
  const content = facts
    .map(f => f.content)
    .filter(c => !c.startsWith("is ") && c !== "---")
    .join("\n");

  if (!content) return;

  // Create DM channel and send
  const dmChannel = await bot.helpers.getDmChannel(userId);
  await bot.helpers.sendMessage(dmChannel.id, {
    content: `**Welcome to Hologram!**\n\n${content}`,
  });

  debug("Sent welcome DM", { userId: userId.toString() });
}

/**
 * Get all user IDs that should be notified of errors for an entity.
 * Includes owner + anyone in the $edit list (but not "@everyone").
 */
function getEditorsToNotify(entityId: number, ownerId: string | null, facts: string[]): string[] {
  const editors = new Set<string>();

  if (ownerId) {
    editors.add(ownerId);
  }

  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entityId));
  if (Array.isArray(permissions.editList)) {
    for (const userId of permissions.editList) {
      editors.add(userId);
    }
  }

  return [...editors];
}

/** Walk the error cause chain looking for a Google promptFeedback blockReason. */
function extractBlockReason(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  const val = e["value"];
  if (val && typeof val === "object") {
    const pf = (val as Record<string, unknown>)["promptFeedback"];
    if (pf && typeof pf === "object") {
      const br = (pf as Record<string, unknown>)["blockReason"];
      if (typeof br === "string") return br;
    }
  }
  return extractBlockReason(e["cause"]);
}

async function notifyUserOfError(
  userId: string,
  entityName: string,
  errorMsg: string,
  title = "Condition error",
  suggestion = `Use \`/edit ${entityName}\` to fix the condition.`,
  isRecurring = false,
): Promise<void> {
  try {
    const dmChannel = await bot.helpers.getDmChannel(BigInt(userId));
    const heading = isRecurring ? `Recurring ${title.toLowerCase()}` : title;
    const footer = isRecurring
      ? `\n\n_This error has recurred. Further occurrences will be suppressed until the facts are edited or \`/debug\` clears the state._`
      : "";
    await bot.helpers.sendMessage(dmChannel.id, {
      content: `**${heading} in ${entityName}**\n\`\`\`\n${errorMsg}\n\`\`\`\n${suggestion}${footer}`,
    });
    debug("Sent error DM", { userId, entityName, isRecurring });
  } catch (err) {
    warn("Failed to send error DM", { userId, entityName, err });
  }
}

async function notifyRateLimitWarn(
  ownerId: string,
  entityName: string,
  scope: "entity" | "owner" | "channel",
  limit: number,
  channelId: string,
): Promise<void> {
  const scopeLabel = scope === "entity" ? "per-entity" : scope === "owner" ? "per-owner" : "per-channel";
  const configHint = scope === "entity"
    ? `Raise the limit with \`/edit ${entityName} type:advanced\` or reduce the entity's \`$respond\` directives.`
    : `Raise the limit with \`/admin config rate\` in the affected channel.`;
  try {
    const dmChannel = await bot.helpers.getDmChannel(BigInt(ownerId));
    await bot.helpers.sendMessage(dmChannel.id, {
      content: `**Rate limit hit for ${entityName}**\nYour entity *${entityName}* hit the ${scopeLabel} rate limit (${limit}/min) in <#${channelId}>. Its response was dropped.\n${configHint}`,
    });
    debug("Sent rate-limit DM", { ownerId, entityName, scope, limit });
  } catch (err) {
    warn("Failed to send rate-limit DM", { ownerId, entityName, err });
  }
}

/**
 * Notify entity editors + bot owner that tool calls have been auto-disabled for a model.
 * Uses the eval_errors dedup table to prevent repeated DMs.
 */
async function notifyToolsAutoDisabled(modelSpec: string, entity: EvaluatedEntity): Promise<void> {
  const entityData = getEntityWithFacts(entity.id);
  if (!entityData) return;

  const editors = getEditorsToNotify(entity.id, entityData.owned_by, entityData.facts.map(f => f.content));
  const ownerIds = await getBotOwnerIds();

  // Merge editors + bot owner, deduplicated
  const allRecipients = [...new Set([...editors, ...ownerIds])];

  const errorMsg = `Tool calls auto-disabled for model "${modelSpec}" (model does not support function calling)`;
  // One-shot notification — the message states the change is permanent, so further DMs add no info.
  const count = recordEvalError(entity.id, allRecipients[0] ?? "", errorMsg);
  if (count !== 1) return;

  for (const uid of allRecipients) {
    try {
      const dmChannel = await bot.helpers.getDmChannel(BigInt(uid));
      await bot.helpers.sendMessage(dmChannel.id, {
        content: `**Tool calls auto-disabled for \`${modelSpec}\`**\nThe model \`${modelSpec}\` (used by **${entity.name}**) does not support function calling. Tool calls have been permanently disabled for this model — responses will continue without tools.`,
      });
      debug("Sent tools-disabled DM", { uid, modelSpec, entity: entity.name });
    } catch (err) {
      warn("Failed to send tools-disabled DM", { uid, modelSpec, err });
    }
  }
}

bot.events.messageUpdate = async (message) => {
  // Ignore own messages
  if (botUserId && message.author?.id === botUserId) return;

  const discordMessageId = message.id.toString();

  // Skip own webhook messages
  if (isOwnWebhookMessage(discordMessageId)) return;

  // Build updated data blob if embeds or components arrived
  const hasEmbeds = (message.embeds?.length ?? 0) > 0;
  const hasComponents = (message.components?.length ?? 0) > 0;
  let newData: MessageData | undefined;
  if (hasEmbeds || hasComponents) {
    newData = {};
    if (hasEmbeds) newData.embeds = message.embeds!.map(serializeEmbed);
    if (hasComponents) newData.components = serializeComponents(message.components!);
  }

  // Skip if no content and no data to update
  if (!message.content && !newData) return;

  const content = message.content ?? "";
  const updated = updateMessageByDiscordId(discordMessageId, content, newData);
  if (updated) {
    debug("Message updated", {
      messageId: discordMessageId,
      content: content.slice(0, 50),
      hasEmbeds,
    });
  } else if (message.channelId && message.author) {
    // Message wasn't stored on CREATE (e.g., bot embed-only message) — insert it now
    const authorName = message.author.globalName ?? message.author.username;
    const authorId = message.author.id.toString();
    const channelId = message.channelId.toString();
    const isBot = !!message.author.toggles?.bot;
    const msgData: MessageData = {};
    if (isBot) msgData.is_bot = true;
    if (newData) Object.assign(msgData, newData);
    const hasData = Object.keys(msgData).length > 0;
    addMessage(channelId, authorId, authorName, content, discordMessageId, hasData ? msgData : undefined);
    debug("Created message from edit update", {
      messageId: discordMessageId,
      content: content.slice(0, 50),
      hasEmbeds,
    });
  }
};

bot.events.messageDelete = async (payload) => {
  const discordMessageId = payload.id.toString();
  const deleted = deleteMessageByDiscordId(discordMessageId);
  if (deleted) {
    debug("Message deleted from history", { messageId: discordMessageId });
  }
};

bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

// Override MESSAGE_UPDATE gateway handler to also capture embed-only updates.
// Discordeno's default handler filters out events without edited_timestamp,
// which silently drops embeds added by Discord (URL previews, late bot embeds).
const origMessageUpdateHandler = bot.handlers.MESSAGE_UPDATE;
bot.handlers.MESSAGE_UPDATE = (bot, data, shardId) => {
  const payload = data.d as DiscordMessage;

  // If it has edited_timestamp, use the default handler (handles full edits)
  if (payload.edited_timestamp) {
    return origMessageUpdateHandler(bot, data, shardId);
  }

  // For non-edit updates: capture embed data directly from the raw payload
  // (Components v2 arrive in initial MESSAGE_CREATE, not via late updates)
  if (payload.embeds?.length && payload.id) {
    const messageId = payload.id;
    if (isOwnWebhookMessage(messageId)) return;
    // Skip bot's own non-webhook messages (e.g. interaction responses that get URL-preview updates)
    if (botUserId && payload.author?.id === botUserId.toString()) return;

    const serialized = payload.embeds.map(serializeDiscordEmbed);
    if (serialized.length > 0) {
      const updated = mergeMessageData(messageId, { embeds: serialized });
      if (updated) {
        debug("Embed-only update captured", { messageId, embedCount: serialized.length });
      } else if (payload.channel_id && payload.author) {
        // Message wasn't stored yet — insert from the raw payload
        const authorName = payload.author.global_name ?? payload.author.username;
        const msgData: MessageData = { embeds: serialized };
        if (payload.author.bot) msgData.is_bot = true;
        addMessage(
          payload.channel_id,
          payload.author.id,
          authorName,
          payload.content ?? "",
          messageId,
          msgData,
        );
        debug("Created message from embed-only update", { messageId, embedCount: serialized.length });
      }
    }
  }
};

export async function startBot() {
  info("Starting bot");
  setBotBridge(async (channelId: string, content: string, authorName?: string, avatarUrl?: string) => {
    if (authorName) {
      // Try webhook first (sends with proper username/avatar)
      const ids = await executeWebhook(channelId, content, authorName, avatarUrl);
      if (ids) return;
      // Fall back to prefixed regular message if webhook unavailable
    }
    await bot.helpers.sendMessage(BigInt(channelId), { content });
  });
  await bot.start();
}
