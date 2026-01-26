/**
 * /reroll Command
 *
 * Regenerate the last AI response with optional guidance.
 */

import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getOptionValue, respond, respondDeferred, editResponse } from "./index";
import { USER_APP_INTEGRATION } from "./integration";
import { rerollLastResponse } from "../../plugins/core";

export const rerollCommand: CreateApplicationCommand = {
  name: "reroll",
  description: "Regenerate the last AI response",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "guidance",
      description: "Optional guidance for the new response",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
  ],
};

export async function handleRerollCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString();
  if (!channelId) {
    await respond(bot, interaction, "Could not determine channel.", true);
    return;
  }

  const guidance = getOptionValue<string>(interaction, "guidance");

  // Defer since LLM call takes time
  await respondDeferred(bot, interaction);

  try {
    const result = await rerollLastResponse(channelId, guidance);

    if (!result.success) {
      await editResponse(bot, interaction, result.error ?? "Failed to reroll.");
      return;
    }

    // Send the new response
    let message = result.response ?? "No response generated.";
    if (guidance) {
      message = `-# Rerolled with guidance: "${guidance}"\n\n${message}`;
    } else {
      message = `-# Rerolled\n\n${message}`;
    }

    await editResponse(bot, interaction, message);
  } catch (error) {
    await editResponse(
      bot,
      interaction,
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
