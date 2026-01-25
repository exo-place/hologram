import {
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getEntity } from "../../db/entities";
import {
  getRelationship,
  getEnhancedRelationships,
  setRelationshipData,
  modifyAffinity,
  modifyTrust,
  addRelationshipHistory,
  getAffinityLabel,
  formatRelationshipForDisplay,
} from "../../relationships";
import { getWorldConfig } from "../../config/defaults";
import { getActiveScene } from "../../scene";

export const relationshipCommand = {
  name: "relationship",
  description: "Manage character relationships",
  integrationTypes: [
    DiscordApplicationIntegrationType.GuildInstall,
    DiscordApplicationIntegrationType.UserInstall,
  ],
  contexts: [
    DiscordInteractionContextType.Guild,
    DiscordInteractionContextType.BotDm,
  ],
  options: [
    {
      name: "show",
      description: "Show the relationship between two characters",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character1",
          description: "First character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character2",
          description: "Second character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "set",
      description: "Set or create a relationship between characters",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "source",
          description: "Source character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "target",
          description: "Target character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "type",
          description: "Relationship type (e.g., friend, rival, family)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "affinity",
          description: "Starting affinity (-100 to 100)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: -100,
          maxValue: 100,
        },
        {
          name: "trust",
          description: "Starting trust (0 to 100)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 0,
          maxValue: 100,
        },
      ],
    },
    {
      name: "list",
      description: "List all relationships for a character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "affinity",
      description: "Modify affinity between two characters",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character1",
          description: "First character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character2",
          description: "Second character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "amount",
          description: "Amount to change (positive or negative)",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
          minValue: -200,
          maxValue: 200,
        },
        {
          name: "reason",
          description: "Reason for the change (added to history)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "trust",
      description: "Modify trust between two characters",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character1",
          description: "First character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character2",
          description: "Second character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "amount",
          description: "Amount to change (positive or negative)",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
          minValue: -100,
          maxValue: 100,
        },
        {
          name: "reason",
          description: "Reason for the change",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "history",
      description: "Show relationship history between two characters",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character1",
          description: "First character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character2",
          description: "Second character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "note",
      description: "Add a history note to a relationship",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character1",
          description: "First character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character2",
          description: "Second character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "text",
          description: "Note to add to relationship history",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
  ],
};

function getSubOpt<T>(interaction: HologramInteraction, name: string): T | undefined {
  const options = interaction.data?.options ?? [];
  if (options.length === 0) return undefined;
  const sub = options[0];
  if (!sub.options) return undefined;
  const opt = sub.options.find((o: { name: string }) => o.name === name);
  return opt?.value as T | undefined;
}

function getRelConfig(channelId: string) {
  const scene = getActiveScene(channelId);
  if (scene) {
    return getWorldConfig(scene.worldId);
  }
  return null;
}

