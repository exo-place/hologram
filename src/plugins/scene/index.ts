/**
 * Scene Plugin
 *
 * Manages scene lifecycle and provides scene state to context.
 * - Loads active scene for channel
 * - Provides scene characters
 * - Touches scene on activity
 */

import type { Plugin, Middleware, Formatter } from "../types";
import { MiddlewarePriority, ContextPriority } from "../types";
import {
  getActiveScene,
  getActiveCharacters,
  getSceneCharacters,
  touchScene,
  type SceneCharacter,
} from "../../scene";
import { getWorldConfig } from "../../config";
import { getEntity, type CharacterData, type Entity } from "../../db/entities";
import { getLocation, formatLocationForContext } from "../../world/locations";
import { getTimePeriod } from "../../world/time";

// =============================================================================
// Legacy fallback: per-channel character (for sceneless operation)
// =============================================================================

const channelActiveCharacter = new Map<string, number>();

export function setActiveCharacter(channelId: string, characterId: number): void {
  channelActiveCharacter.set(channelId, characterId);
}

export function getActiveCharacterLegacy(channelId: string): number | undefined {
  return channelActiveCharacter.get(channelId);
}

// =============================================================================
// Middleware
// =============================================================================

/** Load scene and config into context */
const sceneLoadMiddleware: Middleware = {
  name: "scene:load",
  priority: MiddlewarePriority.SCENE,
  fn: async (ctx, next) => {
    // Get active scene
    const scene = getActiveScene(ctx.channelId);
    ctx.scene = scene ?? null;
    ctx.worldId = scene?.worldId;

    // Load config
    if (scene) {
      ctx.config = getWorldConfig(scene.worldId);
    }

    // Get active character IDs
    if (scene) {
      const activeChars = getActiveCharacters(scene.id);
      ctx.activeCharacterIds = activeChars.map((c) => c.characterId);
    }

    // Legacy fallback
    if (ctx.activeCharacterIds.length === 0) {
      const legacyCharId = channelActiveCharacter.get(ctx.channelId);
      if (legacyCharId !== undefined) {
        ctx.activeCharacterIds = [legacyCharId];
      }
    }

    await next();

    // Touch scene after response (lightweight timestamp update)
    if (scene && ctx.response) {
      touchScene(scene.id);
    }
  },
};

// =============================================================================
// Formatters
// =============================================================================

/** Format current scene state (location, time, weather) */
const sceneStateFormatter: Formatter = {
  name: "scene:state",
  shouldRun: (ctx) => ctx.scene !== null,
  fn: (ctx) => {
    const scene = ctx.scene!;
    const lines: string[] = [];

    // Time
    const period = getTimePeriod(scene.time.hour);
    const timeHour = scene.time.hour % 12 || 12;
    const ampm = scene.time.hour < 12 ? "AM" : "PM";
    lines.push("## Current State");
    lines.push(
      `Time: Day ${scene.time.day + 1}, ${timeHour}:${scene.time.minute.toString().padStart(2, "0")} ${ampm} (${period.name})`
    );

    if (scene.weather) {
      lines.push(`Weather: ${scene.weather}`);
    }

    // Location
    if (scene.locationId) {
      const location = getLocation(scene.locationId);
      if (location) {
        lines.push("");
        lines.push(formatLocationForContext(location));
      }
    }

    // Ambience
    if (scene.ambience) {
      lines.push("");
      lines.push(`*${scene.ambience}*`);
    }

    if (lines.length <= 1) return [];

    return [
      {
        name: "scene:state",
        content: lines.join("\n"),
        priority: ContextPriority.WORLD_STATE,
        canTruncate: true,
        minTokens: 50,
      },
    ];
  },
};

/** Format other characters present in scene */
const otherCharactersFormatter: Formatter = {
  name: "scene:others",
  shouldRun: (ctx) => ctx.scene !== null,
  fn: (ctx) => {
    const scene = ctx.scene!;
    const sceneChars = getSceneCharacters(scene.id);

    const otherChars = sceneChars
      .filter(
        (sc: SceneCharacter) =>
          sc.isPresent && !ctx.activeCharacterIds.includes(sc.characterId)
      )
      .map((sc: SceneCharacter) => getEntity<CharacterData>(sc.characterId))
      .filter((c): c is Entity<CharacterData> => c !== null);

    if (otherChars.length === 0) return [];

    const lines: string[] = ["## Other Characters Present"];

    for (const char of otherChars) {
      lines.push(`\n### ${char.name}`);
      const briefPersona = char.data.persona.slice(0, 200);
      lines.push(briefPersona + (char.data.persona.length > 200 ? "..." : ""));
    }

    return [
      {
        name: "scene:others",
        content: lines.join("\n"),
        priority: ContextPriority.OTHER_CHARACTERS,
        canTruncate: true,
        minTokens: 30,
      },
    ];
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const scenePlugin: Plugin = {
  id: "scene",
  name: "Scene",
  description: "Scene lifecycle, location, time state",
  dependencies: ["core"],

  middleware: [sceneLoadMiddleware],
  formatters: [sceneStateFormatter, otherCharactersFormatter],
};

export default scenePlugin;
