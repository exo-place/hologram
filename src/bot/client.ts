import { createBot, Intents } from "@discordeno/bot";
import { initPluginSystem, initPlugins } from "../plugins";
import { handleMessage } from "../plugins/handler";
import { registerCommands, handleInteraction } from "./commands";
import { startEventScheduler } from "../events/scheduler";
import { sendMultiCharResponse } from "./webhooks";
import { info, error, debug } from "../logger";

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
      bot: true as const,
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
    },
    member: {
      id: true,
      nick: true,
    },
    channel: {
      type: true,
    },
    webhook: {
      id: true,
      token: true,
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
  },
});

let botUserId: bigint | null = null;

// Event handlers
bot.events.ready = async (payload) => {
  info("Bot logged in", { username: payload.user.username });
  botUserId = payload.user.id;

  // Initialize plugin system
  await initPluginSystem();
  await initPlugins();
  info("Plugin system initialized");

  // Register slash commands
  await registerCommands(bot);

  // Start background event scheduler (random events + NPC behavior ticks)
  startEventScheduler({
    sendMessage: (channelId, options) => bot.helpers.sendMessage(channelId, options),
  });
};

bot.events.messageCreate = async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Ignore messages without content
  if (!message.content) return;

  // Check if bot is mentioned
  const isBotMentioned =
    botUserId !== null && message.mentionedUserIds?.includes(botUserId);

  debug("Message received", {
    guild: message.guildId?.toString() ?? "DM",
    author: message.author.username,
    content: message.content.slice(0, 100),
  });

  // Handle the message
  const result = await handleMessage(
    message.channelId.toString(),
    message.guildId?.toString(),
    message.author.id.toString(),
    message.author.username,
    message.content,
    isBotMentioned ?? false
  );

  // Send response if we got one
  if (result) {
    try {
      // Send time-skip narration first (if any)
      if (result.narration) {
        await bot.helpers.sendMessage(message.channelId, {
          content: `*${result.narration}*`,
        });
      }

      // Route response through multi-char delivery when available
      const mode = result.multiCharMode ?? "tagged";
      if (result.segments && result.segments.length > 0 && mode !== "tagged") {
        await sendMultiCharResponse(
          bot,
          message.channelId.toString(),
          result.segments,
          mode
        );
      } else {
        await bot.helpers.sendMessage(message.channelId, {
          content: result.response,
        });
      }
    } catch (err) {
      error("Failed to send message", err, { channelId: message.channelId.toString() });
    }
  }
};

// Handle slash command interactions
bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting Hologram bot");
  await bot.start();
}
