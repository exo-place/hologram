/**
 * World Plugin
 *
 * Handles world-level context:
 * - World rules
 * - World lore
 */

import type { Plugin, Formatter } from "../types";
import { ContextPriority } from "../types";
import { getDb } from "../../db";

// =============================================================================
// Formatters
// =============================================================================

/** Format world rules for context */
const worldRulesFormatter: Formatter = {
  name: "world:rules",
  shouldRun: (ctx) =>
    ctx.worldId !== undefined &&
    ctx.config !== null &&
    ctx.config.context.includeWorldRules,
  fn: (ctx) => {
    if (!ctx.worldId) return [];

    const db = getDb();
    const row = db
      .prepare("SELECT rules FROM worlds WHERE id = ?")
      .get(ctx.worldId) as { rules: string | null } | null;

    if (!row?.rules) return [];

    return [
      {
        name: "world:rules",
        content: `## Game Rules\n${row.rules}`,
        priority: ContextPriority.SYSTEM_RULES,
        canTruncate: false,
      },
    ];
  },
};

/** Format world lore for context */
const worldLoreFormatter: Formatter = {
  name: "world:lore",
  shouldRun: (ctx) =>
    ctx.worldId !== undefined &&
    ctx.config !== null &&
    ctx.config.context.includeWorldLore,
  fn: (ctx) => {
    if (!ctx.worldId) return [];

    const db = getDb();
    const row = db
      .prepare("SELECT lore FROM worlds WHERE id = ?")
      .get(ctx.worldId) as { lore: string | null } | null;

    if (!row?.lore) return [];

    return [
      {
        name: "world:lore",
        content: `## World Lore\n${row.lore}`,
        priority: ContextPriority.WORLD_LORE,
        canTruncate: true,
        minTokens: 50,
      },
    ];
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const worldPlugin: Plugin = {
  id: "world",
  name: "World",
  description: "World rules and lore for context",
  dependencies: ["core"],

  formatters: [worldRulesFormatter, worldLoreFormatter],
};

export default worldPlugin;
