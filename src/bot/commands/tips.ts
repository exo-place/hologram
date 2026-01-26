/**
 * /tips Command
 *
 * Manage the progressive disclosure tips system.
 */

import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { respond, getSubcommand } from "./index";
import { USER_APP_INTEGRATION } from "./integration";
import { setTipsEnabled, areTipsEnabled, resetTips } from "../tips";

export const tipsCommand: CreateApplicationCommand = {
  name: "tips",
  description: "Manage helpful tips",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "enable",
      description: "Enable helpful tips",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "disable",
      description: "Disable helpful tips",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "status",
      description: "Check if tips are enabled",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "reset",
      description: "Reset tips to show them again",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleTipsCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  switch (subcommand) {
    case "enable": {
      setTipsEnabled(channelId, true);
      await respond(bot, interaction, "Tips enabled! I'll occasionally suggest features as you use the bot.", true);
      break;
    }

    case "disable": {
      setTipsEnabled(channelId, false);
      await respond(bot, interaction, "Tips disabled. Use `/tips enable` to turn them back on.", true);
      break;
    }

    case "status": {
      const enabled = areTipsEnabled(channelId);
      await respond(
        bot,
        interaction,
        `Tips are currently **${enabled ? "enabled" : "disabled"}** in this channel.`,
        true
      );
      break;
    }

    case "reset": {
      resetTips(channelId);
      await respond(bot, interaction, "Tips reset! You'll see helpful suggestions again as you use the bot.", true);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.", true);
  }
}
