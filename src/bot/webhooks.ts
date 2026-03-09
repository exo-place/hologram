import { getDb } from "../db";
import { debug, error } from "../logger";
import type { GeneratedFile } from "../ai/handler";
import type { bot as botInstance } from "./client";

interface CachedWebhook {
  webhookId: string;
  webhookToken: string;
}

// In-memory cache for hot path
const webhookCache = new Map<string, CachedWebhook>();

// Default avatar when entity doesn't have $avatar
const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

// Bot instance set by client.ts to avoid circular import
let bot: typeof botInstance | null = null;

export function setBot(b: typeof botInstance): void {
  bot = b;
}

// Thread channel types in Discord
const THREAD_TYPES = new Set([
  11, // PUBLIC_THREAD
  12, // PRIVATE_THREAD
  10, // NEWS_THREAD (announcement thread)
]);

// Channel types that don't support webhooks
const NO_WEBHOOK_TYPES = new Set([
  1, // DM
  3, // GROUP_DM
]);

/**
 * Resolve a channel to its webhook-capable parent if it's a thread.
 * Returns { webhookChannelId, threadId } where threadId is set if original was a thread.
 */
async function resolveWebhookChannel(
  channelId: string
): Promise<{ webhookChannelId: string; threadId: string | null } | null> {
  if (!bot) return null;
  try {
    const channel = await bot.helpers.getChannel(BigInt(channelId));
    debug("Resolving webhook channel", {
      channelId,
      channelType: channel?.type,
      parentId: channel?.parentId?.toString(),
      isThread: channel ? THREAD_TYPES.has(channel.type) : false,
      channelKeys: channel ? Object.keys(channel) : null,
    });
    if (channel && NO_WEBHOOK_TYPES.has(channel.type)) {
      debug("Channel does not support webhooks (DM/Group DM)", { channelId, channelType: channel.type });
      return null;
    }
    if (channel && THREAD_TYPES.has(channel.type) && channel.parentId) {
      debug("Channel is thread, using parent", {
        threadId: channelId,
        webhookChannelId: channel.parentId.toString(),
      });
      return {
        webhookChannelId: channel.parentId.toString(),
        threadId: channelId,
      };
    }
    return { webhookChannelId: channelId, threadId: null };
  } catch (err) {
    error("Failed to resolve channel", err, { channelId });
    return null;
  }
}

/**
 * Get or create a webhook for a channel.
 * Returns null if webhook creation fails (permissions, etc.)
 */
export async function getOrCreateWebhook(channelId: string): Promise<CachedWebhook | null> {
  if (!bot) {
    error("Bot not initialized for webhooks");
    return null;
  }
  // Check memory cache first
  const cached = webhookCache.get(channelId);
  if (cached) {
    debug("Using cached webhook", { channelId, webhookId: cached.webhookId });
    return cached;
  }

  // Check database
  const db = getDb();
  const row = db.prepare(`
    SELECT webhook_id, webhook_token FROM webhooks WHERE channel_id = ?
  `).get(channelId) as { webhook_id: string; webhook_token: string } | null;

  if (row) {
    const webhook = { webhookId: row.webhook_id, webhookToken: row.webhook_token };
    webhookCache.set(channelId, webhook);
    return webhook;
  }

  // Create new webhook
  debug("Attempting to create/find webhook", { channelId });
  try {
    // Check if we can find an existing Hologram webhook
    const existingWebhooks = await bot.helpers.getChannelWebhooks(BigInt(channelId));
    const ours = existingWebhooks.find((w: { name?: string }) => w.name === "Hologram");

    if (ours && ours.token) {
      const webhook = { webhookId: ours.id.toString(), webhookToken: ours.token };
      db.prepare(`
        INSERT INTO webhooks (channel_id, webhook_id, webhook_token)
        VALUES (?, ?, ?)
      `).run(channelId, webhook.webhookId, webhook.webhookToken);
      webhookCache.set(channelId, webhook);
      debug("Found existing webhook", { channelId, webhookId: webhook.webhookId });
      return webhook;
    }

    // Create new webhook
    const created = await bot.helpers.createWebhook(BigInt(channelId), {
      name: "Hologram",
    });

    if (!created.token) {
      error("Webhook created without token", { channelId });
      return null;
    }

    const webhook = { webhookId: created.id.toString(), webhookToken: created.token };
    db.prepare(`
      INSERT INTO webhooks (channel_id, webhook_id, webhook_token)
      VALUES (?, ?, ?)
    `).run(channelId, webhook.webhookId, webhook.webhookToken);
    webhookCache.set(channelId, webhook);

    debug("Created webhook", { channelId, webhookId: webhook.webhookId });
    return webhook;
  } catch (err: unknown) {
    const allProps: Record<string, unknown> = {};
    if (err && typeof err === "object") {
      for (const key of Object.getOwnPropertyNames(err)) {
        allProps[key] = (err as Record<string, unknown>)[key];
      }
    }
    error("Failed to create webhook", err, { errorProps: allProps, channelId });
    return null;
  }
}

