import {
  extractStateChanges,
  extractStateChangesHeuristic,
  applyStateChanges,
  type StateApplicator,
  type StateChange,
} from "./extract";
import {
  createEntryWithEmbedding,
  parseExplicitMemories,
  type ChronicleType,
} from "../chronicle";
import {
  advanceSceneTime,
  updateScene,
  type Scene,
} from "../scene";
import { findEntityByName, type LocationData } from "../db/entities";
import { addToInventory, removeFromInventory, getInventory, giveItem } from "../world/inventory";
import { addEvent } from "../memory/tiers";
import type { WorldConfig } from "../config";
import { features } from "../config";

/** Context needed by the extraction pipeline */
export interface ExtractionContext {
  channelId: string;
  scene: Scene | null;
  worldConfig: WorldConfig | null;
  activeCharacterIds: number[];
  userMessage: string;
  assistantResponse: string;
}

/** Build a concrete StateApplicator that bridges extracted changes to the real systems */
function buildApplicator(ctx: ExtractionContext): StateApplicator {
  const worldId = ctx.scene?.worldId;

  return {
    onLocationChange: async (newLocation: string, description?: string) => {
      if (!ctx.scene) return;

      // Try to find existing location entity
      const location = findEntityByName<LocationData>(
        newLocation,
        "location",
        ctx.scene.worldId
      );

      if (location) {
        ctx.scene.locationId = location.id;
        updateScene(ctx.scene);
      }

      // Record as chronicle event
      if (ctx.worldConfig && features.chronicle(ctx.worldConfig)) {
        await createEntryWithEmbedding({
          worldId: ctx.scene.worldId,
          sceneId: ctx.scene.id,
          type: "event",
          content: `Moved to ${newLocation}${description ? `: ${description}` : ""}`,
          importance: 5,
          perspective: "shared",
          visibility: "public",
          source: "auto",
        });
      }

      // Session memory
      addEvent(ctx.channelId, `Moved to ${newLocation}`);
    },

    onTimeChange: async (hoursElapsed?: number, _newPeriod?: string) => {
      if (!ctx.scene) return;

      if (hoursElapsed && hoursElapsed > 0) {
        advanceSceneTime(ctx.scene, hoursElapsed * 60);
      }
    },

    onInventoryChange: async (
      action: "gained" | "lost" | "used",
      item: string,
      quantity: number,
      description?: string
    ) => {
      if (!ctx.worldConfig || !features.inventory(ctx.worldConfig)) return;

      // Use first active character as the owner
      const ownerId = ctx.activeCharacterIds[0];
      if (!ownerId) return;

      if (action === "gained") {
        // Try to find existing item entity first
        const existing = findEntityByName(item, "item", worldId);
        if (existing) {
          giveItem(ownerId, existing.id, quantity);
        } else {
          // Create new item
          addToInventory(
            ownerId,
            { name: item, description: description ?? item },
            quantity,
            worldId
          );
        }
      } else if (action === "lost" || action === "used") {
        // Find item in inventory by name
        const inventory = getInventory(ownerId);
        const invItem = inventory.find(
          (i) => i.name.toLowerCase() === item.toLowerCase()
        );
        if (invItem) {
          removeFromInventory(ownerId, invItem.entityId, quantity);
        }
      }

      // Record as chronicle event
      if (ctx.scene && ctx.worldConfig && features.chronicle(ctx.worldConfig)) {
        const verb =
          action === "gained" ? "acquired" : action === "lost" ? "lost" : "used";
        await createEntryWithEmbedding({
          worldId: ctx.scene.worldId,
          sceneId: ctx.scene.id,
          type: "event",
          content: `${verb} ${quantity > 1 ? `${quantity}x ` : ""}${item}`,
          importance: 4,
          perspective: "shared",
          visibility: "public",
          source: "auto",
        });
      }

      addEvent(ctx.channelId, `${action} ${item}`);
    },

    onNewFact: async (
      content: string,
      importance: number,
      relatedEntity?: string
    ) => {
      if (!ctx.scene || !ctx.worldConfig) return;
      if (!features.chronicle(ctx.worldConfig)) return;

      // Determine perspective: if related to an active character, it's their perspective
      let perspective = "shared";
      if (relatedEntity) {
        const entity = findEntityByName(
          relatedEntity,
          undefined,
          ctx.scene.worldId
        );
        if (entity && ctx.activeCharacterIds.includes(entity.id)) {
          perspective = entity.id.toString();
        }
      }

      await createEntryWithEmbedding({
        worldId: ctx.scene.worldId,
        sceneId: ctx.scene.id,
        type: "fact",
        content,
        importance,
        perspective,
        visibility: "public",
        source: "auto",
      });
    },

    onRelationshipChange: async (
      entity1: string,
      entity2: string,
      change: string
    ) => {
      if (!ctx.scene || !ctx.worldConfig) return;
      if (!features.chronicle(ctx.worldConfig)) return;

      await createEntryWithEmbedding({
        worldId: ctx.scene.worldId,
        sceneId: ctx.scene.id,
        type: "event",
        content: `${entity1} and ${entity2}: ${change}`,
        importance: 6,
        perspective: "shared",
        visibility: "public",
        source: "auto",
      });

      addEvent(ctx.channelId, `${entity1} and ${entity2}: ${change}`);
    },
  };
}

