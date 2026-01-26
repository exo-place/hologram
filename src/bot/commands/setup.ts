/**
 * /setup Command
 *
 * Interactive guided setup wizard for new users.
 * Chains: world creation → mode selection → character creation → session enable
 */

import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
  ButtonStyles,
  MessageComponentTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { respond, USER_APP_INTEGRATION, getSubcommand } from "./index";
import { createWorld, initWorldState, linkGuildToWorld, getWorldState } from "../../world/state";
import { enableChannel, isChannelEnabled } from "../../plugins/core";
import { getModes } from "../../plugins";
import { setWorldConfig, getWorldConfig } from "../../config/defaults";
import { getDb } from "../../db";
import { info } from "../../logger";

export const setupCommand: CreateApplicationCommand = {
  name: "setup",
  description: "Set up Hologram in this channel",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "quick",
      description: "Quick setup with sensible defaults",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "guided",
      description: "Step-by-step guided setup",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "status",
      description: "Check current setup status",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "reset",
      description: "Reset setup for this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleSetupCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  switch (subcommand) {
    case "quick": {
      await handleQuickSetup(bot, interaction, channelId, guildId);
      break;
    }

    case "guided": {
      await handleGuidedSetup(bot, interaction, channelId, guildId);
      break;
    }

    case "status": {
      await handleSetupStatus(bot, interaction, channelId, guildId);
      break;
    }

    case "reset": {
      await handleSetupReset(bot, interaction, channelId);
      break;
    }

    default: {
      // Default to guided setup
      await handleGuidedSetup(bot, interaction, channelId, guildId);
    }
  }
}

async function handleQuickSetup(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string,
  guildId: string | undefined
): Promise<void> {
  // Check if already set up
  const worldState = getWorldState(channelId);
  const enabled = isChannelEnabled(channelId);

  if (worldState && enabled) {
    await respond(
      bot,
      interaction,
      "This channel is already set up! Use `/setup status` to see details or `/setup reset` to start over.",
      true
    );
    return;
  }

  // Get guild name
  let worldName = "My World";
  if (guildId) {
    try {
      const guild = await bot.helpers.getGuild(BigInt(guildId));
      worldName = guild.name ?? "My World";
    } catch {
      // Fallback
    }
  }

  // Check for existing world
  let worldId: number | null = null;
  if (guildId) {
    const db = getDb();
    const existing = db
      .prepare("SELECT world_id FROM guild_worlds WHERE guild_id = ?")
      .get(guildId) as { world_id: number } | null;
    if (existing) {
      worldId = existing.world_id;
    }
  }

  // Create world if needed
  if (!worldId) {
    const world = createWorld(worldName, "A world for roleplay adventures.");
    worldId = world.id;

    // Apply sillytavern mode as default (good balance of features)
    const modes = getModes();
    const sillytavern = modes.find((m) => m.id === "sillytavern");
    if (sillytavern?.config) {
      setWorldConfig(worldId, sillytavern.config);
    }

    if (guildId) {
      linkGuildToWorld(guildId, worldId);
    }

    info("Setup quick: created world", { worldId, worldName, guildId });
  }

  // Initialize and enable
  initWorldState(channelId, worldId);
  enableChannel(channelId);

  info("Setup quick: completed", { channelId, worldId });

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: "Setup Complete!",
          description: `Created world **${worldName}** and enabled responses in this channel.`,
          color: 0x57f287,
          fields: [
            {
              name: "What's Next?",
              value:
                "• Use `/build character` to create a character\n" +
                "• Or just start chatting - mention me to get a response\n" +
                "• Use `/config preset` to change modes",
              inline: false,
            },
          ],
        },
      ],
      components: [
        {
          type: MessageComponentTypes.ActionRow,
          components: [
            {
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Primary,
              label: "Create Character",
              customId: "onboarding:create_character",
              emoji: { name: "✨" },
            },
          ],
        },
      ],
    },
  });
}

async function handleGuidedSetup(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string,
  _guildId: string | undefined
): Promise<void> {
  // Check current state
  const worldState = getWorldState(channelId);
  const enabled = isChannelEnabled(channelId);

  // Build status embed showing what's done and what's needed
  const steps = [
    {
      name: "World",
      done: !!worldState,
      action: worldState ? `✓ ${worldState.name}` : "Click to create",
    },
    {
      name: "Mode",
      done: !!worldState,
      action: worldState ? "✓ Configured" : "Choose after world",
    },
    {
      name: "Session",
      done: enabled,
      action: enabled ? "✓ Enabled" : "Click to enable",
    },
    {
      name: "Character",
      done: false, // Can always add more
      action: "Optional - create anytime",
    },
  ];

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: "Guided Setup",
          description: "Let's set up Hologram step by step.",
          color: 0x5865f2,
          fields: steps.map((step, i) => ({
            name: `${i + 1}. ${step.name}`,
            value: step.action,
            inline: true,
          })),
        },
      ],
      components: [
        {
          type: MessageComponentTypes.ActionRow,
          components: [
            {
              type: MessageComponentTypes.Button,
              style: worldState ? ButtonStyles.Secondary : ButtonStyles.Primary,
              label: worldState ? "World Created" : "Create World",
              customId: "setup:create_world",
              disabled: !!worldState,
              emoji: { name: worldState ? "✓" : "🌍" },
            },
            {
              type: MessageComponentTypes.Button,
              style: enabled ? ButtonStyles.Secondary : ButtonStyles.Primary,
              label: enabled ? "Session Enabled" : "Enable Session",
              customId: "setup:enable_session",
              disabled: enabled || !worldState,
              emoji: { name: enabled ? "✓" : "⚡" },
            },
            {
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Secondary,
              label: "Choose Mode",
              customId: "onboarding:choose_mode",
              disabled: !worldState,
              emoji: { name: "🎮" },
            },
          ],
        },
        {
          type: MessageComponentTypes.ActionRow,
          components: [
            {
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Success,
              label: "Create Character",
              customId: "onboarding:create_character",
              emoji: { name: "✨" },
            },
            {
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Danger,
              label: "Quick Setup (All at once)",
              customId: "setup:quick_all",
              emoji: { name: "🚀" },
            },
          ],
        },
      ],
    },
  });
}

