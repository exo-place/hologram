/**
 * Time Plugin
 *
 * Handles time-related features:
 * - Realtime synchronization
 * - Time-skip narration
 * - Random events on time advance
 */

import { generateText } from "ai";
import type { Plugin, Middleware } from "../types";
import { MiddlewarePriority } from "../types";
import { getLanguageModel, DEFAULT_MODEL } from "../../ai/models";
import { syncRealtimeIfNeeded, buildTimeSkipNarrationPrompt } from "../../world/time";
import { checkRandomEvents, applyEventEffects } from "../../events/random";
import { features } from "../../config";

// =============================================================================
// Middleware
// =============================================================================

/** Sync realtime and generate time-skip narration */
const timeSyncMiddleware: Middleware = {
  name: "time:sync",
  priority: MiddlewarePriority.TIME,
  fn: async (ctx, next) => {
    if (!ctx.scene || !ctx.config) {
      await next();
      return;
    }

    // Check if realtime sync is enabled
    if (!features.realtimeSync(ctx.config)) {
      await next();
      return;
    }

    const syncResult = syncRealtimeIfNeeded(ctx.scene, ctx.config);

    if (syncResult.advanced) {
      // Generate time-skip narration if configured
      if (features.timeSkipNarration(ctx.config)) {
        const narrationPrompt = buildTimeSkipNarrationPrompt(
          ctx.scene,
          syncResult,
          ctx.config
        );

        if (narrationPrompt) {
          try {
            const model = getLanguageModel(
              process.env.DEFAULT_MODEL || DEFAULT_MODEL
            );
            const narrationResult = await generateText({
              model,
              system: narrationPrompt,
              messages: [{ role: "user", content: "Narrate the passage of time." }],
            });
            ctx.narrationParts.push(narrationResult.text);
          } catch (err) {
            console.error("Error generating time-skip narration:", err);
          }
        }
      }

      // Check random events triggered by time advancement
      if (features.randomEvents(ctx.config)) {
        const timeEvents = checkRandomEvents(ctx.scene, "time_advance", ctx.config);
        for (const event of timeEvents) {
          applyEventEffects(ctx.scene, event.entry);
          ctx.narrationParts.push(event.entry.content);
        }
      }
    }

    await next();
  },
};

/** Check random events on message (independent of time sync) */
const messageEventsMiddleware: Middleware = {
  name: "time:events",
  priority: MiddlewarePriority.EVENTS,
  fn: async (ctx, next) => {
    if (!ctx.scene || !ctx.config) {
      await next();
      return;
    }

    // Check random events triggered per-message
    if (
      features.randomEvents(ctx.config) &&
      ctx.config.time.randomEventCheckOnMessage
    ) {
      const messageEvents = checkRandomEvents(ctx.scene, "message", ctx.config);
      for (const event of messageEvents) {
        applyEventEffects(ctx.scene, event.entry);
        ctx.narrationParts.push(event.entry.content);
      }
    }

    await next();
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const timePlugin: Plugin = {
  id: "time",
  name: "Time",
  description: "Realtime sync, time-skip narration, random events",
  dependencies: ["core", "scene"],

  middleware: [timeSyncMiddleware, messageEventsMiddleware],
};

export default timePlugin;
