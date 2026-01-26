/**
 * /channel Command
 *
 * Ephemeral command to check channel state for debugging.
 */

import { type CreateApplicationCommand } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { respond } from "./index";
import { USER_APP_INTEGRATION } from "./integration";
import { isChannelEnabled } from "../../plugins/core";
import { getActiveScene, getSceneCharacters } from "../../scene";
import { getWorldState } from "../../world/state";
import { getWorldConfig } from "../../config";
import { getEntity, type CharacterData } from "../../db/entities";
import { getPersona } from "../../personas";

export const channelCommand: CreateApplicationCommand = {
  name: "channel",
  description: "Check channel state (ephemeral)",
  ...USER_APP_INTEGRATION,
};

export async function handleChannelCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";

  const lines: string[] = ["## Channel State"];

  // Channel enabled
  const enabled = isChannelEnabled(channelId);
  lines.push(`**Enabled:** ${enabled ? "Yes" : "No"}`);

  // World
  const world = getWorldState(channelId);
  if (world) {
    lines.push(`**World:** ${world.name ?? "Unnamed"} (ID: ${world.id})`);

    // Config summary
    const config = getWorldConfig(world.id);
    const enabledFeatures: string[] = [];
    if (config.scenes.enabled) enabledFeatures.push("scenes");
    if (config.chronicle.enabled) enabledFeatures.push("chronicle");
    if (config.inventory.enabled) enabledFeatures.push("inventory");
    if (config.locations.enabled) enabledFeatures.push("locations");
    if (config.time.enabled) enabledFeatures.push("time");
    if (config.characterState.enabled) enabledFeatures.push("state");
    if (config.dice.enabled) enabledFeatures.push("dice");
    if (config.relationships.enabled) enabledFeatures.push("relationships");
    if (config.images.enabled) enabledFeatures.push("images");

    if (enabledFeatures.length > 0) {
      lines.push(`**Features:** ${enabledFeatures.join(", ")}`);
    }

    // Response config
    const respMode = config.response.defaultMode;
    const respChance = config.response.defaultChance;
    lines.push(`**Response Mode:** ${respMode}${respMode === "chance" || respMode === "combined" ? ` (${(respChance * 100).toFixed(0)}%)` : ""}`);
    lines.push(`**Require Persona:** ${config.response.requirePersona ? "Yes" : "No"}`);
  } else {
    lines.push("**World:** None");
  }

  // Scene
  const scene = getActiveScene(channelId);
  if (scene) {
    lines.push("");
    lines.push("## Scene");
    lines.push(`**ID:** ${scene.id}`);
    lines.push(`**Status:** ${scene.status}`);
    lines.push(`**Time:** Day ${scene.time.day + 1}, ${scene.time.hour}:${scene.time.minute.toString().padStart(2, "0")}`);
    if (scene.weather) lines.push(`**Weather:** ${scene.weather}`);

    // Characters in scene
    const sceneChars = getSceneCharacters(scene.id);
    if (sceneChars.length > 0) {
      const charNames = sceneChars
        .map((sc) => {
          const entity = getEntity<CharacterData>(sc.characterId);
          const active = sc.isPresent ? "" : " (away)";
          const mode = entity?.data.responseMode ?? "default";
          return `${entity?.name ?? `ID:${sc.characterId}`}${active} [${mode}]`;
        })
        .join(", ");
      lines.push(`**Characters:** ${charNames}`);
    } else {
      lines.push("**Characters:** None");
    }
  } else {
    lines.push("");
    lines.push("**Scene:** None active");
  }

  // User persona
  lines.push("");
  lines.push("## Your Status");
  const persona = world ? getPersona(userId, world.id) : null;
  if (persona) {
    lines.push(`**Persona:** ${persona.name}`);
    if (persona.persona) {
      lines.push(`**Bio:** ${persona.persona.slice(0, 100)}${persona.persona.length > 100 ? "..." : ""}`);
    }
  } else {
    lines.push("**Persona:** Not set");
    if (world?.id) {
      lines.push("-# Use `/persona set` to create your RP identity");
    }
  }

  await respond(bot, interaction, lines.join("\n"), true); // Ephemeral
}
