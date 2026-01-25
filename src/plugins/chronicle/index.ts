/**
 * Chronicle Plugin
 *
 * Perspective-aware memory system:
 * - Extracts memories from LLM responses
 * - Provides memory context via RAG
 * - Supports explicit memory markers
 */

import type { Plugin, Extractor, Formatter } from "../types";
import { ContextPriority } from "../types";
import {
  createEntryWithEmbedding,
  parseExplicitMemories,
  searchEntries,
  getRecentEntries,
  formatEntriesForContext,
  type ChronicleType,
} from "../../chronicle";
import { features } from "../../config";

// =============================================================================
// Extractors
// =============================================================================

/** Extract explicit memory markers from response */
const explicitMemoryExtractor: Extractor = {
  name: "chronicle:explicit",
  shouldRun: (ctx) =>
    ctx.response !== null &&
    ctx.scene !== null &&
    ctx.config !== null &&
    features.chronicle(ctx.config) &&
    ctx.config.chronicle.explicitMarkers,
  fn: async (ctx) => {
    if (!ctx.response || !ctx.scene || !ctx.config) return;

    // Parse explicit markers from both user and assistant messages
    const assistantMemories = parseExplicitMemories(ctx.response);
    const userMemories = parseExplicitMemories(ctx.content);
    const allExplicit = [...userMemories, ...assistantMemories];

    if (allExplicit.length === 0) return;

    for (const mem of allExplicit) {
      await createEntryWithEmbedding({
        worldId: ctx.scene.worldId,
        sceneId: ctx.scene.id,
        type: (mem.type as ChronicleType) ?? "note",
        content: mem.content,
        importance: mem.importance ?? 7,
        perspective: "shared",
        visibility: "public",
        source: "explicit",
      });
    }
  },
};

/** Heuristic extraction (lightweight, always runs) */
const heuristicExtractor: Extractor = {
  name: "chronicle:heuristic",
  shouldRun: (ctx) =>
    ctx.response !== null &&
    ctx.scene !== null &&
    ctx.config !== null &&
    features.chronicle(ctx.config),
  fn: async (ctx) => {
    if (!ctx.response || !ctx.scene || !ctx.config) return;

    // Event keywords that suggest something memorable happened
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

    const lowerResponse = ctx.response.toLowerCase();
    for (const keyword of eventKeywords) {
      if (lowerResponse.includes(keyword)) {
        const sentences = ctx.response.split(/[.!?]+/);
        for (const sentence of sentences) {
          if (
            sentence.toLowerCase().includes(keyword) &&
            sentence.length > 20
          ) {
            await createEntryWithEmbedding({
              worldId: ctx.scene.worldId,
              sceneId: ctx.scene.id,
              type: "event",
              content: sentence.trim(),
              importance: 5,
              perspective: "shared",
              visibility: "public",
              source: "auto",
            });
            break;
          }
        }
        break;
      }
    }
  },
};

// =============================================================================
// Formatters
// =============================================================================

/** Format chronicle entries for context via RAG */
const chronicleFormatter: Formatter = {
  name: "chronicle:memory",
  shouldRun: (ctx) =>
    ctx.scene !== null &&
    ctx.config !== null &&
    features.chronicle(ctx.config),
  fn: async (ctx) => {
    if (!ctx.scene || !ctx.config) return [];

    const ragResults = ctx.config.context.ragResults;

    // Get the last user message for semantic search
    const lastUserMessage = [...ctx.history].reverse().find((m) => m.role === "user");
    const query = lastUserMessage?.content ?? "";

    let entries;

    if (query) {
      // Semantic search with perspective filtering
      entries = await searchEntries({
        query,
        sceneId: ctx.scene.id,
        worldId: ctx.scene.worldId,
        characterIds: ctx.activeCharacterIds,
        includeShared: true,
        includeNarrator: false,
        limit: ragResults,
      });
    } else {
      // Fall back to recent entries
      entries = getRecentEntries(ctx.scene.id, ragResults);
    }

    // Filter by visibility
    const visible = entries.filter((e) => {
      if (e.visibility === "public") return true;
      if (e.visibility === "character") {
        return ctx.activeCharacterIds.includes(Number(e.perspective));
      }
      return false;
    });

    if (visible.length === 0) return [];

    return [
      {
        name: "chronicle:memory",
        content: formatEntriesForContext(visible),
        priority: ContextPriority.CHRONICLE,
        canTruncate: true,
        minTokens: 50,
      },
    ];
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const chroniclePlugin: Plugin = {
  id: "chronicle",
  name: "Chronicle",
  description: "Perspective-aware memory extraction and retrieval",
  dependencies: ["core", "scene"],

  extractors: [explicitMemoryExtractor, heuristicExtractor],
  formatters: [chronicleFormatter],
};

export default chroniclePlugin;
