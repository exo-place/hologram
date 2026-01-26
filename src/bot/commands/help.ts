/**
 * /help Command
 *
 * In-Discord documentation and current state overview.
 */

import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getOptionValue, USER_APP_INTEGRATION } from "./index";
import { getWorldState } from "../../world/state";
import { isChannelEnabled } from "../../plugins/core";
import { getWorldConfig } from "../../config/defaults";
import { getDb } from "../../db";

export const helpCommand: CreateApplicationCommand = {
  name: "help",
  description: "Get help with Hologram",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "topic",
      description: "Specific help topic",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "Getting Started", value: "start" },
        { name: "Characters", value: "characters" },
        { name: "Worlds & Scenes", value: "worlds" },
        { name: "Memory (Chronicle)", value: "memory" },
        { name: "Locations", value: "locations" },
        { name: "Inventory", value: "inventory" },
        { name: "Dice & Combat", value: "combat" },
        { name: "Configuration", value: "config" },
        { name: "All Commands", value: "commands" },
      ],
    },
  ],
};

export async function handleHelpCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const topic = getOptionValue<string>(interaction, "topic");
  const channelId = interaction.channelId?.toString() ?? "";

  if (topic) {
    await sendTopicHelp(bot, interaction, topic);
  } else {
    await sendOverviewHelp(bot, interaction, channelId);
  }
}

async function sendOverviewHelp(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string
): Promise<void> {
  // Get current state
  const worldState = getWorldState(channelId);
  const enabled = isChannelEnabled(channelId);

  // Build status indicators
  const statusEmoji = (done: boolean) => (done ? "✅" : "⬜");

  let configSummary = "Not configured";
  let enabledFeatures: string[] = [];

  if (worldState) {
    const config = getWorldConfig(worldState.id);

    // Check which features are enabled
    if (config.chronicle.enabled) enabledFeatures.push("Memory");
    if (config.scenes.enabled) enabledFeatures.push("Scenes");
    if (config.inventory.enabled) enabledFeatures.push("Inventory");
    if (config.locations.enabled) enabledFeatures.push("Locations");
    if (config.time.enabled) enabledFeatures.push("Time");
    if (config.dice.enabled) enabledFeatures.push("Dice");
    if (config.relationships.enabled) enabledFeatures.push("Relationships");
    if (config.characterState.enabled) enabledFeatures.push("Character State");

    configSummary = enabledFeatures.length > 0
      ? enabledFeatures.join(", ")
      : "Minimal (no extra features)";
  }

  // Count characters
  let characterCount = 0;
  if (worldState) {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM entities WHERE world_id = ? AND type = 'character'")
      .get(worldState.id) as { count: number };
    characterCount = row.count;
  }

  // Build help embed
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: "Hologram Help",
          description:
            "I'm an RP bot with smart context, memory, and world management. " +
            "Here's your current setup and how to get started.",
          color: 0x5865f2,
          fields: [
            {
              name: "Current Status",
              value: [
                `${statusEmoji(!!worldState)} World: ${worldState?.name ?? "Not created"}`,
                `${statusEmoji(enabled)} Session: ${enabled ? "Enabled" : "Disabled"}`,
                `${statusEmoji(characterCount > 0)} Characters: ${characterCount}`,
                `Features: ${configSummary}`,
              ].join("\n"),
              inline: false,
            },
            {
              name: "Quick Start",
              value: [
                "`/setup quick` - Set up everything in one click",
                "`/build character` - Create a character with AI help",
                "`/config preset` - Choose a mode (minimal, MUD, tabletop, etc.)",
              ].join("\n"),
              inline: false,
            },
            {
              name: "Essential Commands",
              value: [
                "`/session enable` - Enable responses in this channel",
                "`/character create` - Create a new character",
                "`/character select` - Switch active character",
                "`/config wizard` - Configure features interactively",
              ].join("\n"),
              inline: true,
            },
            {
              name: "Feature Commands",
              value: [
                "`/scene` - Manage RP sessions",
                "`/location` - Explore and navigate",
                "`/chronicle` - Search memories",
                "`/roll` - Roll dice",
              ].join("\n"),
              inline: true,
            },
            {
              name: "Help Topics",
              value:
                "Use `/help <topic>` for detailed help:\n" +
                "`start` `characters` `worlds` `memory` `locations` `inventory` `combat` `config` `commands`",
              inline: false,
            },
          ],
          footer: {
            text: "Use /tips disable to turn off helpful suggestions",
          },
        },
      ],
    },
  });
}

