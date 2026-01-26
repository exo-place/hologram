import { createBot, Intents } from "@discordeno/bot";
import { info, debug, error } from "../logger";
import { registerCommands, handleInteraction } from "./commands";
import { handleMessage } from "../ai/handler";
import "./commands/commands"; // Register all commands

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
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
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

// Message deduplication
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

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

  await registerCommands(bot);
};

bot.events.messageCreate = async (message) => {
  // Ignore own messages
  if (botUserId && message.author.id === botUserId) return;
  if (!message.content) return;
  if (!markProcessed(message.id)) return;

  const isMentioned = botUserId !== null && message.mentionedUserIds?.includes(botUserId);
  const channelId = message.channelId.toString();

  debug("Message", {
    channel: channelId,
    author: message.author.username,
    content: message.content.slice(0, 50),
    mentioned: isMentioned,
  });

  // Check if we should respond before starting typing
  const channelEntityId = await import("../db/discord").then(m =>
    m.resolveDiscordEntity(channelId, "channel", message.guildId?.toString(), channelId)
  );
  const shouldRespond = isMentioned || channelEntityId !== null;

  if (!shouldRespond) {
    debug("Not responding - not mentioned and no channel binding");
    return;
  }

  // Start typing indicator
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  try {
    await bot.helpers.triggerTypingIndicator(message.channelId);
    typingInterval = setInterval(async () => {
      try {
        await bot.helpers.triggerTypingIndicator(message.channelId);
      } catch {
        // Ignore typing errors
      }
    }, 8000);
  } catch {
    // Ignore typing errors
  }

  // Handle message via LLM
  const result = await handleMessage({
    channelId,
    guildId: message.guildId?.toString(),
    userId: message.author.id.toString(),
    username: message.author.username,
    content: message.content,
    isMentioned: isMentioned ?? false,
  });

  // Stop typing
  if (typingInterval) {
    clearInterval(typingInterval);
  }

  if (result) {
    try {
      await bot.helpers.sendMessage(message.channelId, {
        content: result.response,
      });
    } catch (err) {
      error("Failed to send message", err);
    }
  }
};

bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting bot");
  await bot.start();
}