// Discord's max message length
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Sanitize username for Discord webhook.
 * Discord forbids "discord" (case-insensitive) in webhook usernames.
 */
function sanitizeUsername(username: string): string {
  // Replace "discord" with "d_scord" (case-insensitive, preserving case)
  return username.replace(/discord/gi, (match) => {
    // Preserve the case pattern: replace 'i' with '_'
    return match[0] + "_" + match.slice(2);
  });
}

/**
 * Split content into chunks that fit Discord's message limit.
 * Tries to split at newlines or spaces when possible.
 */
function splitContent(content: string): string[] {
  if (content.length <= MAX_MESSAGE_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (newline or space)
    let splitAt = MAX_MESSAGE_LENGTH;
    const lastNewline = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    const lastSpace = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);

    if (lastNewline > MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = lastNewline + 1; // Include the newline in current chunk
    } else if (lastSpace > MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = lastSpace + 1; // Include the space in current chunk
    }

    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Execute webhook with custom username and avatar.
 * Returns array of sent message IDs on success, null on failure.
 * Automatically splits long messages into multiple webhook calls.
 * Files (if provided) are attached to the first chunk only.
 */
export async function executeWebhook(
  channelId: string,
  content: string,
  username: string,
  avatarUrl?: string,
  files?: GeneratedFile[]
): Promise<string[] | null> {
  if (!bot) {
    error("Bot not initialized for webhooks");
    return null;
  }

  const hasFiles = files && files.length > 0;
  if (!content.trim() && !hasFiles) {
    debug("Skipping webhook execution for blank content");
    return null;
  }

  // Resolve thread to parent channel if needed
  const resolved = await resolveWebhookChannel(channelId);
  if (!resolved) return null;

  const { webhookChannelId, threadId } = resolved;

  const webhook = await getOrCreateWebhook(webhookChannelId);
  if (!webhook) return null;

  // Sanitize username (Discord forbids "discord" in webhook usernames)
  const safeUsername = sanitizeUsername(username);

  // Split content if too long (empty content treated as single empty chunk for files-only)
  const chunks = content.trim() ? splitContent(content) : [""];

  // Convert GeneratedFile[] to Discordeno FileContent[]
  const discordFiles = files?.map((f, i) => {
    const ext = f.mediaType.split("/")[1] ?? "png";
    return {
      blob: new Blob([f.data], { type: f.mediaType }),
      name: `image_${i + 1}.${ext}`,
    };
  });

  debug("Executing webhook", {
    webhookId: webhook.webhookId,
    webhookChannelId,
    threadId,
    username: safeUsername,
    contentLength: content.length,
    chunks: chunks.length,
    hasAvatar: !!avatarUrl,
    avatarUrl: avatarUrl ?? DEFAULT_AVATAR,
    fileCount: discordFiles?.length ?? 0,
    contentPreview: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
  });

  try {
    const messageIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Attach files to first chunk only
      const chunkFiles = i === 0 && discordFiles?.length ? discordFiles : undefined;
      const payload: Record<string, unknown> = {
        username: safeUsername,
        avatarUrl: avatarUrl ?? DEFAULT_AVATAR,
        wait: true,
        ...(threadId ? { threadId: BigInt(threadId) } : {}),
      };
      // Only include content if non-empty (files-only sends have empty content)
      if (chunk) payload.content = chunk;

      let messageId: string | undefined;
      if (chunkFiles) {
        // Discordeno's helpers.executeWebhook doesn't pass files at the request level,
        // so multipart form data is never used. Use bot.rest.post directly so files
        // are sent alongside payload_json in proper multipart encoding.
        const route = bot!.rest.routes.webhooks.webhook(
          BigInt(webhook.webhookId),
          webhook.webhookToken,
          { wait: true, ...(threadId ? { threadId: BigInt(threadId) } : {}) },
        );
        // bot.rest.post is typed as void but actually returns the raw Discord response
        const rawResult: unknown = await bot!.rest.post(route, { body: payload, files: chunkFiles, unauthorized: true });
        if (rawResult && typeof rawResult === "object" && "id" in rawResult) {
          messageId = String((rawResult as { id: unknown }).id);
        }
      } else {
        const result = await bot!.helpers.executeWebhook(
          BigInt(webhook.webhookId),
          webhook.webhookToken,
          payload
        );
        if (result?.id) messageId = result.id.toString();
      }
      if (messageId) {
        messageIds.push(messageId);
      }
      debug("Webhook chunk sent", { chunk: i + 1, of: chunks.length, messageId });
    }
    debug("Webhook executed successfully", { messageIds });
    return messageIds;
  } catch (err: unknown) {
    // Try to extract all properties from the error
    const allProps: Record<string, unknown> = {};
    if (err && typeof err === "object") {
      for (const key of Object.getOwnPropertyNames(err)) {
        allProps[key] = (err as Record<string, unknown>)[key];
      }
    }
    error("Failed to execute webhook", err, {
      errorProps: allProps,
      channelId,
      webhookChannelId,
      threadId,
      webhookId: webhook.webhookId,
      username: safeUsername,
      avatarUrl: avatarUrl ?? DEFAULT_AVATAR,
      contentLength: content.length,
      contentPreview: content.slice(0, 200) + (content.length > 200 ? "..." : ""),
    });
    // Webhook may have been deleted - clear cache and try once more
    webhookCache.delete(webhookChannelId);
    const db = getDb();
    db.prepare(`DELETE FROM webhooks WHERE channel_id = ?`).run(webhookChannelId);
    return null;
  }
}