/**
 * Run the full extraction pipeline on a message exchange.
 *
 * This replaces the simple `processMessageForMemory()` call with a
 * config-aware pipeline that:
 * 1. Parses explicit memory markers (```memory, [[remember:]], [[fact:]])
 * 2. Runs heuristic extraction (regex-based, always free)
 * 3. Runs LLM extraction (if chronicle.autoExtract is enabled)
 * 4. Applies changes to scene/inventory/chronicle via StateApplicator
 */
export async function runExtractionPipeline(
  ctx: ExtractionContext
): Promise<void> {
  const config = ctx.worldConfig;
  const hasChronicle = config != null && features.chronicle(config);

  // 1. Parse explicit memory markers from AI response
  if (hasChronicle && config.chronicle.explicitMarkers) {
    const assistantMemories = parseExplicitMemories(ctx.assistantResponse);
    // Also check user messages for explicit markers
    const userMemories = parseExplicitMemories(ctx.userMessage);
    const allExplicit = [...userMemories, ...assistantMemories];

    if (allExplicit.length > 0 && ctx.scene) {
      for (const mem of allExplicit) {
        await createEntryWithEmbedding({
          worldId: ctx.scene.worldId,
          sceneId: ctx.scene.id,
          type: (mem.type as ChronicleType) ?? "note",
          content: mem.content,
          importance: mem.importance ?? 7, // Explicit memories default to high importance
          perspective: "shared",
          visibility: "public",
          source: "explicit",
        });
      }
    }
  }

  // 2. Heuristic extraction (always runs - it's free)
  const heuristicChanges = extractStateChangesHeuristic(ctx.assistantResponse);
  const hasHeuristicChanges = Object.keys(heuristicChanges).some(
    (key) => heuristicChanges[key as keyof typeof heuristicChanges] != null
  );

  if (hasHeuristicChanges) {
    const applicator = buildApplicator(ctx);
    await applyStateChanges(heuristicChanges as StateChange, applicator);
  }

  // 3. LLM extraction (expensive - only if chronicle.autoExtract is enabled)
  if (hasChronicle && config.chronicle.autoExtract) {
    try {
      const changes = await extractStateChanges(
        ctx.userMessage,
        ctx.assistantResponse
      );

      if (changes) {
        // Filter facts by importance threshold
        if (changes.newFacts) {
          changes.newFacts = changes.newFacts.filter(
            (f) => f.importance >= (config.chronicle.extractImportance ?? 6)
          );
        }

        // Record character-level changes as chronicle entries
        if (
          changes.characterChanges &&
          changes.characterChanges.length > 0 &&
          ctx.scene
        ) {
          for (const cc of changes.characterChanges) {
            await createEntryWithEmbedding({
              worldId: ctx.scene.worldId,
              sceneId: ctx.scene.id,
              type: "event",
              content: `${cc.character}: ${cc.change}`,
              importance: 5,
              perspective: "shared",
              visibility: "public",
              source: "auto",
            });
          }
        }

        const applicator = buildApplicator(ctx);
        await applyStateChanges(changes, applicator);
      }
    } catch (err) {
      console.error("LLM extraction failed:", err);
    }
  }

  // 4. Legacy session memory (always runs for backward compatibility)
  //    This catches event keywords even if chronicle is disabled
  recordSessionEvents(ctx.channelId, ctx.assistantResponse);
}

/** Lightweight session-memory event recording (legacy backward compat) */
function recordSessionEvents(channelId: string, response: string): void {
  const eventKeywords = [
    "discovered",
    "found",
    "learned",
    "realized",
    "decided",
    "promised",
    "agreed",
    "refused",
    "attacked",
    "defeated",
    "escaped",
    "arrived",
    "left",
    "died",
    "born",
    "married",
  ];

  const lowerResponse = response.toLowerCase();
  for (const keyword of eventKeywords) {
    if (lowerResponse.includes(keyword)) {
      const sentences = response.split(/[.!?]+/);
      for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(keyword) && sentence.length > 20) {
          addEvent(channelId, sentence.trim());
          break;
        }
      }
      break;
    }
  }
}
