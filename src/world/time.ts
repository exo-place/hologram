import { getDb } from "../db";
import { type TimeState, getActiveScene, updateScene, type Scene } from "../scene";

// Default time periods (day/night cycle)
export const DEFAULT_PERIODS = [
  { name: "dawn", startHour: 5, lightLevel: "dim" },
  { name: "morning", startHour: 7, lightLevel: "bright" },
  { name: "noon", startHour: 11, lightLevel: "bright" },
  { name: "afternoon", startHour: 14, lightLevel: "bright" },
  { name: "evening", startHour: 17, lightLevel: "dim" },
  { name: "dusk", startHour: 19, lightLevel: "dim" },
  { name: "night", startHour: 21, lightLevel: "dark" },
  { name: "midnight", startHour: 0, lightLevel: "dark" },
] as const;

export type TimePeriod = (typeof DEFAULT_PERIODS)[number]["name"];

export interface TimePeriodConfig {
  name: string;
  startHour: number;
  lightLevel?: string;
}

export interface CalendarConfig {
  hoursPerDay: number;
  daysPerWeek?: number;
  weeksPerMonth?: number;
  monthsPerYear?: number;
  monthNames?: string[];
  dayNames?: string[];
  yearOffset?: number; // Add to year display (e.g., 2846 to start at "Year 2847")
  era?: string; // Era suffix (e.g., "AE", "After Eclipse", "Cycle")
  seasons?: Array<{
    name: string;
    startMonth: number;
    weather?: string[];
  }>;
}

export interface ScheduledEvent {
  id: number;
  sceneId: number;
  worldId: number | null;
  triggerDay: number;
  triggerHour: number;
  triggerMinute: number;
  type: "reminder" | "weather" | "arrival" | "custom";
  content: string;
  recurring: "none" | "daily" | "weekly" | "monthly" | null;
  data: Record<string, unknown> | null;
  fired: boolean;
  createdAt: number;
}

// Default calendar configuration
export const DEFAULT_CALENDAR: CalendarConfig = {
  hoursPerDay: 24,
  daysPerWeek: 7,
  weeksPerMonth: 4,
  monthsPerYear: 12,
  monthNames: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  dayNames: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  seasons: [
    { name: "Winter", startMonth: 12, weather: ["snow", "cold", "cloudy"] },
    { name: "Spring", startMonth: 3, weather: ["rain", "cloudy", "sunny"] },
    { name: "Summer", startMonth: 6, weather: ["sunny", "hot", "clear"] },
    { name: "Autumn", startMonth: 9, weather: ["cloudy", "windy", "rain"] },
  ],
};

/** Get current time period (dawn, morning, noon, etc.) */
export function getTimePeriod(
  hour: number,
  periods: TimePeriodConfig[] = [...DEFAULT_PERIODS]
): TimePeriodConfig {
  // Sort by startHour descending to find the current period
  const sorted = [...periods].sort((a, b) => b.startHour - a.startHour);

  for (const period of sorted) {
    if (hour >= period.startHour) {
      return period;
    }
  }

  // Default to last period (wraps around midnight)
  return sorted[0];
}

/** Get the hour when a period starts */
export function getPeriodStartHour(
  periodName: string,
  periods: TimePeriodConfig[] = [...DEFAULT_PERIODS]
): number | null {
  const period = periods.find(
    (p) => p.name.toLowerCase() === periodName.toLowerCase()
  );
  return period?.startHour ?? null;
}