async function handleSetupStatus(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string,
  _guildId: string | undefined
): Promise<void> {
  const worldState = getWorldState(channelId);
  const enabled = isChannelEnabled(channelId);

  let modeInfo = "Not configured";
  if (worldState) {
    const config = getWorldConfig(worldState.id);
    const modes = getModes();
    // Try to match current config to a mode
    const matchedMode = modes.find((m) => {
      if (!m.config) return false;
      // Simple check: compare enabled flags
      return (
        m.config.chronicle?.enabled === config.chronicle.enabled &&
        m.config.scenes?.enabled === config.scenes.enabled &&
        m.config.inventory?.enabled === config.inventory.enabled
      );
    });
    modeInfo = matchedMode ? matchedMode.name : "Custom";
  }

  // Count characters in this world
  let characterCount = 0;
  if (worldState) {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM entities WHERE world_id = ? AND type = 'character'")
      .get(worldState.id) as { count: number };
    characterCount = row.count;
  }

  const statusEmoji = (done: boolean) => (done ? "✅" : "❌");

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: "Setup Status",
          color: worldState && enabled ? 0x57f287 : 0xfee75c,
          fields: [
            {
              name: "World",
              value: worldState
                ? `${statusEmoji(true)} ${worldState.name} (ID: ${worldState.id})`
                : `${statusEmoji(false)} Not created`,
              inline: true,
            },
            {
              name: "Mode",
              value: `${statusEmoji(!!worldState)} ${modeInfo}`,
              inline: true,
            },
            {
              name: "Session",
              value: `${statusEmoji(enabled)} ${enabled ? "Enabled" : "Disabled"}`,
              inline: true,
            },
            {
              name: "Characters",
              value: `${characterCount} character${characterCount !== 1 ? "s" : ""} in world`,
              inline: true,
            },
          ],
          footer: {
            text: worldState && enabled
              ? "You're all set! Mention me or type to start chatting."
              : "Use /setup quick or /setup guided to complete setup.",
          },
        },
      ],
    },
  });
}

async function handleSetupReset(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string
): Promise<void> {
  // Just disable the channel - don't delete world data
  const { disableChannel } = await import("../../plugins/core");
  disableChannel(channelId);

  // Clear world state for this channel
  const db = getDb();
  db.prepare("DELETE FROM world_state WHERE channel_id = ?").run(channelId);

  await respond(
    bot,
    interaction,
    "Reset complete. Use `/setup quick` or `/setup guided` to set up again.\n" +
      "Note: World and character data is preserved - only this channel's session was reset.",
    true
  );
}

/** Handle setup-specific button interactions */
export async function handleSetupComponent(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<boolean> {
  const customId = interaction.data?.customId ?? "";

  if (!customId.startsWith("setup:")) {
    return false;
  }

  const [, action] = customId.split(":");
  const channelId = interaction.channelId?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  switch (action) {
    case "create_world": {
      // Get guild name
      let worldName = "My World";
      if (guildId) {
        try {
          const guild = await bot.helpers.getGuild(BigInt(guildId));
          worldName = guild.name ?? "My World";
        } catch {
          // Fallback
        }
      }

      const world = createWorld(worldName, "A world for roleplay adventures.");

      if (guildId) {
        linkGuildToWorld(guildId, world.id);
      }

      initWorldState(channelId, world.id);

      info("Setup component: created world", { worldId: world.id, channelId });

      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: {
          content: `Created world **${worldName}**! Now choose a mode or enable the session.`,
          flags: 64,
        },
      });
      return true;
    }

    case "enable_session": {
      enableChannel(channelId);

      info("Setup component: enabled session", { channelId });

      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: {
          content: "Session enabled! I'll now respond to messages in this channel.",
          flags: 64,
        },
      });
      return true;
    }

    case "quick_all": {
      // Trigger quick setup
      await handleQuickSetup(bot, interaction, channelId, guildId);
      return true;
    }

    default:
      return false;
  }
}
