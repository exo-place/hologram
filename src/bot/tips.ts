/**
 * Progressive Disclosure / Tips System
 *
 * Tracks usage milestones and suggests features based on usage patterns.
 * Tips are subtle footers, not interruptions.
 */

import { getDb } from "../db";
import { info } from "../logger";

// =============================================================================
// Schema Extension
// =============================================================================

/** Ensure the tips tracking table exists */
export function ensureTipsSchema(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS tips_state (
      channel_id TEXT PRIMARY KEY,
      message_count INTEGER DEFAULT 0,
      tips_enabled INTEGER DEFAULT 1,
      last_tip_at INTEGER,
      tips_shown TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
}

// =============================================================================
// Tip Definitions
// =============================================================================

export interface Tip {
  id: string;
  messageThreshold?: number;
  triggerKeywords?: string[];
  condition?: (state: TipsState, config: TipContext) => boolean;
  message: string;
  priority: number; // Higher = more important
}

export interface TipsState {
  messageCount: number;
  tipsEnabled: boolean;
  lastTipAt: number | null;
  tipsShown: string[];
}

export interface TipContext {
  hasCharacter: boolean;
  hasChronicle: boolean;
  hasLocations: boolean;
  hasDice: boolean;
  hasInventory: boolean;
  worldId: number | null;
}

const TIPS: Tip[] = [
  {
    id: "create_character",
    messageThreshold: 10,
    condition: (state, ctx) => !ctx.hasCharacter,
    message: "Tip: Use `/build character` to give me a unique personality!",
    priority: 100,
  },
  {
    id: "enable_memory",
    messageThreshold: 50,
    condition: (state, ctx) => !ctx.hasChronicle,
    message: "Tip: Enable memory with `/config set chronicle.enabled true` so I can remember our conversations.",
    priority: 80,
  },
  {
    id: "locations_hint",
    triggerKeywords: ["go to", "travel to", "walk to", "head to", "enter the", "leave the"],
    condition: (state, ctx) => !ctx.hasLocations,
    message: "Tip: Enable locations with `/config set locations.enabled true` for exploration features.",
    priority: 60,
  },
  {
    id: "dice_hint",
    triggerKeywords: ["roll", "dice", "attack", "combat", "fight", "damage"],
    condition: (state, ctx) => !ctx.hasDice,
    message: "Tip: Enable dice with `/config set dice.enabled true` for rolling and combat.",
    priority: 60,
  },
  {
    id: "inventory_hint",
    triggerKeywords: ["pick up", "take", "grab", "inventory", "drop", "equip", "item"],
    condition: (state, ctx) => !ctx.hasInventory,
    message: "Tip: Enable inventory with `/config set inventory.enabled true` for item management.",
    priority: 60,
  },
  {
    id: "preset_hint",
    messageThreshold: 100,
    message: "Tip: Use `/config preset` to try different modes like MUD, Tabletop, or Survival!",
    priority: 40,
  },
  {
    id: "scene_hint",
    messageThreshold: 200,
    condition: (state, ctx) => ctx.hasChronicle,
    message: "Tip: Use `/scene start` to create named RP sessions you can pause and resume.",
    priority: 30,
  },
];

// Minimum messages between tips
const TIP_COOLDOWN_MESSAGES = 20;

// =============================================================================
// State Management
// =============================================================================

function getTipsState(channelId: string): TipsState {
  ensureTipsSchema();
  const db = getDb();

  const row = db
    .prepare("SELECT * FROM tips_state WHERE channel_id = ?")
    .get(channelId) as {
    message_count: number;
    tips_enabled: number;
    last_tip_at: number | null;
    tips_shown: string;
  } | null;

  if (!row) {
    return {
      messageCount: 0,
      tipsEnabled: true,
      lastTipAt: null,
      tipsShown: [],
    };
  }

  return {
    messageCount: row.message_count,
    tipsEnabled: row.tips_enabled === 1,
    lastTipAt: row.last_tip_at,
    tipsShown: JSON.parse(row.tips_shown),
  };
}

function saveTipsState(channelId: string, state: TipsState): void {
  ensureTipsSchema();
  const db = getDb();

  db.prepare(`
    INSERT INTO tips_state (channel_id, message_count, tips_enabled, last_tip_at, tips_shown)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      message_count = excluded.message_count,
      tips_enabled = excluded.tips_enabled,
      last_tip_at = excluded.last_tip_at,
      tips_shown = excluded.tips_shown
  `).run(
    channelId,
    state.messageCount,
    state.tipsEnabled ? 1 : 0,
    state.lastTipAt,
    JSON.stringify(state.tipsShown)
  );
}

/** Increment message count and check for tips */
export function incrementMessageCount(channelId: string): void {
  const state = getTipsState(channelId);
  state.messageCount++;
  saveTipsState(channelId, state);
}

/** Enable or disable tips for a channel */
export function setTipsEnabled(channelId: string, enabled: boolean): void {
  const state = getTipsState(channelId);
  state.tipsEnabled = enabled;
  saveTipsState(channelId, state);

  info("Tips toggled", { channelId, enabled });
}

/** Check if tips are enabled */
export function areTipsEnabled(channelId: string): boolean {
  return getTipsState(channelId).tipsEnabled;
}

// =============================================================================
// Tip Selection
// =============================================================================

/** Check for applicable tip based on message content and state */
export function checkForTip(
  channelId: string,
  messageContent: string,
  context: TipContext
): string | null {
  const state = getTipsState(channelId);

  // Tips disabled
  if (!state.tipsEnabled) {
    return null;
  }

  // Cooldown check
  const messagesSinceLastTip = state.lastTipAt
    ? state.messageCount - state.lastTipAt
    : state.messageCount;

  if (messagesSinceLastTip < TIP_COOLDOWN_MESSAGES) {
    return null;
  }

  const contentLower = messageContent.toLowerCase();

  // Find applicable tips
  const applicableTips = TIPS.filter((tip) => {
    // Already shown
    if (state.tipsShown.includes(tip.id)) {
      return false;
    }

    // Message threshold not met
    if (tip.messageThreshold && state.messageCount < tip.messageThreshold) {
      return false;
    }

    // Keyword trigger not matched
    if (tip.triggerKeywords) {
      const hasKeyword = tip.triggerKeywords.some((kw) =>
        contentLower.includes(kw.toLowerCase())
      );
      if (!hasKeyword) {
        return false;
      }
    }

    // Condition not met
    if (tip.condition && !tip.condition(state, context)) {
      return false;
    }

    return true;
  });

  if (applicableTips.length === 0) {
    return null;
  }

  // Pick highest priority tip
  applicableTips.sort((a, b) => b.priority - a.priority);
  const selectedTip = applicableTips[0];

  // Mark as shown
  state.tipsShown.push(selectedTip.id);
  state.lastTipAt = state.messageCount;
  saveTipsState(channelId, state);

  info("Tip shown", { channelId, tipId: selectedTip.id });

  return selectedTip.message;
}

/** Build tip context from current state */
export function buildTipContext(
  channelId: string,
  worldId: number | null
): TipContext {
  const db = getDb();

  let hasCharacter = false;
  let hasChronicle = false;
  let hasLocations = false;
  let hasDice = false;
  let hasInventory = false;

  if (worldId) {
    // Check for characters
    const charCount = db
      .prepare("SELECT COUNT(*) as count FROM entities WHERE world_id = ? AND type = 'character'")
      .get(worldId) as { count: number };
    hasCharacter = charCount.count > 0;

    // Check config
    const configRow = db
      .prepare("SELECT config FROM worlds WHERE id = ?")
      .get(worldId) as { config: string | null } | null;

    if (configRow?.config) {
      try {
        const config = JSON.parse(configRow.config);
        hasChronicle = config.chronicle?.enabled ?? false;
        hasLocations = config.locations?.enabled ?? false;
        hasDice = config.dice?.enabled ?? false;
        hasInventory = config.inventory?.enabled ?? false;
      } catch {
        // Ignore parse errors
      }
    }
  }

  return {
    hasCharacter,
    hasChronicle,
    hasLocations,
    hasDice,
    hasInventory,
    worldId,
  };
}

/** Reset tips for a channel (for testing or user request) */
export function resetTips(channelId: string): void {
  ensureTipsSchema();
  const db = getDb();
  db.prepare("DELETE FROM tips_state WHERE channel_id = ?").run(channelId);
  info("Tips reset", { channelId });
}
