/**
 * /debug Command
 *
 * Debug and inspection tools for context preview, tracing, and diagnostics.
 */

import { ApplicationCommandOptionTypes } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getSubcommand, respond } from "./index";
import { GUILD_ONLY_INTEGRATION } from "./integration";
import { getWorldState } from "../../world/state";
import { getWorldConfig } from "../../config";
import { createContext, runFormatters } from "../../plugins/registry";
import type { PluginContext } from "../../plugins/types";
import { allocateBudget, estimateTokens } from "../../ai/budget";
import { getActiveScene, getSceneCharacters } from "../../scene";
import { DEFAULT_CONFIG } from "../../config/defaults";
import { getRecentTraces, formatTrace } from "../../ai/debug";

export const debugCommand = {
  name: "debug",
  description: "Debug and inspection tools",
  ...GUILD_ONLY_INTEGRATION,
  options: [
    {
      name: "context",
      description: "Preview the assembled AI context for this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "full",
          description: "Show full content instead of redacted preview",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
      ],
    },
    {
      name: "trace",
      description: "Show recent context assembly traces",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleDebugCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  switch (subcommand) {
    case "context": {
      const showFull = interaction.data?.options?.[0]?.options?.find(
        (o) => o.name === "full"
      )?.value as boolean | undefined;

      await previewContext(bot, interaction, channelId, guildId, showFull ?? false);
      break;
    }

    case "trace": {
      const traces = getRecentTraces(channelId);
      if (traces.length === 0) {
        await respond(bot, interaction, "No recent context traces for this channel.", true);
        return;
      }

      const latest = traces[traces.length - 1];
      const formatted = formatTrace(latest);

      // Truncate if too long for Discord
      const output = formatted.length > 1900
        ? formatted.slice(0, 1900) + "\n...(truncated)"
        : formatted;

      await respond(bot, interaction, `\`\`\`\n${output}\n\`\`\``, true);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.", true);
  }
}

/**
 * Preview the assembled context without calling the LLM.
 * Shows sections, token counts, and optionally the full content.
 */
async function previewContext(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string,
  guildId: string | undefined,
  showFull: boolean
): Promise<void> {
  // Get world and config
  const world = getWorldState(channelId);
  const config = world ? getWorldConfig(world.id) : DEFAULT_CONFIG;

  // Get active scene and characters
  const scene = getActiveScene(channelId);
  const sceneChars = scene ? getSceneCharacters(scene.id) : [];
  const activeCharacterIds = sceneChars
    .filter((c) => c.isActive && c.isAI)
    .map((c) => c.characterId);

  // Create a mock context for formatter execution
  const ctx: PluginContext = createContext({
    channelId,
    guildId,
    authorId: interaction.user?.id?.toString() ?? "0",
    authorName: interaction.user?.username ?? "User",
    content: "[Context Preview - No actual message]",
    isBotMentioned: true,
    config,
  });

  // Populate scene data
  ctx.scene = scene;
  ctx.worldId = world?.id;
  ctx.activeCharacterIds = activeCharacterIds;

  // Run formatters to get sections
  const sections = await runFormatters(ctx);

  // Allocate budget
  const maxTokens = config?.context?.maxTokens ?? 8000;
  const budgetResult = allocateBudget(
    sections.map((s) => ({
      name: s.name,
      content: s.content,
      priority: s.priority,
      canTruncate: s.canTruncate,
      minTokens: s.minTokens,
    })),
    maxTokens
  );

  // Build output
  const lines: string[] = [];
  lines.push("# Context Preview");
  lines.push("");

  // Summary stats
  const totalTokens = budgetResult.sections.reduce(
    (sum, s) => sum + estimateTokens(s.content),
    0
  );
  lines.push(`**Budget:** ${totalTokens} / ${maxTokens} tokens (~${Math.round(totalTokens / maxTokens * 100)}%)`);
  lines.push(`**Sections:** ${budgetResult.sections.length}`);
  if (scene) {
    lines.push(`**Scene:** #${scene.id}`);
  }
  lines.push(`**Characters:** ${activeCharacterIds.length}`);
  lines.push("");

  // Section breakdown
  lines.push("## Sections");
  lines.push("");

  for (const section of budgetResult.sections) {
    const wasTruncated = budgetResult.truncatedSections.includes(section.name);
    const truncatedLabel = wasTruncated ? " *(truncated)*" : "";
    lines.push(`### ${section.name}${truncatedLabel}`);
    lines.push(`*~${section.tokens} tokens*`);
    lines.push("");

    if (showFull) {
      // Show full content (up to 500 chars per section to avoid hitting Discord limits)
      const preview = section.content.length > 500
        ? section.content.slice(0, 500) + "\n...(truncated)"
        : section.content;
      lines.push("```");
      lines.push(preview);
      lines.push("```");
    } else {
      // Show redacted preview with structure hints
      const preview = redactContent(section.content, section.name);
      lines.push("```");
      lines.push(preview);
      lines.push("```");
    }
    lines.push("");
  }

  // Warnings
  const warnings: string[] = [];
  if (budgetResult.droppedSections.length > 0) {
    warnings.push(`Dropped sections (over budget): ${budgetResult.droppedSections.join(", ")}`);
  }
  if (budgetResult.truncatedSections.length > 0) {
    warnings.push(`Truncated sections: ${budgetResult.truncatedSections.join(", ")}`);
  }
  if (totalTokens > maxTokens * 0.9) {
    warnings.push("Context is near budget limit - some content may be truncated");
  }
  if (activeCharacterIds.length === 0) {
    warnings.push("No active characters in scene");
  }

  if (warnings.length > 0) {
    lines.push("## Warnings");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  // Join and truncate if needed
  let output = lines.join("\n");
  if (output.length > 1900) {
    output = output.slice(0, 1900) + "\n\n...(output truncated)";
  }

  await respond(bot, interaction, output, true);
}

/**
 * Redact sensitive content while preserving structure.
 * Shows section headers and placeholders instead of actual content.
 */
function redactContent(content: string, sectionName: string): string {
  const lines = content.split("\n");
  const output: string[] = [];

  let insideBlock = false;

  for (const line of lines) {
    // Preserve headers
    if (line.startsWith("#")) {
      output.push(line);
      continue;
    }

    // Preserve empty lines
    if (line.trim() === "") {
      output.push("");
      continue;
    }

    // Preserve list structure indicators
    if (line.trim().startsWith("-") || line.trim().startsWith("*")) {
      // Show first word after bullet, redact rest
      const match = line.match(/^(\s*[-*]\s*)(\S+)/);
      if (match) {
        output.push(`${match[1]}${match[2]} [...]`);
      } else {
        output.push(line.replace(/(\s*[-*]\s*).*/, "$1[...]"));
      }
      continue;
    }

    // Preserve key: value structure
    if (line.includes(":") && !insideBlock) {
      const [key] = line.split(":");
      output.push(`${key}: [redacted]`);
      continue;
    }

    // Default: show placeholder based on line length
    const wordCount = line.split(/\s+/).length;
    if (wordCount <= 3) {
      output.push("[...]");
    } else if (wordCount <= 10) {
      output.push("[... short text ...]");
    } else {
      output.push("[... paragraph ...]");
    }
  }

  // Dedupe consecutive identical placeholders
  const deduped: string[] = [];
  for (const line of output) {
    if (deduped.length === 0 || line !== deduped[deduped.length - 1]) {
      deduped.push(line);
    }
  }

  return deduped.slice(0, 20).join("\n") + (deduped.length > 20 ? "\n..." : "");
}
