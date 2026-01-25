import {
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import {
  roll,
  rollWithAttributes,
  rollMultiple,
  validateExpression,
  formatRollForDisplay,
} from "../../dice";
import { getActiveScene } from "../../scene";

export const rollCommand = {
  name: "roll",
  description: "Roll dice",
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
      name: "expression",
      description: "Dice expression (e.g., 2d6+3, 4d6kh3, d20+@strength)",
      type: ApplicationCommandOptionTypes.String,
      required: true,
    },
    {
      name: "label",
      description: "Label for the roll (e.g., \"Attack Roll\")",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
    {
      name: "character",
      description: "Character ID for @attribute substitution",
      type: ApplicationCommandOptionTypes.Integer,
      required: false,
    },
    {
      name: "times",
      description: "Roll multiple times (e.g., 6 for ability scores)",
      type: ApplicationCommandOptionTypes.Integer,
      required: false,
      minValue: 1,
      maxValue: 20,
    },
    {
      name: "secret",
      description: "Roll secretly (only you can see)",
      type: ApplicationCommandOptionTypes.Boolean,
      required: false,
    },
  ],
};

// Short alias
export const rCommand = {
  name: "r",
  description: "Roll dice (shorthand)",
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
      name: "expression",
      description: "Dice expression (e.g., 2d6+3, d20+5)",
      type: ApplicationCommandOptionTypes.String,
      required: true,
    },
  ],
};

export async function handleRollCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const options = interaction.data?.options ?? [];
  const expression = options.find((o: { name: string }) => o.name === "expression")?.value as string;
  const label = options.find((o: { name: string }) => o.name === "label")?.value as string | undefined;
  const characterId = options.find((o: { name: string }) => o.name === "character")?.value as number | undefined;
  const times = options.find((o: { name: string }) => o.name === "times")?.value as number | undefined;
  const secret = options.find((o: { name: string }) => o.name === "secret")?.value as boolean | undefined;

  if (!expression) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please provide a dice expression.", flags: 64 },
    });
    return;
  }

  // Validate expression
  const validation = validateExpression(expression);
  if (!validation.valid) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: `Invalid expression: ${validation.error}\n\nExamples: \`2d6+3\`, \`4d6kh3\`, \`d20+5\`, \`d20+@strength\``,
        flags: 64,
      },
    });
    return;
  }

  const flags = secret ? 64 : 0;

  // Multiple rolls
  if (times && times > 1) {
    const results = rollMultiple(expression, times);
    const lines = results.map((r, i) =>
      `${i + 1}. ${formatRollForDisplay(r)}`
    );

    const totals = results.map((r) => r.total);
    const sum = totals.reduce((a, b) => a + b, 0);

    let content = label ? `**${label}** (${times}x)\n` : "";
    content += lines.join("\n");
    content += `\n\nTotal: **${sum}** | Average: **${(sum / times).toFixed(1)}**`;

    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content, flags },
    });
    return;
  }

  // Single roll
  let result;

  if (characterId && expression.includes("@")) {
    const channelId = interaction.channelId?.toString() ?? "";
    const scene = getActiveScene(channelId);
    result = rollWithAttributes(expression, characterId, scene?.id ?? null);
  } else {
    result = roll(expression);
  }

  const display = formatRollForDisplay(result, label);
  const userName = interaction.member?.nick ?? interaction.user?.username ?? "Someone";

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: {
      content: `🎲 **${userName}** rolled:\n${display}`,
      flags,
    },
  });
}

// Short /r handler - delegates to the same logic
export async function handleRCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  await handleRollCommand(bot, interaction);
}