/** Format time for display */
export function formatTime(time: TimeState, use24Hour = false): string {
  const { hour, minute } = time;

  if (use24Hour) {
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

/** Format date for display */
export function formatDate(
  time: TimeState,
  calendar: CalendarConfig = DEFAULT_CALENDAR
): string {
  const { day } = time;

  // Calculate day of week
  const dayOfWeek = calendar.dayNames
    ? calendar.dayNames[day % calendar.dayNames.length]
    : undefined;

  // Calculate month and day of month
  const daysPerMonth = (calendar.daysPerWeek ?? 7) * (calendar.weeksPerMonth ?? 4);
  const dayOfMonth = (day % daysPerMonth) + 1;
  const monthIndex = Math.floor(day / daysPerMonth) % (calendar.monthsPerYear ?? 12);
  const monthName = calendar.monthNames?.[monthIndex] ?? `Month ${monthIndex + 1}`;

  // Calculate year with optional offset
  const daysPerYear = daysPerMonth * (calendar.monthsPerYear ?? 12);
  const rawYear = Math.floor(day / daysPerYear) + 1;
  const year = rawYear + (calendar.yearOffset ?? 0);

  // Format year with optional era
  const yearStr = calendar.era ? `Year ${year} ${calendar.era}` : `Year ${year}`;

  if (dayOfWeek) {
    return `${dayOfWeek}, ${monthName} ${dayOfMonth}, ${yearStr}`;
  }
  return `${monthName} ${dayOfMonth}, ${yearStr}`;
}

/** Get current season */
export function getSeason(
  day: number,
  calendar: CalendarConfig = DEFAULT_CALENDAR
): string | null {
  if (!calendar.seasons || calendar.seasons.length === 0) return null;

  const daysPerMonth = (calendar.daysPerWeek ?? 7) * (calendar.weeksPerMonth ?? 4);
  const monthIndex = Math.floor(day / daysPerMonth) % (calendar.monthsPerYear ?? 12);
  const currentMonth = monthIndex + 1; // 1-indexed

  // Find the season for this month
  const sorted = [...calendar.seasons].sort((a, b) => b.startMonth - a.startMonth);
  for (const season of sorted) {
    if (currentMonth >= season.startMonth) {
      return season.name;
    }
  }

  // Wrap around to last season (e.g., winter starting in December)
  return sorted[0].name;
}

/** Get possible weather for current season */
export function getSeasonWeather(
  day: number,
  calendar: CalendarConfig = DEFAULT_CALENDAR
): string[] {
  if (!calendar.seasons) return [];

  const seasonName = getSeason(day, calendar);
  const season = calendar.seasons.find((s) => s.name === seasonName);
  return season?.weather ?? [];
}

/** Advance time by a duration */
export function advanceTime(
  time: TimeState,
  duration: { hours?: number; minutes?: number; days?: number },
  hoursPerDay = 24
): TimeState {
  let totalMinutes =
    time.minute +
    time.hour * 60 +
    time.day * hoursPerDay * 60;

  totalMinutes += (duration.minutes ?? 0);
  totalMinutes += (duration.hours ?? 0) * 60;
  totalMinutes += (duration.days ?? 0) * hoursPerDay * 60;

  const newMinute = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const newHour = totalHours % hoursPerDay;
  const newDay = Math.floor(totalHours / hoursPerDay);

  return {
    day: newDay,
    hour: newHour,
    minute: newMinute,
  };
}

/** Skip to a specific time period */
export function skipToPeriod(
  time: TimeState,
  periodName: string,
  periods: TimePeriodConfig[] = [...DEFAULT_PERIODS]
): TimeState {
  const targetHour = getPeriodStartHour(periodName, periods);
  if (targetHour === null) return time;

  let newDay = time.day;

  // If the target hour has already passed today, go to tomorrow
  if (targetHour <= time.hour) {
    newDay += 1;
  }

  return {
    day: newDay,
    hour: targetHour,
    minute: 0,
  };
}

/** Parse duration string like "2 hours", "30 minutes", "1 day" */
export function parseDuration(input: string): {
  hours?: number;
  minutes?: number;
  days?: number;
} | null {
  const result: { hours?: number; minutes?: number; days?: number } = {};

  // Match patterns like "2 hours", "30min", "1 day"
  const patterns = [
    { regex: /(\d+)\s*(?:hour|hr|h)/i, key: "hours" as const },
    { regex: /(\d+)\s*(?:minute|min|m)/i, key: "minutes" as const },
    { regex: /(\d+)\s*(?:day|d)/i, key: "days" as const },
  ];

  let matched = false;
  for (const { regex, key } of patterns) {
    const match = input.match(regex);
    if (match) {
      result[key] = parseInt(match[1], 10);
      matched = true;
    }
  }

  // Also support plain numbers as hours
  if (!matched) {
    const num = parseInt(input, 10);
    if (!isNaN(num)) {
      result.hours = num;
      matched = true;
    }
  }

  return matched ? result : null;
}

/** Parse time string like "14:30", "2pm", "2:30 PM" */
export function parseTime(input: string): { hour: number; minute: number } | null {
  // 24-hour format: "14:30"
  const match24 = input.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = parseInt(match24[1], 10);
    const minute = parseInt(match24[2], 10);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return { hour, minute };
    }
  }

  // 12-hour format: "2pm", "2:30pm", "2:30 PM"
  const match12 = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = match12[2] ? parseInt(match12[2], 10) : 0;
    const isPM = match12[3].toLowerCase() === "pm";

    if (hour >= 1 && hour <= 12 && minute >= 0 && minute < 60) {
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      return { hour, minute };
    }
  }

  return null;
}