export async function handleRelationshipCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const subcommand = interaction.data?.options?.[0]?.name;
  const worldConfig = getRelConfig(channelId);

  const respond = async (content: string, ephemeral = false) => {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content, flags: ephemeral ? 64 : 0 },
    });
  };

  switch (subcommand) {
    case "show": {
      const char1 = getSubOpt<number>(interaction, "character1")!;
      const char2 = getSubOpt<number>(interaction, "character2")!;

      const rel = getRelationship(char1, char2);
      if (!rel) {
        const e1 = getEntity(char1);
        const e2 = getEntity(char2);
        await respond(
          `No relationship found between **${e1?.name ?? char1}** and **${e2?.name ?? char2}**.`,
          true
        );
        return;
      }

      await respond(formatRelationshipForDisplay(rel, worldConfig?.relationships));
      return;
    }

    case "set": {
      const sourceId = getSubOpt<number>(interaction, "source")!;
      const targetId = getSubOpt<number>(interaction, "target")!;
      const type = getSubOpt<string>(interaction, "type")!;
      const affinity = getSubOpt<number>(interaction, "affinity");
      const trust = getSubOpt<number>(interaction, "trust");

      const source = getEntity(sourceId);
      const target = getEntity(targetId);
      if (!source || !target) {
        await respond("One or both characters not found.", true);
        return;
      }

      const rel = setRelationshipData(sourceId, targetId, type, {
        affinity: affinity ?? 0,
        trust: trust ?? 50,
        familiarity: 0,
        status: "active",
      });

      await respond(
        `Relationship set: **${source.name}** → **${target.name}**: ${type}\n` +
          `Affinity: ${rel.relData.affinity ?? 0} | Trust: ${rel.relData.trust ?? 50}`
      );
      return;
    }

    case "list": {
      const charId = getSubOpt<number>(interaction, "character")!;
      const entity = getEntity(charId);
      if (!entity) {
        await respond("Character not found.", true);
        return;
      }

      const rels = getEnhancedRelationships(charId);
      if (rels.length === 0) {
        await respond(`**${entity.name}** has no relationships.`, true);
        return;
      }

      const lines: string[] = [`**${entity.name}**'s Relationships:\n`];

      for (const rel of rels) {
        const otherId = rel.sourceId === charId ? rel.targetId : rel.sourceId;
        const other = getEntity(otherId);
        const direction = rel.sourceId === charId ? "→" : "←";

        let line = `${direction} **${other?.name ?? otherId}**: ${rel.type}`;

        if (rel.relData.affinity !== undefined && worldConfig?.relationships.useAffinity) {
          const label = getAffinityLabel(rel.relData.affinity, worldConfig.relationships);
          line += ` (${rel.relData.affinity}, ${label})`;
        }

        if (rel.relData.status && rel.relData.status !== "active") {
          line += ` [${rel.relData.status}]`;
        }

        lines.push(line);
      }

      await respond(lines.join("\n"));
      return;
    }

    case "affinity": {
      const char1 = getSubOpt<number>(interaction, "character1")!;
      const char2 = getSubOpt<number>(interaction, "character2")!;
      const amount = getSubOpt<number>(interaction, "amount")!;
      const reason = getSubOpt<string>(interaction, "reason");

      const result = modifyAffinity(char1, char2, amount, reason, worldConfig?.relationships);
      if (!result) {
        await respond("No relationship found between these characters.", true);
        return;
      }

      const e1 = getEntity(char1);
      const e2 = getEntity(char2);
      const label = getAffinityLabel(result.newAffinity, worldConfig?.relationships);

      let msg = `Affinity between **${e1?.name ?? char1}** and **${e2?.name ?? char2}**: **${result.newAffinity}** (${label})`;
      if (reason) {
        msg += `\nReason: ${reason}`;
      }

      await respond(msg);
      return;
    }

    case "trust": {
      const char1 = getSubOpt<number>(interaction, "character1")!;
      const char2 = getSubOpt<number>(interaction, "character2")!;
      const amount = getSubOpt<number>(interaction, "amount")!;
      const reason = getSubOpt<string>(interaction, "reason");

      const result = modifyTrust(char1, char2, amount, reason);
      if (!result) {
        await respond("No relationship found between these characters.", true);
        return;
      }

      const e1 = getEntity(char1);
      const e2 = getEntity(char2);

      let msg = `Trust between **${e1?.name ?? char1}** and **${e2?.name ?? char2}**: **${result.newTrust}**/100`;
      if (reason) {
        msg += `\nReason: ${reason}`;
      }

      await respond(msg);
      return;
    }

    case "history": {
      const char1 = getSubOpt<number>(interaction, "character1")!;
      const char2 = getSubOpt<number>(interaction, "character2")!;

      const rel = getRelationship(char1, char2);
      if (!rel) {
        await respond("No relationship found between these characters.", true);
        return;
      }

      const e1 = getEntity(char1);
      const e2 = getEntity(char2);
      const history = rel.relData.history ?? [];

      if (history.length === 0) {
        await respond(
          `No history recorded for **${e1?.name ?? char1}** & **${e2?.name ?? char2}**.`,
          true
        );
        return;
      }

      const lines: string[] = [
        `**Relationship History:** ${e1?.name ?? char1} & ${e2?.name ?? char2}\n`,
      ];

      for (const entry of history.slice(-20)) {
        const date = new Date(entry.timestamp * 1000).toLocaleDateString();
        let line = `\`${date}\` ${entry.event}`;
        if (entry.affinityChange !== undefined) {
          const sign = entry.affinityChange >= 0 ? "+" : "";
          line += ` *(${sign}${entry.affinityChange} affinity)*`;
        }
        lines.push(line);
      }

      await respond(lines.join("\n"));
      return;
    }

    case "note": {
      const char1 = getSubOpt<number>(interaction, "character1")!;
      const char2 = getSubOpt<number>(interaction, "character2")!;
      const text = getSubOpt<string>(interaction, "text")!;

      const ok = addRelationshipHistory(char1, char2, text);
      if (!ok) {
        await respond("No relationship found between these characters.", true);
        return;
      }

      const e1 = getEntity(char1);
      const e2 = getEntity(char2);
      await respond(
        `Added note to **${e1?.name ?? char1}** & **${e2?.name ?? char2}** history: ${text}`
      );
      return;
    }

    default:
      await respond("Unknown subcommand.", true);
  }
}
