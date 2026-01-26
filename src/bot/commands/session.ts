import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";

import {
  enableChannel,
  disableChannel,
  isChannelEnabled,
  clearHistory,
} from "../../plugins/core";
import { getActiveCharacterLegacy as getActiveCharacter } from "../../plugins/scene";
import { createContext, runFormatters } from "../../plugins/registry";
import { getWorldState } from "../../world/state";
import {
  getSessionMemory,
  clearSession,
  setSceneDescription,
  formatSessionDebug,
} from "../../memory/tiers";
import { debugContext, formatDebugInfo, type AssembledContext } from "../../ai/debug";
import { getOptionValue, getSubcommand, respond, editResponse } from "./index";
import { USER_APP_INTEGRATION } from "./integration";

export const sessionCommand: CreateApplicationCommand = {
  name: "session",
  description: "Manage RP session",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "enable",
      description: "Enable bot responses in this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "disable",
      description: "Disable bot responses in this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "status",
      description: "Show session status",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "clear",
      description: "Clear session history and state",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "scene",
      description: "Set scene description",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "description",
          description: "Scene description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "debug",
      description: "Show context debug info",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleSessionCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  switch (subcommand) {
    case "enable": {
      enableChannel(channelId);
      await respond(
        bot,
        interaction,
        "Bot responses **enabled** for this channel."
      );
      break;
    }

    case "disable": {
      disableChannel(channelId);
      await respond(
        bot,
        interaction,
        "Bot responses **disabled** for this channel."
      );
      break;
    }

    case "status": {
      const enabled = isChannelEnabled(channelId);
      const activeCharId = getActiveCharacter(channelId);
      const worldState = getWorldState(channelId);
      const session = getSessionMemory(channelId);

      const lines = [
        "**Session Status:**",
        `Channel enabled: ${enabled ? "Yes" : "No"}`,
        `Active character ID: ${activeCharId ?? "None"}`,
        `World initialized: ${worldState ? worldState.name : "No"}`,
        `Scene: ${session.sceneDescription ?? "Not set"}`,
        `Recent events: ${session.recentEvents.length}`,
        `Session notes: ${session.tempFacts.length}`,
      ];

      await respond(bot, interaction, lines.join("\n"));
      break;
    }

    case "clear": {
      clearHistory(channelId);
      clearSession(channelId);
      await respond(
        bot,
        interaction,
        "Cleared message history and session state."
      );
      break;
    }

    case "scene": {
      const description = getOptionValue<string>(interaction, "description")!;
      setSceneDescription(channelId, description);
      await respond(bot, interaction, `Scene set: ${description}`);
      break;
    }

    case "debug": {
      await respond(bot, interaction, "Assembling context for debug...", true);

      try {
        // Create a minimal context to run formatters
        const ctx = createContext({
          channelId,
          guildId: interaction.guildId?.toString(),
          authorId: interaction.user?.id?.toString() ?? "unknown",
          authorName: interaction.user?.username ?? "unknown",
          content: "",
          isBotMentioned: false,
        });

        // Run formatters to build system prompt
        const sections = await runFormatters(ctx);
        const systemPrompt = sections.map((s) => s.content).join("\n\n");

        const context: AssembledContext = {
          systemPrompt,
          messages: [],
          tokenEstimate: sections.reduce((sum, s) => sum + (s.minTokens ?? 50), 0),
        };

        const debugInfo = debugContext(context);
        const formatted = formatDebugInfo(debugInfo);

        // Add session debug
        const sessionDebug = formatSessionDebug(channelId);

        await editResponse(
          bot,
          interaction,
          `\`\`\`\n${formatted}\n\nSession:\n${sessionDebug}\n\`\`\``
        );
      } catch (error) {
        await editResponse(
          bot,
          interaction,
          `Debug failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
}

