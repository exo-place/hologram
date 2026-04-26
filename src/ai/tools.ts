import { tool, generateImage, type Tool } from "ai";
import { z } from "zod";
import { debug, error } from "../logger";
import {
  getFactsForEntity,
  getEntityWithFacts,
  addFact,
  updateFactByContent,
  removeFactByContent,
} from "../db/entities";
import {
  addMemory,
  updateMemoryByContent,
  removeMemoryByContent,
} from "../db/memories";
import { parseFact } from "../logic/expr";
import { getImageModel } from "./models";
import { canUserEdit } from "../bot/commands/cmd-permissions";

// =============================================================================
// Permission Checking
// =============================================================================

export const LOCKED_SIGIL = "$locked";

/**
 * Check if an entity is locked from LLM modification.
 * Returns { locked: false } if not locked.
 * Returns { locked: true, reason: string } if locked.
 */
export function checkEntityLocked(entityId: number): { locked: false } | { locked: true; reason: string } {
  const facts = getFactsForEntity(entityId);
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    // Pure $locked directive (entity-level lock)
    if (trimmed === LOCKED_SIGIL) {
      return { locked: true, reason: "Entity is locked" };
    }
  }
  return { locked: false };
}

/**
 * Check if a specific fact is locked from LLM modification.
 * This checks both entity-level locks and fact-level $locked prefix.
 */
export function checkFactLocked(entityId: number, factContent: string): { locked: false } | { locked: true; reason: string } {
  const facts = getFactsForEntity(entityId);
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    // Pure $locked directive (entity-level lock)
    if (trimmed === LOCKED_SIGIL) {
      return { locked: true, reason: "Entity is locked" };
    }
    // Check if this is the locked version of the fact we're trying to modify
    if (trimmed.startsWith(LOCKED_SIGIL + " ")) {
      const lockedContent = parseFact(trimmed.slice(LOCKED_SIGIL.length + 1).trim()).content;
      if (lockedContent === factContent) {
        return { locked: true, reason: "Fact is locked" };
      }
    }
  }
  return { locked: false };
}

// =============================================================================
// Tool Definitions
// =============================================================================

