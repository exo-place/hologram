import { getDb } from "../db";
import { getWorldConfig } from "../config";
import { type Scene, type TimeState } from "../scene";
import {
  checkRandomEvents,
  applyEventEffects,
  type RandomEventResult,
} from "./random";
import { tickBehaviors, type BehaviorTransitionResult } from "./behavior";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SendMessageFn = (channelId: bigint, options: { content: string }) => Promise<any>;

interface SchedulerOptions {
  sendMessage: SendMessageFn;
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerOptions: SchedulerOptions | null = null;

/**
 * Start the random event scheduler.
 * Runs in the background at variable real-time intervals,
 * checking all active scenes for "interval" trigger events.
 */
export function startEventScheduler(options: SchedulerOptions): void {
  schedulerOptions = options;
  scheduleNextTick();
  console.log("[scheduler] Random event scheduler started");
}

/** Stop the scheduler */
export function stopEventScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerOptions = null;
  console.log("[scheduler] Random event scheduler stopped");
}

/** Schedule the next tick at a variable interval */
function scheduleNextTick(): void {
  // Use a default interval range; per-scene intervals checked during tick
  // The scheduler ticks at the minimum possible interval across all worlds,
  // then per-scene the cooldown/chance system handles the actual randomness.
  const baseIntervalMs = 5 * 60 * 1000; // Check every 5 real minutes
  const jitterMs = Math.floor(Math.random() * 2 * 60 * 1000); // 0-2 min jitter

  schedulerTimer = setTimeout(tick, baseIntervalMs + jitterMs);
}

/** Main scheduler tick: check all active scenes */
async function tick(): Promise<void> {
  if (!schedulerOptions) return;

  try {
    const scenes = getAllActiveScenes();

    for (const scene of scenes) {
      const worldConfig = getWorldConfig(scene.worldId);

      // Skip if random events not enabled for this world
      if (!worldConfig.time.enabled || !worldConfig.time.useRandomEvents) {
        continue;
      }

      // Check interval-triggered event tables
      const events = checkRandomEvents(scene, "interval", worldConfig);

      for (const event of events) {
        await fireEvent(scene, event);
      }

      // Tick NPC behavior state machines
      const transitions = tickBehaviors(scene);

      for (const transition of transitions) {
        await fireBehaviorTransition(scene, transition);
      }
    }
  } catch (err) {
    console.error("[scheduler] Error during tick:", err);
  }

  // Schedule next tick
  scheduleNextTick();
}

/** Fire a random event: apply effects and send to channel */
async function fireEvent(scene: Scene, event: RandomEventResult): Promise<void> {
  if (!schedulerOptions) return;

  // Apply side effects
  applyEventEffects(scene, event.entry);

  // Send narration to channel
  const content = `*${event.entry.content}*`;

  try {
    await schedulerOptions.sendMessage(BigInt(scene.channelId), { content });
  } catch (err) {
    console.error(
      `[scheduler] Failed to send event to channel ${scene.channelId}:`,
      err
    );
  }
}

/** Fire a behavior transition: apply effects and send narration */
async function fireBehaviorTransition(
  scene: Scene,
  result: BehaviorTransitionResult
): Promise<void> {
  if (!schedulerOptions) return;

  // Apply side effects from the transition (if any)
  if (result.transition.effects) {
    // Reuse the random event effects applier with a minimal entry shape
    applyEventEffects(scene, {
      id: 0,
      tableId: 0,
      weight: 0,
      content: result.transition.narration,
      type: "narration",
      effects: result.transition.effects,
      createdAt: 0,
    });
  }

  // Send narration to channel
  const content = `*${result.transition.narration}*`;

  try {
    await schedulerOptions.sendMessage(BigInt(scene.channelId), { content });
  } catch (err) {
    console.error(
      `[scheduler] Failed to send behavior transition to channel ${scene.channelId}:`,
      err
    );
  }
}

/** Get all active scenes from the database */
function getAllActiveScenes(): Scene[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, world_id, channel_id, location_id, time_day, time_hour, time_minute,
           weather, ambience, status, config, created_at, last_active_at, ended_at
    FROM scenes
    WHERE status = 'active'
  `).all() as Array<{
    id: number;
    world_id: number;
    channel_id: string;
    location_id: number | null;
    time_day: number;
    time_hour: number;
    time_minute: number;
    weather: string | null;
    ambience: string | null;
    status: string;
    config: string | null;
    created_at: number;
    last_active_at: number;
    ended_at: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    worldId: row.world_id,
    channelId: row.channel_id,
    locationId: row.location_id,
    time: {
      day: row.time_day,
      hour: row.time_hour,
      minute: row.time_minute,
    } as TimeState,
    weather: row.weather,
    ambience: row.ambience,
    status: row.status as Scene["status"],
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at,
  }));
}
