/**
 * /quota Command
 *
 * View and manage usage quotas.
 */

import { type CreateApplicationCommand } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { respond, USER_APP_INTEGRATION } from "./index";
import { getWorldState } from "../../world/state";
import { getWorldConfig } from "../../config";
import { checkQuota, formatQuotaStatus } from "../../quota";

export const quotaCommand: CreateApplicationCommand = {
  name: "quota",
  description: "View your usage quota status",
  ...USER_APP_INTEGRATION,
};

export async function handleQuotaCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const userId = interaction.user.id.toString();
  const guildId = interaction.guildId?.toString();

  // Get world context
  const worldState = getWorldState(channelId);
  if (!worldState) {
    await respond(bot, interaction, "No world initialized. Use `/world init` first.", true);
    return;
  }

  const config = getWorldConfig(worldState.id);
  if (!config.quota.enabled) {
    await respond(bot, interaction, "Quotas are not enabled for this world.", true);
    return;
  }

  const status = checkQuota(userId, config.quota, guildId);
  const formatted = formatQuotaStatus(status, config.quota);

  await respond(bot, interaction, formatted, true);
}