/**
 * Clear webhook cache entry (e.g., when webhook is deleted externally).
 */
export function clearWebhookCache(channelId: string): void {
  webhookCache.delete(channelId);
  const db = getDb();
  db.prepare(`DELETE FROM webhooks WHERE channel_id = ?`).run(channelId);
}

/**
 * Edit an existing webhook message.
 * Returns true on success, false on failure.
 */
export async function editWebhookMessage(
  channelId: string,
  messageId: string,
  content: string
): Promise<boolean> {
  if (!bot) {
    error("Bot not initialized for webhooks");
    return false;
  }

  // Resolve thread to parent channel if needed
  const resolved = await resolveWebhookChannel(channelId);
  if (!resolved) return false;

  const { webhookChannelId, threadId } = resolved;

  const webhook = await getOrCreateWebhook(webhookChannelId);
  if (!webhook) return false;

  debug("Editing webhook message", {
    webhookId: webhook.webhookId,
    messageId,
    contentLength: content.length,
  });

  try {
    await bot.helpers.editWebhookMessage(
      BigInt(webhook.webhookId),
      webhook.webhookToken,
      BigInt(messageId),
      {
        content,
        ...(threadId ? { threadId: BigInt(threadId) } : {}),
      }
    );
    return true;
  } catch (err) {
    error("Failed to edit webhook message", err, { messageId, channelId });
    return false;
  }
}
