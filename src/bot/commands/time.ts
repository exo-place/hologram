import {
  type Bot,
  type Interaction,
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import { getActiveScene } from "../../scene";
import {
  formatTime,
  formatDate,
  getTimePeriod,
  getSeason,
  parseDuration,
  parseTime,
  advanceSceneTime,
  setSceneTime,
  skipSceneToPeriod,
  scheduleEvent,
  getUpcomingEvents,
  cancelEvent,
  type ScheduledEvent,
} from "../../world/time";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = Bot<any, any>;
type AnyInteraction = Interaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const timeCommand = {
  name: "time",
  description: "Manage scene time and calendar",
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
      description: "Show current time and date",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "advance",
      description: "Advance time by a duration",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "duration",
          description: "Duration to advance (e.g., \"2 hours\", \"30 min\", \"1 day\")",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "set",
      description: "Set time to a specific value",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "time",
          description: "Time to set (e.g., \"14:30\", \"2pm\", \"8:00\")",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "day",
          description: "Day number to set",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
      ],
    },
    {
      name: "skip",
      description: "Skip to a time period",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "period",
          description: "Time period to skip to",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "Dawn", value: "dawn" },
            { name: "Morning", value: "morning" },
            { name: "Noon", value: "noon" },
            { name: "Afternoon", value: "afternoon" },
            { name: "Evening", value: "evening" },
            { name: "Dusk", value: "dusk" },
            { name: "Night", value: "night" },
            { name: "Midnight", value: "midnight" },
          ],
        },
      ],
    },
    {
      name: "event",
      description: "Manage scheduled events",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "schedule",
          description: "Schedule a future event",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "content",
              description: "Event description",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "time",
              description: "When to trigger (e.g., \"14:30\", \"2pm\")",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
            {
              name: "delay",
              description: "Time until event (e.g., \"2 hours\", \"1 day\")",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
            {
              name: "type",
              description: "Event type",
              type: ApplicationCommandOptionTypes.String,
              required: false,
              choices: [
                { name: "Reminder", value: "reminder" },
                { name: "Weather Change", value: "weather" },
                { name: "Arrival", value: "arrival" },
                { name: "Custom", value: "custom" },
              ],
            },
            {
              name: "recurring",
              description: "Recurrence pattern",
              type: ApplicationCommandOptionTypes.String,
              required: false,
              choices: [
                { name: "Daily", value: "daily" },
                { name: "Weekly", value: "weekly" },
                { name: "Monthly", value: "monthly" },
              ],
            },
          ],
        },
        {
          name: "list",
          description: "List upcoming events",
          type: ApplicationCommandOptionTypes.SubCommand,
        },
        {
          name: "cancel",
          description: "Cancel a scheduled event",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "id",
              description: "Event ID to cancel",
              type: ApplicationCommandOptionTypes.Integer,
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

export async function handleTimeCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = interaction.data?.options?.[0];
  if (!subcommand) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Invalid command.", flags: 64 },
    });
    return;
  }

  const channelId = interaction.channelId?.toString() ?? "";
  const scene = getActiveScene(channelId);

  if (!scene) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: "No active scene. Use `/scene start` first.",
        flags: 64,
      },
    });
    return;
  }

  switch (subcommand.name) {
    case "show":
      await handleShow(bot, interaction, scene);
      break;
    case "advance":
      await handleAdvance(bot, interaction, channelId, scene, subcommand.options);
      break;
    case "set":
      await handleSet(bot, interaction, channelId, scene, subcommand.options);
      break;
    case "skip":
      await handleSkip(bot, interaction, channelId, subcommand.options);
      break;
    case "event":
      await handleEvent(bot, interaction, scene, subcommand.options);
      break;
    default:
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: InteractionResponseTypes.ChannelMessageWithSource,
        data: { content: "Unknown subcommand.", flags: 64 },
      });
  }
}

interface CommandOption {
  name: string;
  value?: string | number | boolean;
  options?: CommandOption[];
}

interface SceneArg {
  id: number;
  worldId: number;
  time: { day: number; hour: number; minute: number };
  weather: string | null;
}