/** Create tools with context for memory source tracking and entity triggering */
export function createTools(
  channelId?: string,
  guildId?: string,
  triggerEntityFn?: (entityId: number, verb: string, authorName: string) => Promise<void>,
  imageOptions?: { imageModelSpec: string; onImage: (file: { data: Uint8Array; mediaType: string }) => void },
  callerEntityId?: number,
  callerOwnerId?: string | null,
): Record<string, Tool> {
  /**
   * Check that a tool call's entityId is either the calling entity itself, or that
   * the calling entity's owner has edit permission on the target entity.
   * Returns an error object if denied, null if allowed.
   */
  function checkCrossEntityEdit(targetEntityId: number): { success: false; error: string } | null {
    if (callerOwnerId === undefined || callerOwnerId === null) return null; // no owner context
    if (callerEntityId !== undefined && targetEntityId === callerEntityId) return null; // self-edit always ok
    const target = getEntityWithFacts(targetEntityId);
    if (!target) return null; // target doesn't exist; let the normal path handle that
    if (!canUserEdit(target, callerOwnerId, "")) {
      return { success: false, error: `Not allowed: owner does not have edit permission on entity ${targetEntityId}` };
    }
    return null;
  }

  return {
    add_fact: tool({
      description: "Add a permanent defining trait to an entity. Use very sparingly - only for core personality, appearance, abilities, or key relationships. Most interactions don't need facts saved.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID to add the fact to. Defaults to your own entity ID — only specify a different ID if the entity's owner has explicitly granted you edit access."),
        content: z.string().describe("The fact content"),
      }),
      execute: async ({ entityId, content }) => {
        // Cross-entity edit permission check
        const crossCheck = checkCrossEntityEdit(entityId);
        if (crossCheck) {
          debug("Tool: add_fact cross-entity denied", { entityId, callerOwnerId });
          return crossCheck;
        }

        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: add_fact blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const fact = addFact(entityId, content);
        debug("Tool: add_fact", { entityId, content, factId: fact.id });
        return { success: true, factId: fact.id };
      },
    }),

    update_fact: tool({
      description: "Update an existing permanent fact when a core defining trait changes. Facts are for personality, appearance, abilities, key relationships - not events.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID. Defaults to your own entity ID."),
        oldContent: z.string().describe("The exact current fact text to match"),
        newContent: z.string().describe("The new fact content"),
      }),
      execute: async ({ entityId, oldContent, newContent }) => {
        const crossCheck = checkCrossEntityEdit(entityId);
        if (crossCheck) {
          debug("Tool: update_fact cross-entity denied", { entityId, callerOwnerId });
          return crossCheck;
        }
        // Check if entity or specific fact is locked
        const lockCheck = checkFactLocked(entityId, oldContent);
        if (lockCheck.locked) {
          debug("Tool: update_fact blocked", { entityId, oldContent, newContent, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const fact = updateFactByContent(entityId, oldContent, newContent);
        debug("Tool: update_fact", { entityId, oldContent, newContent, success: !!fact });
        return { success: !!fact };
      },
    }),

    remove_fact: tool({
      description: "Remove a permanent defining trait that is no longer true. Facts are core traits - if something happened, it's a memory, not a fact.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID. Defaults to your own entity ID."),
        content: z.string().describe("The exact fact text to remove"),
      }),
      execute: async ({ entityId, content }) => {
        const crossCheck = checkCrossEntityEdit(entityId);
        if (crossCheck) {
          debug("Tool: remove_fact cross-entity denied", { entityId, callerOwnerId });
          return crossCheck;
        }
        // Check if entity or specific fact is locked
        const lockCheck = checkFactLocked(entityId, content);
        if (lockCheck.locked) {
          debug("Tool: remove_fact blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const success = removeFactByContent(entityId, content);
        debug("Tool: remove_fact", { entityId, content, success });
        return { success };
      },
    }),

    save_memory: tool({
      description: "Save a memory of something that happened. Use sparingly for significant conversations, promises, or events that shaped the entity. Most interactions don't need saving - only what matters long-term.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID. Defaults to your own entity ID."),
        content: z.string().describe("The memory content - what happened or was learned"),
      }),
      execute: async ({ entityId, content }) => {
        const crossCheck = checkCrossEntityEdit(entityId);
        if (crossCheck) {
          debug("Tool: save_memory cross-entity denied", { entityId, callerOwnerId });
          return crossCheck;
        }
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: save_memory blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const memory = await addMemory(entityId, content, undefined, channelId, guildId);
        debug("Tool: save_memory", { entityId, content, memoryId: memory.id });
        return { success: true, memoryId: memory.id };
      },
    }),

    update_memory: tool({
      description: "Update an existing memory when details change or need correction. Memories are events and experiences, not defining traits.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID. Defaults to your own entity ID."),
        oldContent: z.string().describe("The exact current memory text to match"),
        newContent: z.string().describe("The new memory content"),
      }),
      execute: async ({ entityId, oldContent, newContent }) => {
        const crossCheck = checkCrossEntityEdit(entityId);
        if (crossCheck) {
          debug("Tool: update_memory cross-entity denied", { entityId, callerOwnerId });
          return crossCheck;
        }
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: update_memory blocked", { entityId, oldContent, newContent, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const memory = await updateMemoryByContent(entityId, oldContent, newContent);
        debug("Tool: update_memory", { entityId, oldContent, newContent, success: !!memory });
        return { success: !!memory };
      },
    }),

    remove_memory: tool({
      description: "Remove a memory that is no longer relevant or was incorrect.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID. Defaults to your own entity ID."),
        content: z.string().describe("The exact memory text to remove"),
      }),
      execute: async ({ entityId, content }) => {
        const crossCheck = checkCrossEntityEdit(entityId);
        if (crossCheck) {
          debug("Tool: remove_memory cross-entity denied", { entityId, callerOwnerId });
          return crossCheck;
        }
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: remove_memory blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const success = removeMemoryByContent(entityId, content);
        debug("Tool: remove_memory", { entityId, content, success });
        return { success };
      },
    }),

    trigger_entity: tool({
      description: "Trigger another entity to respond with a specific interaction type. Use when your character performs an action on an item, location, or other entity — for example, drinking a potion, opening a door, equipping an item. The target entity receives the interaction type and can respond accordingly.",
      inputSchema: z.object({
        entityId: z.number().describe("The target entity ID"),
        verb: z.string().describe("The interaction verb (e.g. 'drink', 'eat', 'open', 'use', 'equip', 'throw')"),
        author: z.string().describe("Your character's name — the entity initiating this interaction"),
      }),
      execute: async ({ entityId, verb, author }) => {
        if (!triggerEntityFn) {
          debug("Tool: trigger_entity unavailable", { entityId, verb, author });
          return { success: false, error: "Entity triggering not available in this context" };
        }
        debug("Tool: trigger_entity", { entityId, verb, author });
        await triggerEntityFn(entityId, verb, author);
        return { success: true };
      },
    }),

    skip_response: tool({
      description: "Explicitly choose not to respond to this message. Use when the conversation doesn't require your input, you would just be adding noise, or when it's better to stay quiet.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Optional reason for not responding"),
      }),
      execute: async ({ reason }) => {
        debug("Tool: skip_response", { reason });
        return { success: true };
      },
    }),

    ...(imageOptions ? {
      generate_image: tool({
        description: "Generate an image using the configured image model. Call this when asked for a selfie, photo, drawing, picture, or any visual content. Craft a focused, detailed prompt describing the subject, style, and mood — do NOT dump conversation history into the prompt.",
        inputSchema: z.object({
          prompt: z.string().describe("A concise, descriptive image generation prompt. Describe subject, appearance, style, mood, and setting. Keep it focused — 1-3 sentences max."),
        }),
        execute: async ({ prompt }) => {
          debug("Tool: generate_image", { imageModelSpec: imageOptions.imageModelSpec, promptLength: prompt.length });
          try {
            const model = getImageModel(imageOptions.imageModelSpec);
            const result = await generateImage({ model, prompt });
            for (const img of result.images) {
              imageOptions.onImage({ data: img.uint8Array, mediaType: img.mediaType });
            }
            return { success: true, count: result.images.length };
          } catch (err) {
            error("Tool: generate_image failed", err);
            return { success: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      }),
    } : {}),
  };
}