// === Scheduled Events ===

/** Create a scheduled event */
export function scheduleEvent(
  sceneId: number,
  worldId: number | null,
  triggerTime: TimeState,
  type: ScheduledEvent["type"],
  content: string,
  options?: {
    recurring?: "daily" | "weekly" | "monthly";
    data?: Record<string, unknown>;
  }
): ScheduledEvent {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO scheduled_events (scene_id, world_id, trigger_day, trigger_hour, trigger_minute, type, content, recurring, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, scene_id, world_id, trigger_day, trigger_hour, trigger_minute, type, content, recurring, data, fired, created_at
  `);

  const row = stmt.get(
    sceneId,
    worldId,
    triggerTime.day,
    triggerTime.hour,
    triggerTime.minute,
    type,
    content,
    options?.recurring ?? null,
    options?.data ? JSON.stringify(options.data) : null
  ) as {
    id: number;
    scene_id: number;
    world_id: number | null;
    trigger_day: number;
    trigger_hour: number;
    trigger_minute: number;
    type: string;
    content: string;
    recurring: string | null;
    data: string | null;
    fired: number;
    created_at: number;
  };

  return {
    id: row.id,
    sceneId: row.scene_id,
    worldId: row.world_id,
    triggerDay: row.trigger_day,
    triggerHour: row.trigger_hour,
    triggerMinute: row.trigger_minute,
    type: row.type as ScheduledEvent["type"],
    content: row.content,
    recurring: row.recurring as ScheduledEvent["recurring"],
    data: row.data ? JSON.parse(row.data) : null,
    fired: row.fired === 1,
    createdAt: row.created_at,
  };
}

/** Get upcoming events for a scene */
export function getUpcomingEvents(
  sceneId: number,
  currentTime: TimeState,
  limit = 10
): ScheduledEvent[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, scene_id, world_id, trigger_day, trigger_hour, trigger_minute, type, content, recurring, data, fired, created_at
    FROM scheduled_events
    WHERE scene_id = ? AND fired = 0
    AND (trigger_day > ? OR (trigger_day = ? AND (trigger_hour > ? OR (trigger_hour = ? AND trigger_minute >= ?))))
    ORDER BY trigger_day, trigger_hour, trigger_minute
    LIMIT ?
  `);

  const rows = stmt.all(
    sceneId,
    currentTime.day,
    currentTime.day,
    currentTime.hour,
    currentTime.hour,
    currentTime.minute,
    limit
  ) as Array<{
    id: number;
    scene_id: number;
    world_id: number | null;
    trigger_day: number;
    trigger_hour: number;
    trigger_minute: number;
    type: string;
    content: string;
    recurring: string | null;
    data: string | null;
    fired: number;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sceneId: row.scene_id,
    worldId: row.world_id,
    triggerDay: row.trigger_day,
    triggerHour: row.trigger_hour,
    triggerMinute: row.trigger_minute,
    type: row.type as ScheduledEvent["type"],
    content: row.content,
    recurring: row.recurring as ScheduledEvent["recurring"],
    data: row.data ? JSON.parse(row.data) : null,
    fired: row.fired === 1,
    createdAt: row.created_at,
  }));
}

