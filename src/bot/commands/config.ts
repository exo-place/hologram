import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;

import { getWorldState } from "../../world/state";
import {
  DEFAULT_CONFIG,
  PRESETS,
  mergeConfig,
  getConfigValue,
  setConfigValue,
  parseConfigValue,
  type WorldConfig,
} from "../../config";
import { getDb } from "../../db";
import { getOptionValue, getSubcommand, USER_APP_INTEGRATION } from "./index";

export const configCommand: CreateApplicationCommand = {
  name: "config",
  description: "Manage world configuration",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "show",
      description: "Show current configuration",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "section",
          description: "Config section to show (or all)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "all", value: "all" },
            { name: "chronicle", value: "chronicle" },
            { name: "scenes", value: "scenes" },
            { name: "inventory", value: "inventory" },
            { name: "locations", value: "locations" },
            { name: "time", value: "time" },
            { name: "characterState", value: "characterState" },
            { name: "dice", value: "dice" },
            { name: "relationships", value: "relationships" },
            { name: "context", value: "context" },
          ],
        },
      ],
    },
    {
      name: "set",
      description: "Set a configuration value",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "path",
          description: "Config path (e.g., chronicle.autoExtract)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "value",
          description: "Value to set",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "preset",
      description: "Apply a configuration preset",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Preset to apply",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "minimal - Just chat, no mechanics", value: "minimal" },
            { name: "simple - Basic RP features", value: "simple" },
            { name: "full - All features enabled", value: "full" },
            { name: "tf - Transformation focused", value: "tf" },
            { name: "tabletop - Dice and combat", value: "tabletop" },
          ],
        },
      ],
    },
    {
      name: "reset",
      description: "Reset configuration to defaults",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleConfigCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  // Get current world
  const worldState = getWorldState(channelId);
  if (!worldState) {
    await respond(bot, interaction, "No world initialized. Use `/world init` first.");
    return;
  }

  const db = getDb();

  switch (subcommand) {
    case "show": {
      const section = getOptionValue<string>(interaction, "section") ?? "all";
      const config = getWorldConfig(db, worldState.id);

      let output: string;
      if (section === "all") {
        output = formatConfigOverview(config);
      } else {
        const sectionConfig = config[section as keyof WorldConfig];
        if (sectionConfig === undefined) {
          await respond(bot, interaction, `Unknown section: ${section}`);
          return;
        }
        output = formatConfigSection(section, sectionConfig);
      }

      await respond(bot, interaction, output);
      break;
    }

    case "set": {
      const path = getOptionValue<string>(interaction, "path")!;
      const valueStr = getOptionValue<string>(interaction, "value")!;
      const value = parseConfigValue(valueStr);

      // Validate path exists
      const currentConfig = getWorldConfig(db, worldState.id);
      const currentValue = getConfigValue(currentConfig, path);
      if (currentValue === undefined) {
        await respond(
          bot,
          interaction,
          `Invalid path: \`${path}\`. Use \`/config show\` to see available options.`
        );
        return;
      }

      // Update config
      const newConfig = setConfigValue(currentConfig, path, value);
      saveWorldConfig(db, worldState.id, newConfig);

      await respond(
        bot,
        interaction,
        `Set \`${path}\` = \`${JSON.stringify(value)}\``
      );
      break;
    }

    case "preset": {
      const presetName = getOptionValue<string>(interaction, "name")!;
      const preset = PRESETS[presetName];

      if (!preset) {
        await respond(
          bot,
          interaction,
          `Unknown preset: ${presetName}. Valid: ${Object.keys(PRESETS).join(", ")}`
        );
        return;
      }

      const newConfig = mergeConfig(preset);
      saveWorldConfig(db, worldState.id, newConfig);

      await respond(
        bot,
        interaction,
        `Applied preset: **${presetName}**\n${getPresetDescription(presetName)}`
      );
      break;
    }

    case "reset": {
      saveWorldConfig(db, worldState.id, DEFAULT_CONFIG);
      await respond(bot, interaction, "Configuration reset to defaults.");
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
}

function getWorldConfig(db: ReturnType<typeof getDb>, worldId: number): WorldConfig {
  const row = db
    .prepare("SELECT config FROM worlds WHERE id = ?")
    .get(worldId) as { config: string | null } | null;

  if (!row?.config) {
    return DEFAULT_CONFIG;
  }

  try {
    const partial = JSON.parse(row.config);
    return mergeConfig(partial);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveWorldConfig(
  db: ReturnType<typeof getDb>,
  worldId: number,
  config: WorldConfig
): void {
  db.prepare("UPDATE worlds SET config = ? WHERE id = ?").run(
    JSON.stringify(config),
    worldId
  );
}

function formatConfigOverview(config: WorldConfig): string {
  const lines = ["**World Configuration**\n"];

  lines.push(`**Output Mode:** ${config.multiCharMode}`);
  lines.push("");

  // Show enabled/disabled status for each subsystem
  const subsystems = [
    ["Chronicle", config.chronicle.enabled],
    ["Scenes", config.scenes.enabled],
    ["Inventory", config.inventory.enabled],
    ["Locations", config.locations.enabled],
    ["Time", config.time.enabled],
    ["Character State", config.characterState.enabled],
    ["Dice", config.dice.enabled],
    ["Relationships", config.relationships.enabled],
  ] as const;

  lines.push("**Subsystems:**");
  for (const [name, enabled] of subsystems) {
    const status = enabled ? "ON" : "OFF";
    lines.push(`- ${name}: ${status}`);
  }

  lines.push("");
  lines.push("*Use `/config show <section>` for details*");

  return lines.join("\n");
}

function formatConfigSection(name: string, config: unknown): string {
  const lines = [`**${name} Configuration**\n`];

  if (typeof config === "object" && config !== null) {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        lines.push(`**${key}:**`);
        for (const [subKey, subValue] of Object.entries(value)) {
          lines.push(`  ${subKey}: \`${JSON.stringify(subValue)}\``);
        }
      } else {
        lines.push(`${key}: \`${JSON.stringify(value)}\``);
      }
    }
  } else {
    lines.push(`Value: \`${JSON.stringify(config)}\``);
  }

  return lines.join("\n");
}

function getPresetDescription(name: string): string {
  switch (name) {
    case "minimal":
      return "All mechanics disabled. Simple character chat.";
    case "simple":
      return "Basic RP features. Chronicle, scenes, inventory, locations, time, relationships.";
    case "full":
      return "All features enabled including dice, combat, factions, effects.";
    case "tf":
      return "Transformation focused. Forms, effects, and attributes enabled.";
    case "tabletop":
      return "Tabletop RPG style. Dice, combat, HP/AC, manual time.";
    default:
      return "";
  }
}

async function respond(
  bot: AnyBot,
  interaction: AnyInteraction,
  content: string
): Promise<void> {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: { content },
  });
}