async function handleShow(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: SceneArg
): Promise<void> {
  const time = scene.time;
  const period = getTimePeriod(time.hour);
  const timeStr = formatTime(time);
  const dateStr = formatDate(time);
  const season = getSeason(time.day);

  const lines = [
    `**Time:** ${timeStr}`,
    `**Period:** ${period.name} (${period.lightLevel ?? "normal"} light)`,
    `**Date:** ${dateStr}`,
  ];

  if (season) {
    lines.push(`**Season:** ${season}`);
  }

  if (scene.weather) {
    lines.push(`**Weather:** ${scene.weather}`);
  }

  // Show upcoming events
  const events = getUpcomingEvents(scene.id, time, 3);
  if (events.length > 0) {
    lines.push("");
    lines.push("**Upcoming Events:**");
    for (const evt of events) {
      const evtTime = formatTime({
        day: evt.triggerDay,
        hour: evt.triggerHour,
        minute: evt.triggerMinute,
      });
      lines.push(`- [${evt.id}] ${evtTime}: ${evt.content} (${evt.type})`);
    }
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: lines.join("\n") },
  });
}

async function handleAdvance(
  bot: AnyBot,
  interaction: AnyInteraction,
  channelId: string,
  scene: SceneArg,
  options?: CommandOption[]
): Promise<void> {
  const durationStr = options?.find((o) => o.name === "duration")?.value as string;
  if (!durationStr) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify a duration.", flags: 64 },
    });
    return;
  }

  const duration = parseDuration(durationStr);
  if (!duration) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: "Could not parse duration. Try: \"2 hours\", \"30 min\", \"1 day\"",
        flags: 64,
      },
    });
    return;
  }

  const result = advanceSceneTime(channelId, duration);
  if (!result) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Failed to advance time.", flags: 64 },
    });
    return;
  }

  const newTime = result.scene.time;
  const period = getTimePeriod(newTime.hour);
  const lines = [
    `**Time advanced** → ${formatTime(newTime)} (${period.name})`,
  ];

  // Show triggered events
  if (result.triggered.length > 0) {
    lines.push("");
    lines.push("**Events triggered:**");
    for (const evt of result.triggered) {
      lines.push(`- ${evt.content} (${evt.type})`);
    }
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: lines.join("\n") },
  });
}

async function handleSet(
  bot: AnyBot,
  interaction: AnyInteraction,
  channelId: string,
  scene: SceneArg,
  options?: CommandOption[]
): Promise<void> {
  const timeStr = options?.find((o) => o.name === "time")?.value as string | undefined;
  const day = options?.find((o) => o.name === "day")?.value as number | undefined;

  if (!timeStr && day === undefined) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify a time, day, or both.", flags: 64 },
    });
    return;
  }

  const updates: { hour?: number; minute?: number; day?: number } = {};

  if (timeStr) {
    const parsed = parseTime(timeStr);
    if (!parsed) {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: InteractionResponseTypes.ChannelMessageWithSource,
        data: {
          content: "Could not parse time. Try: \"14:30\", \"2pm\", \"8:00\"",
          flags: 64,
        },
      });
      return;
    }
    updates.hour = parsed.hour;
    updates.minute = parsed.minute;
  }

  if (day !== undefined) {
    updates.day = day;
  }

  const updated = setSceneTime(channelId, updates);
  if (!updated) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Failed to set time.", flags: 64 },
    });
    return;
  }

  const newTime = updated.time;
  const period = getTimePeriod(newTime.hour);

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: {
      content: `**Time set** → ${formatTime(newTime)}, Day ${newTime.day + 1} (${period.name})`,
    },
  });
}

async function handleSkip(
  bot: AnyBot,
  interaction: AnyInteraction,
  channelId: string,
  options?: CommandOption[]
): Promise<void> {
  const periodName = options?.find((o) => o.name === "period")?.value as string;
  if (!periodName) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify a time period.", flags: 64 },
    });
    return;
  }

  const result = skipSceneToPeriod(channelId, periodName);
  if (!result) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Failed to skip time.", flags: 64 },
    });
    return;
  }

  const newTime = result.scene.time;
  const lines = [
    `**Skipped to ${periodName}** → ${formatTime(newTime)}, Day ${newTime.day + 1}`,
  ];

  if (result.triggered.length > 0) {
    lines.push("");
    lines.push("**Events triggered:**");
    for (const evt of result.triggered) {
      lines.push(`- ${evt.content} (${evt.type})`);
    }
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: lines.join("\n") },
  });
}