async function sendTopicHelp(
  bot: HologramBot,
  interaction: HologramInteraction,
  topic: string
): Promise<void> {
  const topics: Record<string, { title: string; content: string }> = {
    start: {
      title: "Getting Started",
      content: `
**Quick Setup**
1. Use \`/setup quick\` to create a world and enable responses
2. Use \`/build character\` to create a character
3. Start chatting!

**Manual Setup**
1. \`/world create <name>\` - Create a world
2. \`/world init <name>\` - Initialize world in this channel
3. \`/session enable\` - Enable bot responses
4. \`/character create <name>\` - Create a character

**Choose Your Mode**
Use \`/config preset\` to select a playstyle:
- **Minimal** - Simple chat
- **SillyTavern** - Character chat with memory
- **MUD** - Text adventure with exploration
- **Tabletop** - Dice and combat
- **Full** - All features enabled
      `.trim(),
    },
    characters: {
      title: "Characters",
      content: `
**Creating Characters**
- \`/build character\` - AI-assisted creation wizard
- \`/character create <name>\` - Manual creation

**Managing Characters**
- \`/character list\` - See all characters
- \`/character view <name>\` - View character details
- \`/character edit <name>\` - Edit a character
- \`/character delete <name>\` - Remove a character

**Using Characters**
- \`/character select <name>\` - Switch active character
- Characters appear with their own name/avatar via webhooks

**Personas (For Players)**
- \`/persona set <name>\` - Set your display name
- \`/proxy add\` - Add a character you can speak as
      `.trim(),
    },
    worlds: {
      title: "Worlds & Scenes",
      content: `
**Worlds**
- \`/world create <name>\` - Create a new world
- \`/world init <name>\` - Use world in this channel
- \`/world status\` - View current world state
- Each world has its own characters, locations, and settings

**Scenes**
- \`/scene start <name>\` - Start a named RP session
- \`/scene pause\` - Pause current scene
- \`/scene resume <name>\` - Resume a paused scene
- \`/scene end\` - End current scene
- \`/scene list\` - View all scenes

Scenes preserve context between sessions and can be paused/resumed.
      `.trim(),
    },
    memory: {
      title: "Memory (Chronicle)",
      content: `
**About Chronicle**
The chronicle system stores important events and facts from your RP sessions. Enable with \`/config set chronicle.enabled true\`.

**Commands**
- \`/chronicle recall <query>\` - Search memories
- \`/chronicle history\` - View recent entries
- \`/chronicle add <text>\` - Manually add a memory
- \`/chronicle forget <id>\` - Remove a memory

**Features**
- **Auto-extraction** - Important events are saved automatically
- **Perspective-aware** - Characters only "remember" what they witnessed
- **Searchable** - Query memories by content

**Configuration**
- \`chronicle.autoExtract\` - Automatically save important events
- \`chronicle.perspectiveAware\` - Filter by who knows what
      `.trim(),
    },
    locations: {
      title: "Locations",
      content: `
**About Locations**
Create and explore a world map. Enable with \`/config set locations.enabled true\`.

**Commands**
- \`/location go <name>\` - Travel to a location
- \`/location look\` - Examine current location
- \`/location create <name>\` - Create new location
- \`/location connect <from> <to>\` - Connect locations
- \`/location map\` - View all locations

**Features**
- Location descriptions are included in context
- Track where characters are
- Optional travel time between locations
      `.trim(),
    },
    inventory: {
      title: "Inventory",
      content: `
**About Inventory**
Track items and equipment. Enable with \`/config set inventory.enabled true\`.

**Features**
- Give items to characters
- Equipment slots (weapon, armor, etc.)
- Optional capacity limits
- Optional item durability

**Configuration**
- \`inventory.useEquipment\` - Enable equipment slots
- \`inventory.useCapacity\` - Limit inventory size
- \`inventory.useDurability\` - Items can break
      `.trim(),
    },
    combat: {
      title: "Dice & Combat",
      content: `
**Dice Rolling**
- \`/roll 2d6+3\` - Roll dice with modifiers
- \`/roll 4d6kh3\` - Keep highest 3 of 4d6
- \`/roll d20 advantage\` - Roll with advantage
- \`/r d20\` - Quick roll shortcut

**Combat System**
Enable with \`/config set dice.enabled true\` and \`/config set dice.useCombat true\`.

- \`/combat start\` - Begin combat
- \`/combat join <character>\` - Add to initiative
- \`/combat next\` - Next turn
- \`/combat status\` - View initiative order
- \`/combat end\` - End combat

**Dice Syntax**
- \`NdM\` - Roll N M-sided dice
- \`+X\` / \`-X\` - Add/subtract modifier
- \`khN\` / \`klN\` - Keep highest/lowest N
- \`!N\` - Exploding on N+
      `.trim(),
    },
    config: {
      title: "Configuration",
      content: `
**Quick Config**
- \`/config preset <mode>\` - Apply a preset mode
- \`/config wizard\` - Interactive feature toggles

**Manual Config**
- \`/config show\` - View current settings
- \`/config set <path> <value>\` - Set a specific option
- \`/config reset\` - Reset to defaults

**Feature Flags**
\`\`\`
chronicle.enabled    - Memory system
scenes.enabled       - Scene management
inventory.enabled    - Item tracking
locations.enabled    - World map
time.enabled         - Time system
dice.enabled         - Dice rolling
relationships.enabled - Character relationships
characterState.enabled - HP, attributes, forms
\`\`\`

**Presets**
\`minimal\` \`sillytavern\` \`mud\` \`survival\` \`tits\` \`tabletop\` \`parser\` \`full\`
      `.trim(),
    },
    commands: {
      title: "All Commands",
      content: `
**Setup & Config**
\`/setup\` \`/config\` \`/tips\` \`/help\`

**World & Session**
\`/world\` \`/session\` \`/scene\`

**Characters**
\`/character\` \`/build\` \`/persona\` \`/proxy\`

**Exploration**
\`/location\` \`/time\` \`/status\`

**Memory**
\`/chronicle\` \`/memory\`

**Social**
\`/relationship\` \`/faction\`

**Gameplay**
\`/roll\` \`/r\` \`/combat\`

Use \`/help <topic>\` for details on each area.
      `.trim(),
    },
  };

  const help = topics[topic];
  if (!help) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: `Unknown topic: ${topic}`,
        flags: 64,
      },
    });
    return;
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: `Help: ${help.title}`,
          description: help.content,
          color: 0x5865f2,
          footer: {
            text: "Use /help for overview or /help <topic> for other topics",
          },
        },
      ],
    },
  });
}
