import { createBot, Intents } from "@discordeno/bot";
import { info, debug, error } from "../logger";
import { registerCommands, handleInteraction } from "./commands";
import { handleMessage } from "../ai/handler";
import { resolveDiscordEntity, isNewUser, markUserWelcomed, addMessage } from "../db/discord";
import { getEntity, getEntityWithFacts, getSystemEntity, getFactsForEntity } from "../db/entities";
import { evaluateFacts, createBaseContext } from "../logic/expr";
import "./commands/commands"; // Register all commands
import { ensureHelpEntities } from "./commands/commands";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN environment variable is required");
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
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
      messageReference: true as const,
      messageSnapshots: true as const,
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
    guild: {
      id: true,
      name: true,
    },
  },
});

let botUserId: bigint | null = null;

// Track last response time per channel (for dt_ms in expressions)
const lastResponseTime = new Map<string, number>();

// Pending retry timers per channel
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Message deduplication
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

// Track bot-sent message IDs (for reply detection)
const botMessageIds = new Set<string>();
const MAX_BOT_MESSAGES = 1000;

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
};

bot.events.messageCreate = async (message) => {
  // Ignore own messages
  if (botUserId && message.author.id === botUserId) return;
  if (!message.content) return;
  if (!markProcessed(message.id)) return;

  // mentionedUserIds is unreliable in Discordeno, parse from content as fallback
  const isMentioned = botUserId !== null && (
    message.mentionedUserIds?.includes(botUserId) ||
    message.content.includes(`<@${botUserId}>`)
  );
  const channelId = message.channelId.toString();
  const guildId = message.guildId?.toString();
  const messageTime = Date.now();

  // Detect reply to bot and forwarded messages
  const messageRef = message.messageReference;
  const isReplied = messageRef?.messageId
    ? botMessageIds.has(messageRef.messageId.toString())
    : false;
  // Forwarded messages have messageSnapshots
  const isForward = (message.messageSnapshots?.length ?? 0) > 0;

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

  debug("Message", {
    channel: channelId,
    author: authorName,
    content: message.content.slice(0, 50),
    mentioned: isMentioned,
    replied: isReplied,
    is_forward: isForward,
  });

  // Store message in history (before response decision so context builds up)
  addMessage(channelId, authorId, authorName, message.content);

  // Get channel entity
  const channelEntityId = resolveDiscordEntity(channelId, "channel", guildId, channelId);

  // No binding = no response
  if (!channelEntityId) {
    if (isMentioned) {
      debug("Mentioned but no channel binding - ignoring");
    }
    return;
  }

  const channelEntity = getEntityWithFacts(channelEntityId);
  if (!channelEntity) return;

  // Welcome new users with a DM
  const userId = message.author.id.toString();
  if (isNewUser(userId)) {
    markUserWelcomed(userId);
    sendWelcomeDm(message.author.id).catch(() => {
      // DMs may fail if user has them disabled - that's fine
    });
  }

  // Cancel any pending retry for this channel
  const existingTimer = retryTimers.get(channelId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    retryTimers.delete(channelId);
  }

  // Build expression context
  const facts = channelEntity.facts.map(f => f.content);
  const lastResponse = lastResponseTime.get(channelId) ?? 0;
  const ctx = createBaseContext({
    facts,
    has_fact: (pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return facts.some(f => regex.test(f));
    },
    dt_ms: lastResponse > 0 ? messageTime - lastResponse : 0,
    elapsed_ms: 0,
    mentioned: isMentioned ?? false,
    replied: isReplied,
    is_forward: isForward,
    content: message.content,
    author: authorName,
  });

  // Evaluate facts to determine if we should respond
  const result = evaluateFacts(facts, ctx);

  debug("Fact evaluation", {
    shouldRespond: result.shouldRespond,
    retryMs: result.retryMs,
    factsCount: result.facts.length,
  });

  // Handle $retry - schedule re-evaluation
  if (result.retryMs !== null && result.retryMs > 0) {
    debug("Scheduling retry", { retryMs: result.retryMs });
    const timer = setTimeout(() => {
      retryTimers.delete(channelId);
      processRetry(channelId, guildId, authorName, message.content, messageTime);
    }, result.retryMs);
    retryTimers.set(channelId, timer);
    return;
  }

  // Default: respond if mentioned, unless explicitly suppressed
  const shouldRespond = result.shouldRespond ?? isMentioned;

  if (!shouldRespond) {
    debug("Not responding");
    return;
  }

  await sendResponse(channelId, guildId, authorName, message.content, isMentioned ?? false);
};

async function processRetry(
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  messageTime: number
) {
  const channelEntityId = resolveDiscordEntity(channelId, "channel", guildId, channelId);
  if (!channelEntityId) return;

  const channelEntity = getEntityWithFacts(channelEntityId);
  if (!channelEntity) return;

  const facts = channelEntity.facts.map(f => f.content);
  const lastResponse = lastResponseTime.get(channelId) ?? 0;
  const now = Date.now();

  const ctx = createBaseContext({
    facts,
    has_fact: (pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return facts.some(f => regex.test(f));
    },
    dt_ms: lastResponse > 0 ? now - lastResponse : 0,
    elapsed_ms: now - messageTime,
    mentioned: false, // Retry is never from a mention
    content,
    author: username,
  });

  const result = evaluateFacts(facts, ctx);

  // Handle chained $retry
  if (result.retryMs !== null && result.retryMs > 0) {
    debug("Scheduling chained retry", { retryMs: result.retryMs });
    const timer = setTimeout(() => {
      retryTimers.delete(channelId);
      processRetry(channelId, guildId, username, content, messageTime);
    }, result.retryMs);
    retryTimers.set(channelId, timer);
    return;
  }

  if (result.shouldRespond !== true) {
    debug("Not responding after retry");
    return;
  }

  await sendResponse(channelId, guildId, username, content, false);
}

async function sendResponse(
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  isMentioned: boolean
) {
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

  // Handle message via LLM
  try {
    const result = await handleMessage({
      channelId,
      guildId,
      userId: "",
      username,
      content,
      isMentioned,
    });

    // Mark response time
    lastResponseTime.set(channelId, Date.now());

    if (result) {
      try {
        const sent = await bot.helpers.sendMessage(BigInt(channelId), {
          content: result.response,
        });
        // Track bot message for reply detection
        botMessageIds.add(sent.id.toString());
        if (botMessageIds.size > MAX_BOT_MESSAGES) {
          const iter = botMessageIds.values();
          for (let i = 0; i < MAX_BOT_MESSAGES / 2; i++) {
            const v = iter.next().value;
            if (v) botMessageIds.delete(v);
          }
        }
      } catch (err) {
        error("Failed to send message", err);
      }
    }
  } finally {
    // Always stop typing
    if (typingInterval) {
      clearInterval(typingInterval);
    }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dmChannel = await bot.helpers.getDmChannel(userId) as any;
  await bot.helpers.sendMessage(dmChannel.id, {
    content: `**Welcome to Hologram!**\n\n${content}`,
  });

  debug("Sent welcome DM", { userId: userId.toString() });
}

bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting bot");
  await bot.start();
}