/** Check and fire any triggered events */
export function checkTriggeredEvents(
  sceneId: number,
  currentTime: TimeState
): ScheduledEvent[] {
  const db = getDb();

  // Find events that should have triggered
  const selectStmt = db.prepare(`
    SELECT id, scene_id, world_id, trigger_day, trigger_hour, trigger_minute, type, content, recurring, data, fired, created_at
    FROM scheduled_events
    WHERE scene_id = ? AND fired = 0
    AND (trigger_day < ? OR (trigger_day = ? AND (trigger_hour < ? OR (trigger_hour = ? AND trigger_minute <= ?))))
  `);

  const rows = selectStmt.all(
    sceneId,
    currentTime.day,
    currentTime.day,
    currentTime.hour,
    currentTime.hour,
    currentTime.minute
  ) as Array<{
    id: number;
    scene_id: number;
    world_id: number | null;
    trigger_day: number;
    trigger_hour: number;
    trigger_minute: number;
    type: string;
    content: string;
    recurring: string | null;
    data: string | null;
    fired: number;
    created_at: number;
  }>;

  const triggered: ScheduledEvent[] = [];

  for (const row of rows) {
    const event: ScheduledEvent = {
      id: row.id,
      sceneId: row.scene_id,
      worldId: row.world_id,
      triggerDay: row.trigger_day,
      triggerHour: row.trigger_hour,
      triggerMinute: row.trigger_minute,
      type: row.type as ScheduledEvent["type"],
      content: row.content,
      recurring: row.recurring as ScheduledEvent["recurring"],
      data: row.data ? JSON.parse(row.data) : null,
      fired: true,
      createdAt: row.created_at,
    };

    triggered.push(event);

    // Handle recurring events
    if (event.recurring && event.recurring !== "none") {
      // Mark original as fired
      db.prepare("UPDATE scheduled_events SET fired = 1 WHERE id = ?").run(event.id);

      // Create next occurrence
      let nextTime: TimeState = {
        day: event.triggerDay,
        hour: event.triggerHour,
        minute: event.triggerMinute,
      };

      switch (event.recurring) {
        case "daily":
          nextTime = advanceTime(nextTime, { days: 1 });
          break;
        case "weekly":
          nextTime = advanceTime(nextTime, { days: 7 });
          break;
        case "monthly":
          nextTime = advanceTime(nextTime, { days: 28 }); // Simplified
          break;
      }

      scheduleEvent(event.sceneId, event.worldId, nextTime, event.type, event.content, {
        recurring: event.recurring,
        data: event.data ?? undefined,
      });
    } else {
      // Mark non-recurring as fired
      db.prepare("UPDATE scheduled_events SET fired = 1 WHERE id = ?").run(event.id);
    }
  }

  return triggered;
}

/** Cancel a scheduled event */
export function cancelEvent(eventId: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM scheduled_events WHERE id = ?").run(eventId);
  return result.changes > 0;
}

// === Scene Time Helpers ===

/** Advance scene time */
export function advanceSceneTime(
  channelId: string,
  duration: { hours?: number; minutes?: number; days?: number }
): { scene: Scene; triggered: ScheduledEvent[] } | null {
  const scene = getActiveScene(channelId);
  if (!scene) return null;

  const newTime = advanceTime(scene.time, duration);
  const updatedScene: Scene = { ...scene, time: newTime };
  updateScene(updatedScene);

  // Check for triggered events
  const triggered = checkTriggeredEvents(scene.id, newTime);

  return { scene: updatedScene, triggered };
}

/** Set scene time directly */
export function setSceneTime(
  channelId: string,
  time: Partial<TimeState>
): Scene | null {
  const scene = getActiveScene(channelId);
  if (!scene) return null;

  const newTime: TimeState = {
    day: time.day ?? scene.time.day,
    hour: time.hour ?? scene.time.hour,
    minute: time.minute ?? scene.time.minute,
  };

  const updatedScene: Scene = { ...scene, time: newTime };
  updateScene(updatedScene);

  return updatedScene;
}

/** Skip to a named time period */
export function skipSceneToPeriod(
  channelId: string,
  periodName: string
): { scene: Scene; triggered: ScheduledEvent[] } | null {
  const scene = getActiveScene(channelId);
  if (!scene) return null;

  const newTime = skipToPeriod(scene.time, periodName);
  const updatedScene: Scene = { ...scene, time: newTime };
  updateScene(updatedScene);

  // Check for triggered events
  const triggered = checkTriggeredEvents(scene.id, newTime);

  return { scene: updatedScene, triggered };
}

/** Format scene time for context */
export function formatTimeForContext(
  time: TimeState,
  calendar?: CalendarConfig
): string {
  const period = getTimePeriod(time.hour);
  const timeStr = formatTime(time);
  const dateStr = calendar ? formatDate(time, calendar) : `Day ${time.day + 1}`;

  const lines = [
    `## Time: ${timeStr} (${period.name})`,
    dateStr,
  ];

  if (period.lightLevel) {
    lines.push(`Light: ${period.lightLevel}`);
  }

  if (calendar) {
    const season = getSeason(time.day, calendar);
    if (season) {
      lines.push(`Season: ${season}`);
    }
  }

  return lines.join("\n");
}
