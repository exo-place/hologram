/**
 * Inventory Plugin
 *
 * Handles inventory display and extraction:
 * - Formats inventory for context
 * - Extracts inventory changes from responses
 */

import type { Plugin, Extractor, Formatter, ContextSection } from "../types";
import { ContextPriority } from "../types";
import { formatInventoryForContext, getInventory, addToInventory, removeFromInventory, giveItem } from "../../world/inventory";
import { findEntityByName } from "../../db/entities";
import { createEntryWithEmbedding } from "../../chronicle";
import { features } from "../../config";

// =============================================================================
// Formatters
// =============================================================================

/** Format inventory for active characters */
const inventoryFormatter: Formatter = {
  name: "inventory:items",
  shouldRun: (ctx) =>
    ctx.activeCharacterIds.length > 0 &&
    ctx.scene !== null &&
    ctx.config !== null &&
    features.inventory(ctx.config),
  fn: (ctx) => {
    if (!ctx.scene) return [];

    const sections: ContextSection[] = [];

    for (const charId of ctx.activeCharacterIds) {
      const invSection = formatInventoryForContext(charId, ctx.scene.id);
      if (invSection && invSection !== "Inventory: Empty") {
        sections.push({
          name: `inventory:items:${charId}`,
          content: invSection,
          priority: ContextPriority.INVENTORY,
          canTruncate: true,
          minTokens: 30,
        });
      }
    }

    return sections;
  },
};

// =============================================================================
// Extractors
// =============================================================================

/** Extract inventory changes from response using heuristics */
const inventoryExtractor: Extractor = {
  name: "inventory:changes",
  shouldRun: (ctx) =>
    ctx.response !== null &&
    ctx.scene !== null &&
    ctx.config !== null &&
    features.inventory(ctx.config) &&
    ctx.activeCharacterIds.length > 0,
  fn: async (ctx) => {
    if (!ctx.response || !ctx.scene || !ctx.config) return;

    const worldId = ctx.scene.worldId;
    const ownerId = ctx.activeCharacterIds[0];
    if (!ownerId) return;

    // Simple heuristic patterns for inventory changes
    const gainPatterns = [
      /(?:picks? up|grabs?|takes?|acquires?|receives?|finds?|collects?)\s+(?:a\s+|an\s+|the\s+)?([a-z\s]+)/gi,
    ];
    const losePatterns = [
      /(?:drops?|loses?|gives? away|discards?|throws? away)\s+(?:a\s+|an\s+|the\s+)?([a-z\s]+)/gi,
    ];
    const usePatterns = [
      /(?:uses?|consumes?|eats?|drinks?|activates?)\s+(?:a\s+|an\s+|the\s+)?([a-z\s]+)/gi,
    ];

    const processMatch = async (
      action: "gained" | "lost" | "used",
      item: string
    ) => {
      // Clean up item name
      item = item.trim().toLowerCase();
      if (item.length < 2 || item.length > 50) return;

      // Skip common non-items
      const skipWords = [
        "it",
        "them",
        "this",
        "that",
        "something",
        "everything",
        "nothing",
        "breath",
        "step",
        "moment",
        "look",
        "glance",
      ];
      if (skipWords.includes(item)) return;

      if (action === "gained") {
        const existing = findEntityByName(item, "item", worldId);
        if (existing) {
          giveItem(ownerId, existing.id, 1);
        } else {
          addToInventory(
            ownerId,
            { name: item, description: item },
            1,
            worldId
          );
        }
      } else if (action === "lost" || action === "used") {
        const inventory = getInventory(ownerId);
        const invItem = inventory.find(
          (i) => i.name.toLowerCase() === item
        );
        if (invItem) {
          removeFromInventory(ownerId, invItem.entityId, 1);
        }
      }

      // Record as chronicle event
      if (features.chronicle(ctx.config!)) {
        const verb =
          action === "gained" ? "acquired" : action === "lost" ? "lost" : "used";
        await createEntryWithEmbedding({
          worldId: ctx.scene!.worldId,
          sceneId: ctx.scene!.id,
          type: "event",
          content: `${verb} ${item}`,
          importance: 4,
          perspective: "shared",
          visibility: "public",
          source: "auto",
        });
      }
    };

    // Process patterns
    for (const pattern of gainPatterns) {
      let match;
      while ((match = pattern.exec(ctx.response)) !== null) {
        await processMatch("gained", match[1]);
      }
    }
    for (const pattern of losePatterns) {
      let match;
      while ((match = pattern.exec(ctx.response)) !== null) {
        await processMatch("lost", match[1]);
      }
    }
    for (const pattern of usePatterns) {
      let match;
      while ((match = pattern.exec(ctx.response)) !== null) {
        await processMatch("used", match[1]);
      }
    }
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const inventoryPlugin: Plugin = {
  id: "inventory",
  name: "Inventory",
  description: "Item management and extraction",
  dependencies: ["core", "scene"],

  formatters: [inventoryFormatter],
  extractors: [inventoryExtractor],
};

export default inventoryPlugin;
