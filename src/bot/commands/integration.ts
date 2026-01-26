import {
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";

// User app integration - works in DMs and guilds
export const USER_APP_INTEGRATION = {
  integrationTypes: [
    DiscordApplicationIntegrationType.GuildInstall,
    DiscordApplicationIntegrationType.UserInstall,
  ],
  contexts: [
    DiscordInteractionContextType.Guild,
    DiscordInteractionContextType.BotDm,
  ],
};

// Guild-only integration - requires server install
export const GUILD_ONLY_INTEGRATION = {
  integrationTypes: [DiscordApplicationIntegrationType.GuildInstall],
  contexts: [DiscordInteractionContextType.Guild],
};
