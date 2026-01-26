import {
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getSubcommand, getOptionValue, respond, respondDeferred, editResponse } from "./index";
import { GUILD_ONLY_INTEGRATION } from "./integration";
import { getWorldState } from "../../world/state";
import { getWorldConfig } from "../../config";
import {
  generateImage,
  generatePortrait,
  generateExpression,
  listWorkflows,
  createImageContext,
  isImageGenerationAvailable,
} from "../../images";
import { getDb } from "../../db";

export const imagineCommand = {
  name: "imagine",
  description: "Generate images using AI",
  ...GUILD_ONLY_INTEGRATION,
  options: [
    {
      name: "prompt",
      description: "Generate an image from a text prompt",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "prompt",
          description: "The image prompt",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "workflow",
          description: "Workflow to use (default: portrait)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "width",
          description: "Image width (default: 1024)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 512,
          maxValue: 2048,
        },
        {
          name: "height",
          description: "Image height (default: 1024)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 512,
          maxValue: 2048,
        },
        {
          name: "negative",
          description: "Negative prompt (things to avoid)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "character",
      description: "Generate an image using a character's saved prompt",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character name or ID",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "extra",
          description: "Additional prompt to append (e.g., action, setting)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "negative",
          description: "Override/append to character's negative prompt",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "workflow",
          description: "Workflow to use (default: portrait)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "portrait",
      description: "Generate a character portrait from description",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character name or ID",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "expression",
      description: "Generate a character expression",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character name or ID",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "emotion",
          description: "Expression/emotion (e.g., happy, sad, angry)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "workflows",
      description: "List available workflows",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleImagineCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);

  switch (subcommand) {
    case "prompt":
      await handlePromptSubcommand(bot, interaction);
      break;
    case "character":
      await handleCharacterSubcommand(bot, interaction);
      break;
    case "portrait":
      await handlePortraitSubcommand(bot, interaction);
      break;
    case "expression":
      await handleExpressionSubcommand(bot, interaction);
      break;
    case "workflows":
      await handleWorkflowsSubcommand(bot, interaction);
      break;
    default:
      await respond(bot, interaction, "Unknown subcommand", true);
  }
}

async function handlePromptSubcommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString();
  if (!channelId) {
    await respond(bot, interaction, "Could not determine channel.", true);
    return;
  }

  // Get world and config
  const world = getWorldState(channelId);
  if (!world) {
    await respond(bot, interaction, "No world configured for this channel. Use `/setup` first.", true);
    return;
  }

  const config = getWorldConfig(world.id);
  if (!isImageGenerationAvailable(config.images)) {
    await respond(
      bot,
      interaction,
      "Image generation is not configured. Set up a ComfyUI host in your environment variables.",
      true
    );
    return;
  }

  const prompt = getOptionValue<string>(interaction, "prompt");
  const negativePrompt = getOptionValue<string>(interaction, "negative");
  const workflowId = getOptionValue<string>(interaction, "workflow");
  const width = getOptionValue<number>(interaction, "width");
  const height = getOptionValue<number>(interaction, "height");

  if (!prompt) {
    await respond(bot, interaction, "Please provide a prompt.", true);
    return;
  }

  // Defer the response since image generation takes time
  await respondDeferred(bot, interaction);

  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  try {
    const ctx = createImageContext(config.images, { userId, guildId });
    if (!ctx) {
      await editResponse(bot, interaction, "Failed to initialize image generation.");
      return;
    }

    const result = await generateImage(
      {
        workflow: workflowId || config.images.defaultWorkflow,
        variables: { prompt, negative_prompt: negativePrompt },
        width,
        height,
      },
      config.images,
      ctx.storage,
      ctx.host
    );

    // Store the generated image in the database
    const db = getDb();
    db.prepare(
      `INSERT INTO generated_images (world_id, image_type, workflow_id, variables, url, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      world.id,
      "custom",
      result.workflow,
      JSON.stringify(result.variables),
      result.url,
      result.width,
      result.height
    );

    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `Generated image for: *${prompt}*`,
      embeds: [
        {
          image: { url: result.url },
          footer: { text: `Workflow: ${result.workflow} | ${result.width}x${result.height}` },
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await editResponse(bot, interaction, `Failed to generate image: ${message}`);
  }
}

async function handleCharacterSubcommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString();
  if (!channelId) {
    await respond(bot, interaction, "Could not determine channel.", true);
    return;
  }

  const world = getWorldState(channelId);
  if (!world) {
    await respond(bot, interaction, "No world configured for this channel. Use `/setup` first.", true);
    return;
  }

  const config = getWorldConfig(world.id);
  if (!isImageGenerationAvailable(config.images)) {
    await respond(
      bot,
      interaction,
      "Image generation is not configured. Set up a ComfyUI host in your environment variables.",
      true
    );
    return;
  }

  const characterQuery = getOptionValue<string>(interaction, "character");
  if (!characterQuery) {
    await respond(bot, interaction, "Please specify a character.", true);
    return;
  }

  // Find character
  const db = getDb();
  const character = db
    .prepare(
      `SELECT id, name, data FROM entities
       WHERE world_id = ? AND type = 'character'
       AND (id = ? OR name LIKE ? COLLATE NOCASE)
       LIMIT 1`
    )
    .get(world.id, parseInt(characterQuery) || 0, `%${characterQuery}%`) as {
    id: number;
    name: string;
    data: string;
  } | null;

  if (!character) {
    await respond(bot, interaction, `Character not found: ${characterQuery}`, true);
    return;
  }

  const characterData = JSON.parse(character.data) as {
    imagePrompt?: string;
    imageNegative?: string;
    description?: string;
    appearance?: string;
  };

  // Check if character has an image prompt
  if (!characterData.imagePrompt) {
    await respond(
      bot,
      interaction,
      `**${character.name}** doesn't have a saved image prompt. Use \`/character edit\` to add one, or use \`/imagine portrait\` to generate from description.`,
      true
    );
    return;
  }

  const extraPrompt = getOptionValue<string>(interaction, "extra");
  const negativeOverride = getOptionValue<string>(interaction, "negative");
  const workflowId = getOptionValue<string>(interaction, "workflow");

  // Build final prompt
  const promptParts = [characterData.imagePrompt];
  if (extraPrompt) {
    promptParts.push(extraPrompt);
  }
  const finalPrompt = promptParts.join(", ");

  // Build negative prompt
  const negativeParts: string[] = [];
  if (characterData.imageNegative) {
    negativeParts.push(characterData.imageNegative);
  }
  if (negativeOverride) {
    negativeParts.push(negativeOverride);
  }
  const finalNegative = negativeParts.length > 0 ? negativeParts.join(", ") : undefined;

  // Defer the response
  await respondDeferred(bot, interaction);

  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  try {
    const ctx = createImageContext(config.images, { userId, guildId });
    if (!ctx) {
      await editResponse(bot, interaction, "Failed to initialize image generation.");
      return;
    }

    const result = await generateImage(
      {
        workflow: workflowId || config.images.defaultWorkflow,
        variables: {
          prompt: finalPrompt,
          negative_prompt: finalNegative,
        },
      },
      config.images,
      ctx.storage,
      ctx.host
    );

    // Store the generated image
    db.prepare(
      `INSERT INTO generated_images (world_id, entity_id, entity_type, image_type, workflow_id, variables, url, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      world.id,
      character.id,
      "character",
      "custom",
      result.workflow,
      JSON.stringify(result.variables),
      result.url,
      result.width,
      result.height
    );

    const extraNote = extraPrompt ? `\n*Extra: ${extraPrompt}*` : "";
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `**${character.name}**${extraNote}`,
      embeds: [
        {
          image: { url: result.url },
          footer: { text: `Workflow: ${result.workflow} | ${result.width}x${result.height}` },
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await editResponse(bot, interaction, `Failed to generate image: ${message}`);
  }
}

async function handlePortraitSubcommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString();
  if (!channelId) {
    await respond(bot, interaction, "Could not determine channel.", true);
    return;
  }

  const world = getWorldState(channelId);
  if (!world) {
    await respond(bot, interaction, "No world configured for this channel. Use `/setup` first.", true);
    return;
  }

  const config = getWorldConfig(world.id);
  if (!isImageGenerationAvailable(config.images)) {
    await respond(
      bot,
      interaction,
      "Image generation is not configured. Set up a ComfyUI host in your environment variables.",
      true
    );
    return;
  }

  const characterQuery = getOptionValue<string>(interaction, "character");
  if (!characterQuery) {
    await respond(bot, interaction, "Please specify a character.", true);
    return;
  }

  // Find character by name or ID
  const db = getDb();
  const character = db
    .prepare(
      `SELECT id, name, data FROM entities
       WHERE world_id = ? AND type = 'character'
       AND (id = ? OR name LIKE ? COLLATE NOCASE)
       LIMIT 1`
    )
    .get(world.id, parseInt(characterQuery) || 0, `%${characterQuery}%`) as {
    id: number;
    name: string;
    data: string;
  } | null;

  if (!character) {
    await respond(bot, interaction, `Character not found: ${characterQuery}`, true);
    return;
  }

  const characterData = JSON.parse(character.data) as {
    description?: string;
    appearance?: string;
  };

  // Defer the response
  await respondDeferred(bot, interaction);

  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  try {
    const ctx = createImageContext(config.images, { userId, guildId });
    if (!ctx) {
      await editResponse(bot, interaction, "Failed to initialize image generation.");
      return;
    }

    const result = await generatePortrait(
      {
        name: character.name,
        description: characterData.description || "",
        appearance: characterData.appearance,
      },
      config.images,
      ctx.storage,
      ctx.host
    );

    // Store the generated image
    db.prepare(
      `INSERT INTO generated_images (world_id, entity_id, entity_type, image_type, workflow_id, variables, url, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      world.id,
      character.id,
      "character",
      "portrait",
      result.workflow,
      JSON.stringify(result.variables),
      result.url,
      result.width,
      result.height
    );

    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `Portrait of **${character.name}**`,
      embeds: [
        {
          image: { url: result.url },
          footer: { text: `${result.width}x${result.height}` },
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await editResponse(bot, interaction, `Failed to generate portrait: ${message}`);
  }
}

async function handleExpressionSubcommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString();
  if (!channelId) {
    await respond(bot, interaction, "Could not determine channel.", true);
    return;
  }

  const world = getWorldState(channelId);
  if (!world) {
    await respond(bot, interaction, "No world configured for this channel. Use `/setup` first.", true);
    return;
  }

  const config = getWorldConfig(world.id);
  if (!isImageGenerationAvailable(config.images)) {
    await respond(
      bot,
      interaction,
      "Image generation is not configured. Set up a ComfyUI host in your environment variables.",
      true
    );
    return;
  }

  const characterQuery = getOptionValue<string>(interaction, "character");
  const emotion = getOptionValue<string>(interaction, "emotion");

  if (!characterQuery || !emotion) {
    await respond(bot, interaction, "Please specify a character and emotion.", true);
    return;
  }

  // Find character
  const db = getDb();
  const character = db
    .prepare(
      `SELECT id, name, data FROM entities
       WHERE world_id = ? AND type = 'character'
       AND (id = ? OR name LIKE ? COLLATE NOCASE)
       LIMIT 1`
    )
    .get(world.id, parseInt(characterQuery) || 0, `%${characterQuery}%`) as {
    id: number;
    name: string;
    data: string;
  } | null;

  if (!character) {
    await respond(bot, interaction, `Character not found: ${characterQuery}`, true);
    return;
  }

  const characterData = JSON.parse(character.data) as {
    description?: string;
    appearance?: string;
  };

  // Defer the response
  await respondDeferred(bot, interaction);

  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  try {
    const ctx = createImageContext(config.images, { userId, guildId });
    if (!ctx) {
      await editResponse(bot, interaction, "Failed to initialize image generation.");
      return;
    }

    const result = await generateExpression(
      {
        name: character.name,
        description: characterData.description || "",
        appearance: characterData.appearance,
      },
      emotion,
      config.images,
      ctx.storage,
      ctx.host
    );

    // Store the generated image
    db.prepare(
      `INSERT INTO generated_images (world_id, entity_id, entity_type, image_type, workflow_id, variables, url, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      world.id,
      character.id,
      "character",
      "expression",
      result.workflow,
      JSON.stringify(result.variables),
      result.url,
      result.width,
      result.height
    );

    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `**${character.name}** - ${emotion}`,
      embeds: [
        {
          image: { url: result.url },
          footer: { text: `Expression: ${emotion} | ${result.width}x${result.height}` },
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await editResponse(bot, interaction, `Failed to generate expression: ${message}`);
  }
}

async function handleWorkflowsSubcommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString();
  const world = channelId ? getWorldState(channelId) : null;
  const config = world ? getWorldConfig(world.id) : null;

  const workflows = listWorkflows(config?.images);

  if (workflows.length === 0) {
    await respond(bot, interaction, "No workflows available.", true);
    return;
  }

  const lines = workflows.map((w) => {
    const vars = w.variables
      .filter((v) => v.required)
      .map((v) => v.name)
      .join(", ");
    return `**${w.id}** - ${w.name}\n  ${w.description}\n  Required: ${vars || "none"}`;
  });

  await respond(bot, interaction, `**Available Workflows**\n\n${lines.join("\n\n")}`, true);
}
