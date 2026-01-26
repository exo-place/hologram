/**
 * /notes Command
 *
 * Manage preset notes (Author's Notes) that are injected into the AI context.
 * Notes can be placed at different depths in the prompt.
 */

import { ApplicationCommandOptionTypes } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getSubcommand, getOptionValue, respond } from "./index";
import { USER_APP_INTEGRATION } from "./integration";
import { getWorldState } from "../../world/state";
import { getWorldConfig, setWorldConfig } from "../../config";
import type { PresetNote } from "../../config/types";

export const notesCommand = {
  name: "notes",
  description: "Manage preset notes (Author's Notes) for the AI context",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "add",
      description: "Add a preset note",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "content",
          description: "The note content",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "depth",
          description: "Where to insert: system, start, or number (0=end, 1=before last, etc.)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "list",
      description: "List all preset notes",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "remove",
      description: "Remove a preset note by index",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "index",
          description: "Note index (from /notes list)",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
          minValue: 0,
        },
      ],
    },
    {
      name: "clear",
      description: "Clear all preset notes",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleNotesCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  // Get world for this channel
  const world = getWorldState(channelId);
  if (!world) {
    await respond(bot, interaction, "No world configured for this channel. Use `/setup` first.", true);
    return;
  }

  const config = getWorldConfig(world.id);

  switch (subcommand) {
    case "add": {
      const content = getOptionValue<string>(interaction, "content")!;
      const depthStr = getOptionValue<string>(interaction, "depth") ?? "4";

      // Parse depth
      let depth: "system" | "start" | number;
      if (depthStr === "system") {
        depth = "system";
      } else if (depthStr === "start") {
        depth = "start";
      } else {
        const num = parseInt(depthStr);
        if (isNaN(num) || num < 0) {
          await respond(bot, interaction, "Depth must be 'system', 'start', or a positive number.", true);
          return;
        }
        depth = num;
      }

      const note: PresetNote = { content, depth };
      const notes = [...(config.context.presetNotes || []), note];

      setWorldConfig(world.id, {
        context: { presetNotes: notes },
      });

      const depthLabel = typeof depth === "number" ? `depth ${depth}` : depth;
      await respond(bot, interaction, `Added preset note at ${depthLabel}: "${content.slice(0, 100)}${content.length > 100 ? "..." : ""}"`);
      break;
    }

    case "list": {
      const notes = config.context.presetNotes || [];
      if (notes.length === 0) {
        await respond(bot, interaction, "No preset notes configured.\n\nUse `/notes add` to add Author's Notes that will be injected into the AI context.", true);
        return;
      }

      const lines = notes.map((note, i) => {
        const depthLabel = typeof note.depth === "number" ? `depth ${note.depth}` : note.depth;
        const preview = note.content.length > 100 ? note.content.slice(0, 100) + "..." : note.content;
        return `**${i}.** [${depthLabel}] ${preview}`;
      });

      await respond(bot, interaction, `**Preset Notes:**\n\n${lines.join("\n\n")}\n\n-# Use \`/notes remove <index>\` to remove a note`, true);
      break;
    }

    case "remove": {
      const index = getOptionValue<number>(interaction, "index")!;
      const notes = config.context.presetNotes || [];

      if (index < 0 || index >= notes.length) {
        await respond(bot, interaction, `Invalid index. Use \`/notes list\` to see available notes (0-${notes.length - 1}).`, true);
        return;
      }

      const removed = notes[index];
      const newNotes = notes.filter((_, i) => i !== index);

      setWorldConfig(world.id, {
        context: { presetNotes: newNotes },
      });

      await respond(bot, interaction, `Removed note: "${removed.content.slice(0, 50)}..."`);
      break;
    }

    case "clear": {
      setWorldConfig(world.id, {
        context: { presetNotes: [] },
      });

      await respond(bot, interaction, "Cleared all preset notes.");
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.", true);
  }
}