async function handleEvent(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: SceneArg,
  options?: CommandOption[]
): Promise<void> {
  const subcommand = options?.[0];
  if (!subcommand) return;

  switch (subcommand.name) {
    case "schedule":
      await handleEventSchedule(bot, interaction, scene, subcommand.options);
      break;
    case "list":
      await handleEventList(bot, interaction, scene);
      break;
    case "cancel":
      await handleEventCancel(bot, interaction, subcommand.options);
      break;
  }
}

async function handleEventSchedule(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: SceneArg,
  options?: CommandOption[]
): Promise<void> {
  const content = options?.find((o) => o.name === "content")?.value as string;
  const timeStr = options?.find((o) => o.name === "time")?.value as string | undefined;
  const delayStr = options?.find((o) => o.name === "delay")?.value as string | undefined;
  const type = (options?.find((o) => o.name === "type")?.value as ScheduledEvent["type"]) ?? "custom";
  const recurring = options?.find((o) => o.name === "recurring")?.value as "daily" | "weekly" | "monthly" | undefined;

  if (!content) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify event content.", flags: 64 },
    });
    return;
  }

  // Determine trigger time
  let triggerTime = { ...scene.time };

  if (timeStr) {
    const parsed = parseTime(timeStr);
    if (!parsed) {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: InteractionResponseTypes.ChannelMessageWithSource,
        data: { content: "Could not parse time.", flags: 64 },
      });
      return;
    }
    triggerTime.hour = parsed.hour;
    triggerTime.minute = parsed.minute;

    // If time already passed today, schedule for tomorrow
    if (
      parsed.hour < scene.time.hour ||
      (parsed.hour === scene.time.hour && parsed.minute <= scene.time.minute)
    ) {
      triggerTime.day += 1;
    }
  } else if (delayStr) {
    const duration = parseDuration(delayStr);
    if (!duration) {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: InteractionResponseTypes.ChannelMessageWithSource,
        data: { content: "Could not parse delay.", flags: 64 },
      });
      return;
    }
    const { advanceTime } = await import("../../world/time");
    triggerTime = advanceTime(scene.time, duration);
  } else {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify either a time or delay.", flags: 64 },
    });
    return;
  }

  const event = scheduleEvent(scene.id, scene.worldId, triggerTime, type, content, {
    recurring,
  });

  const triggerTimeStr = formatTime(triggerTime);
  let response = `**Event scheduled** (ID: ${event.id})\n`;
  response += `Type: ${type}\n`;
  response += `Triggers: Day ${triggerTime.day + 1} at ${triggerTimeStr}\n`;
  response += `Content: ${content}`;
  if (recurring) {
    response += `\nRecurring: ${recurring}`;
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: response },
  });
}

async function handleEventList(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: SceneArg
): Promise<void> {
  const events = getUpcomingEvents(scene.id, scene.time, 15);

  if (events.length === 0) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "No upcoming events.", flags: 64 },
    });
    return;
  }

  const lines = ["**Upcoming Events:**"];
  for (const evt of events) {
    const evtTime = formatTime({
      day: evt.triggerDay,
      hour: evt.triggerHour,
      minute: evt.triggerMinute,
    });
    let line = `- [${evt.id}] Day ${evt.triggerDay + 1} ${evtTime}: **${evt.content}** (${evt.type})`;
    if (evt.recurring && evt.recurring !== "none") {
      line += ` [${evt.recurring}]`;
    }
    lines.push(line);
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: lines.join("\n") },
  });
}

async function handleEventCancel(
  bot: AnyBot,
  interaction: AnyInteraction,
  options?: CommandOption[]
): Promise<void> {
  const eventId = options?.find((o) => o.name === "id")?.value as number;
  if (!eventId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify an event ID.", flags: 64 },
    });
    return;
  }

  const success = cancelEvent(eventId);
  if (!success) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Event not found.", flags: 64 },
    });
    return;
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: `Event ${eventId} cancelled.` },
  });
}
