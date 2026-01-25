import {
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getEntity } from "../../db/entities";
import { getActiveScene } from "../../scene";
import {
  createFaction,
  getFaction,
  listFactions,
  joinFaction,
  leaveFaction,
  getFactionMembers,
  getCharacterFactions,
  modifyMemberStanding,
  setMemberRank,
  setFactionRelation,
  formatFactionForDisplay,
  type FactionRelation,
} from "../../factions";

export const factionCommand = {
  name: "faction",
  description: "Manage factions and membership",
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
      name: "list",
      description: "List all factions",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "info",
      description: "Show faction details",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction",
          description: "Faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "create",
      description: "Create a new faction",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Faction name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "description",
          description: "Faction description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "motto",
          description: "Faction motto",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "join",
      description: "Add a character to a faction",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction",
          description: "Faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character",
          description: "Character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "rank",
          description: "Starting rank",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "leave",
      description: "Remove a character from a faction",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction",
          description: "Faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character",
          description: "Character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "rank",
      description: "Set a member's rank",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction",
          description: "Faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character",
          description: "Character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "title",
          description: "Rank title (leave empty to clear)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "standing",
      description: "Modify a member's standing in a faction",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction",
          description: "Faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "character",
          description: "Character ID",
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
      ],
    },
    {
      name: "members",
      description: "List faction members",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction",
          description: "Faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "affiliations",
      description: "Show which factions a character belongs to",
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
      name: "relation",
      description: "Set relation between two factions",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "faction1",
          description: "First faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "faction2",
          description: "Second faction ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "status",
          description: "Relation status",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "Allied", value: "allied" },
            { name: "Neutral", value: "neutral" },
            { name: "Hostile", value: "hostile" },
            { name: "War", value: "war" },
          ],
        },
        {
          name: "standing",
          description: "Standing value (-100 to 100)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: -100,
          maxValue: 100,
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

export async function handleFactionCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const subcommand = interaction.data?.options?.[0]?.name;

  const respond = async (content: string, ephemeral = false) => {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content, flags: ephemeral ? 64 : 0 },
    });
  };

  // Get world ID from active scene if available
  const scene = getActiveScene(channelId);
  const worldId = scene?.worldId;

  switch (subcommand) {
    case "list": {
      const factions = listFactions(worldId);
      if (factions.length === 0) {
        await respond("No factions found.", true);
        return;
      }

      const lines = ["**Factions:**\n"];
      for (const f of factions) {
        const members = getFactionMembers(f.id);
        let line = `**${f.name}** (ID: ${f.id}) - ${members.length} members`;
        if (f.data.motto) line += `\n  *"${f.data.motto}"*`;
        lines.push(line);
      }

      await respond(lines.join("\n"));
      return;
    }

    case "info": {
      const factionId = getSubOpt<number>(interaction, "faction")!;
      const faction = getFaction(factionId);
      if (!faction) {
        await respond("Faction not found.", true);
        return;
      }

      await respond(formatFactionForDisplay(faction));
      return;
    }

    case "create": {
      const name = getSubOpt<string>(interaction, "name")!;
      const description = getSubOpt<string>(interaction, "description")!;
      const motto = getSubOpt<string>(interaction, "motto");

      const faction = createFaction(
        name,
        { description, motto: motto ?? undefined },
        worldId
      );

      await respond(`Faction created: **${faction.name}** (ID: ${faction.id})\n${description}`);
      return;
    }

    case "join": {
      const factionId = getSubOpt<number>(interaction, "faction")!;
      const characterId = getSubOpt<number>(interaction, "character")!;
      const rank = getSubOpt<string>(interaction, "rank");

      const faction = getFaction(factionId);
      if (!faction) {
        await respond("Faction not found.", true);
        return;
      }

      const entity = getEntity(characterId);
      if (!entity) {
        await respond("Character not found.", true);
        return;
      }

      const member = joinFaction(factionId, characterId, {
        rank: rank ?? undefined,
      });

      let msg = `**${entity.name}** joined **${faction.name}**!`;
      if (member.rank) msg += ` Rank: ${member.rank}`;

      await respond(msg);
      return;
    }

    case "leave": {
      const factionId = getSubOpt<number>(interaction, "faction")!;
      const characterId = getSubOpt<number>(interaction, "character")!;

      const faction = getFaction(factionId);
      const entity = getEntity(characterId);
      const ok = leaveFaction(factionId, characterId);

      if (ok) {
        await respond(`**${entity?.name ?? characterId}** left **${faction?.name ?? factionId}**.`);
      } else {
        await respond("Member not found in faction.", true);
      }
      return;
    }

    case "rank": {
      const factionId = getSubOpt<number>(interaction, "faction")!;
      const characterId = getSubOpt<number>(interaction, "character")!;
      const title = getSubOpt<string>(interaction, "title")!;

      const faction = getFaction(factionId);
      const entity = getEntity(characterId);

      const rankValue = title === "none" || title === "" ? null : title;
      const ok = setMemberRank(factionId, characterId, rankValue);

      if (ok) {
        await respond(
          `**${entity?.name ?? characterId}**'s rank in **${faction?.name ?? factionId}**: ${rankValue ?? "None"}`
        );
      } else {
        await respond("Member not found in faction.", true);
      }
      return;
    }

    case "standing": {
      const factionId = getSubOpt<number>(interaction, "faction")!;
      const characterId = getSubOpt<number>(interaction, "character")!;
      const amount = getSubOpt<number>(interaction, "amount")!;

      const faction = getFaction(factionId);
      const entity = getEntity(characterId);

      const result = modifyMemberStanding(factionId, characterId, amount);
      if (!result) {
        await respond("Member not found in faction.", true);
        return;
      }

      await respond(
        `**${entity?.name ?? characterId}**'s standing in **${faction?.name ?? factionId}**: **${result.standing}**`
      );
      return;
    }

    case "members": {
      const factionId = getSubOpt<number>(interaction, "faction")!;
      const faction = getFaction(factionId);
      if (!faction) {
        await respond("Faction not found.", true);
        return;
      }

      const members = getFactionMembers(factionId);
      if (members.length === 0) {
        await respond(`**${faction.name}** has no members.`, true);
        return;
      }

      const lines = [`**${faction.name}** Members (${members.length}):\n`];
      for (const m of members) {
        const entity = getEntity(m.characterId);
        let line = `**${entity?.name ?? m.characterId}**`;
        if (m.rank) line += ` - ${m.rank}`;
        line += ` | Standing: ${m.standing}`;
        if (!m.isPublic) line += " [Secret]";
        lines.push(line);
      }

      await respond(lines.join("\n"));
      return;
    }

    case "affiliations": {
      const characterId = getSubOpt<number>(interaction, "character")!;
      const entity = getEntity(characterId);
      if (!entity) {
        await respond("Character not found.", true);
        return;
      }

      const factions = getCharacterFactions(characterId);
      if (factions.length === 0) {
        await respond(`**${entity.name}** is not a member of any faction.`, true);
        return;
      }

      const lines = [`**${entity.name}**'s Factions:\n`];
      for (const { faction, membership } of factions) {
        let line = `**${faction.name}**`;
        if (membership.rank) line += ` (${membership.rank})`;
        line += ` | Standing: ${membership.standing}`;
        if (!membership.isPublic) line += " [Secret]";
        lines.push(line);
      }

      await respond(lines.join("\n"));
      return;
    }

    case "relation": {
      const factionId1 = getSubOpt<number>(interaction, "faction1")!;
      const factionId2 = getSubOpt<number>(interaction, "faction2")!;
      const status = getSubOpt<string>(interaction, "status")! as FactionRelation["status"];
      const standing = getSubOpt<number>(interaction, "standing") ?? 0;

      const f1 = getFaction(factionId1);
      const f2 = getFaction(factionId2);
      if (!f1 || !f2) {
        await respond("One or both factions not found.", true);
        return;
      }

      setFactionRelation(factionId1, factionId2, standing, status);

      const statusEmoji = { allied: "🤝", neutral: "➖", hostile: "⚠️", war: "⚔️" }[status];
      await respond(
        `${statusEmoji} **${f1.name}** ↔ **${f2.name}**: ${status} (standing: ${standing})`
      );
      return;
    }

    default:
      await respond("Unknown subcommand.", true);
  }
}
