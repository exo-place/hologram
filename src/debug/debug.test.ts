import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// =============================================================================
// In-memory DB mock
// =============================================================================

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock embeddings module (avoid loading actual ML model in tests)
mock.module("../ai/embeddings", () => ({
  isEmbeddingModelLoaded: () => false,
  MODEL_NAME: "test-model",
  EMBEDDING_DIMENSIONS: 384,
  getEmbeddingCacheStats: () => ({ size: 0, maxSize: 500, ttlMs: 300000 }),
  embed: async (_text: string) => new Float32Array(384).fill(0.1),
  cosineSimilarity: (_a: Float32Array, _b: Float32Array) => 0.85,
  clearEmbeddingCache: () => {},
}));

import {
  getEmbeddingStatus,
  getEmbeddingCoverage,
  getBindingGraph,
  getMemoryStats,
  getEvalErrors,
  getActiveEffectsDebug,
  getMessageStats,
  traceFacts,
  simulateResponse,
  buildEvaluatedEntity,
} from "./index";

import { createBaseContext } from "../logic/expr";

function testContext(overrides: Partial<Parameters<typeof createBaseContext>[0]> = {}) {
  return createBaseContext({
    facts: [],
    has_fact: () => false,
    messages: () => "",
    response_ms: 0,
    retry_ms: 0,
    idle_ms: 0,
    unread_count: 0,
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    is_hologram: false,
    silent: false,
    interaction_type: "",
    name: "",
    chars: [],
    channel: { id: "", name: "", description: "", is_nsfw: false, type: "text", mention: "" },
    server: { id: "", name: "", description: "", nsfw_level: "default" },
    ...overrides,
  });
}

import { createEntity, addFact, getEntityWithFacts, setEntityConfig } from "../db/entities";
import {
  addDiscordEntity,
  addMessage,
  recordEvalError,
} from "../db/discord";
import { createTestDb } from "../db/test-utils";

// =============================================================================
// Embeddings Debug
// =============================================================================

describe("getEmbeddingStatus", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns status with model info", () => {
    const status = getEmbeddingStatus();
    expect(status.modelName).toBe("test-model");
    expect(status.dimensions).toBe(384);
    expect(status.loaded).toBe(false);
    expect(status.cache.max).toBe(500);
  });
});

describe("getEmbeddingCoverage", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("reports zero coverage for entity with no embeddings", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "has silver hair");
    addFact(entity.id, "is a character");

    const coverage = getEmbeddingCoverage(entity.id);
    expect(coverage.entityId).toBe(entity.id);
    expect(coverage.facts.total).toBe(2);
    expect(coverage.facts.withEmbedding).toBe(0);
    expect(coverage.facts.missingIds).toHaveLength(2);
    expect(coverage.memories.total).toBe(0);
  });

  test("reports coverage when embeddings exist", () => {
    const entity = createEntity("Aria", "owner1");
    const fact1 = addFact(entity.id, "has silver hair");
    addFact(entity.id, "is a character");

    // Insert a fake embedding for one fact
    testDb.prepare("INSERT INTO fact_embeddings (fact_id, embedding) VALUES (?, ?)").run(
      fact1.id, new Float32Array(384).fill(0.1),
    );

    const coverage = getEmbeddingCoverage(entity.id);
    expect(coverage.facts.withEmbedding).toBe(1);
    expect(coverage.facts.missingIds).toHaveLength(1);
  });

  test("handles entity with no facts", () => {
    const entity = createEntity("Empty", "owner1");
    const coverage = getEmbeddingCoverage(entity.id);
    expect(coverage.facts.total).toBe(0);
    expect(coverage.facts.withEmbedding).toBe(0);
    expect(coverage.facts.missingIds).toHaveLength(0);
  });
});

// =============================================================================
// State Debug
// =============================================================================

describe("getBindingGraph", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns all bindings when no filter", () => {
    const entity = createEntity("Aria", "owner1");
    addDiscordEntity("channel-1", "channel", entity.id);
    addDiscordEntity("guild-1", "guild", entity.id);

    const graph = getBindingGraph();
    expect(graph.total).toBe(2);
    expect(graph.bindings[0].entityName).toBe("Aria");
  });

  test("filters by guild", () => {
    const entity = createEntity("Aria", "owner1");
    addDiscordEntity("channel-1", "channel", entity.id);
    addDiscordEntity("guild-1", "guild", entity.id);

    const graph = getBindingGraph("guild-1");
    expect(graph.total).toBe(1);
    expect(graph.bindings[0].discordId).toBe("guild-1");
  });

  test("returns empty graph for no bindings", () => {
    const graph = getBindingGraph();
    expect(graph.total).toBe(0);
    expect(graph.bindings).toHaveLength(0);
  });
});

describe("getMemoryStats", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns stats for entity with no memories", () => {
    const entity = createEntity("Aria", "owner1");
    const stats = getMemoryStats(entity.id);
    expect(stats.total).toBe(0);
    expect(stats.frecency).toBeNull();
    expect(stats.embeddingCount).toBe(0);
  });

  test("returns stats for entity with memories", () => {
    const entity = createEntity("Aria", "owner1");
    testDb.prepare(`
      INSERT INTO entity_memories (entity_id, content, source_channel_id, frecency) VALUES (?, ?, ?, ?)
    `).run(entity.id, "met user at tavern", "ch-1", 1.5);
    testDb.prepare(`
      INSERT INTO entity_memories (entity_id, content, source_guild_id, frecency) VALUES (?, ?, ?, ?)
    `).run(entity.id, "likes cats", "guild-1", 0.8);
    testDb.prepare(`
      INSERT INTO entity_memories (entity_id, content, frecency) VALUES (?, ?, ?)
    `).run(entity.id, "global memory", 2.0);

    const stats = getMemoryStats(entity.id);
    expect(stats.total).toBe(3);
    expect(stats.frecency).not.toBeNull();
    expect(stats.frecency!.min).toBe(0.8);
    expect(stats.frecency!.max).toBe(2.0);
    expect(stats.scopeBreakdown.channel).toBe(1);
    expect(stats.scopeBreakdown.guild).toBe(1);
    expect(stats.scopeBreakdown.global).toBe(1);
  });
});

describe("getEvalErrors", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns empty list when no errors", () => {
    const errors = getEvalErrors();
    expect(errors).toHaveLength(0);
  });

  test("returns errors with entity names", () => {
    const entity = createEntity("Aria", "owner1");
    recordEvalError(entity.id, "owner1", "Unknown identifier: foo", "foo > 1");

    const errors = getEvalErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].entityName).toBe("Aria");
    expect(errors[0].errorMessage).toBe("Unknown identifier: foo");
    expect(errors[0].condition).toBe("foo > 1");
  });

  test("filters by entity", () => {
    const e1 = createEntity("Aria", "owner1");
    const e2 = createEntity("Bob", "owner1");
    recordEvalError(e1.id, "owner1", "error A");
    recordEvalError(e2.id, "owner1", "error B");

    const errors = getEvalErrors(e1.id);
    expect(errors).toHaveLength(1);
    expect(errors[0].entityName).toBe("Aria");
  });
});

describe("getActiveEffectsDebug", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns empty list when no effects", () => {
    const entity = createEntity("Aria", "owner1");
    const effects = getActiveEffectsDebug(entity.id);
    expect(effects).toHaveLength(0);
  });

  test("returns active effects with remaining time", () => {
    const entity = createEntity("Aria", "owner1");
    const futureTime = new Date(Date.now() + 60000).toISOString();
    testDb.prepare(`
      INSERT INTO effects (entity_id, content, source, expires_at) VALUES (?, ?, ?, ?)
    `).run(entity.id, "is glowing", "spell", futureTime);

    const effects = getActiveEffectsDebug(entity.id);
    expect(effects).toHaveLength(1);
    expect(effects[0].content).toBe("is glowing");
    expect(effects[0].source).toBe("spell");
    expect(effects[0].remainingMs).toBeGreaterThan(0);
  });

  test("excludes expired effects", () => {
    const entity = createEntity("Aria", "owner1");
    const pastTime = new Date(Date.now() - 60000).toISOString();
    testDb.prepare(`
      INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)
    `).run(entity.id, "was glowing", pastTime);

    const effects = getActiveEffectsDebug(entity.id);
    expect(effects).toHaveLength(0);
  });
});

describe("getMessageStats", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns stats for channel with messages", () => {
    addMessage("ch-1", "user-1", "Alice", "hello");
    addMessage("ch-1", "user-1", "Alice", "world");
    addMessage("ch-1", "user-2", "Bob", "hi");

    const stats = getMessageStats("ch-1");
    expect(stats.totalMessages).toBe(3);
    expect(stats.postForgetCount).toBe(3);
    expect(stats.forgetTime).toBeNull();
    expect(stats.authorBreakdown).toHaveLength(2);
    expect(stats.authorBreakdown[0].name).toBe("Alice");
    expect(stats.authorBreakdown[0].count).toBe(2);
  });

  test("returns zero for empty channel", () => {
    const stats = getMessageStats("ch-empty");
    expect(stats.totalMessages).toBe(0);
    expect(stats.authorBreakdown).toHaveLength(0);
  });
});

// =============================================================================
// Evaluation Debug
// =============================================================================

describe("traceFacts", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns null for nonexistent entity", () => {
    const result = traceFacts(999, "ch-1");
    expect(result).toBeNull();
  });

  test("traces unconditional facts", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "has silver hair");
    addFact(entity.id, "is a character");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.entityName).toBe("Aria");
    expect(result!.traces).toHaveLength(2);
    expect(result!.traces[0].conditional).toBe(false);
    expect(result!.traces[0].included).toBe(true);
    expect(result!.traces[0].category).toBe("fact");
  });

  test("traces conditional facts with $if", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$if mentioned: $respond");
    addFact(entity.id, "$if true: glows faintly");
    addFact(entity.id, "$if false: is invisible");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();

    // $if mentioned: $respond — mentioned is false in mock context
    expect(result!.traces[0].conditional).toBe(true);
    expect(result!.traces[0].expression).toBe("mentioned");
    expect(result!.traces[0].expressionResult).toBe(false);
    expect(result!.traces[0].included).toBe(false);
    expect(result!.traces[0].category).toBe("$respond");

    // $if true: glows faintly
    expect(result!.traces[1].expressionResult).toBe(true);
    expect(result!.traces[1].included).toBe(true);

    // $if false: is invisible
    expect(result!.traces[2].expressionResult).toBe(false);
    expect(result!.traces[2].included).toBe(false);
  });

  test("handles expression errors gracefully", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$if badvar123: broken");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.traces[0].expressionError).not.toBeNull();
    expect(result!.traces[0].expressionResult).toBe(false);
    expect(result!.traces[0].included).toBe(false);
  });

  test("strips comments before tracing", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$# this is a comment");
    addFact(entity.id, "visible fact");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.traces).toHaveLength(1);
    expect(result!.traces[0].raw).toBe("visible fact");
  });

  test("categorizes directive facts", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$respond");
    addFact(entity.id, "$memory channel");
    addFact(entity.id, "$stream full");
    addFact(entity.id, "$model google:gemini-3-flash-preview");
    addFact(entity.id, "$locked");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.traces[0].category).toBe("$respond");
    expect(result!.traces[1].category).toBe("$memory");
    expect(result!.traces[2].category).toBe("$stream");
    expect(result!.traces[3].category).toBe("$model");
    expect(result!.traces[4].category).toBe("$locked");
  });
});

describe("simulateResponse", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns empty for channel with no bindings", () => {
    const results = simulateResponse("ch-empty");
    expect(results).toHaveLength(0);
  });

  test("simulates response for channel-bound entity", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "is a character");
    addFact(entity.id, "$respond");
    addDiscordEntity("ch-1", "channel", entity.id);

    const results = simulateResponse("ch-1");
    expect(results).toHaveLength(1);
    expect(results[0].entityName).toBe("Aria");
    expect(results[0].shouldRespond).toBe(true);
  });

  test("reports entities that would not respond", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$respond false");
    addDiscordEntity("ch-1", "channel", entity.id);

    const results = simulateResponse("ch-1");
    expect(results).toHaveLength(1);
    expect(results[0].shouldRespond).toBe(false);
  });

  test("combines channel and guild bindings", () => {
    const e1 = createEntity("Aria", "owner1");
    const e2 = createEntity("Bob", "owner1");
    addFact(e1.id, "is a character");
    addFact(e2.id, "is a character");
    addDiscordEntity("ch-1", "channel", e1.id);
    addDiscordEntity("guild-1", "guild", e2.id);

    const results = simulateResponse("ch-1", "guild-1");
    expect(results).toHaveLength(2);
    const names = results.map(r => r.entityName).sort();
    expect(names).toEqual(["Aria", "Bob"]);
  });
});

describe("buildEvaluatedEntity", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("evaluates entity facts into an EvaluatedEntity", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "has silver hair");
    addFact(entity.id, "$respond");
    addFact(entity.id, "$if true: glows faintly");

    const ewf = getEntityWithFacts(entity.id)!;
    const ctx = testContext({ facts: ewf.facts.map(f => f.content) });
    const evaluated = buildEvaluatedEntity(ewf, ctx);

    expect(evaluated.id).toBe(entity.id);
    expect(evaluated.name).toBe("Aria");
    expect(evaluated.facts).toContain("has silver hair");
    expect(evaluated.facts).toContain("glows faintly");
    expect(evaluated.exprContext).toBeDefined();
  });

  test("passes channel metadata through", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "is a character");

    const ewf = getEntityWithFacts(entity.id)!;
    const ctx = testContext({
      facts: ewf.facts.map(f => f.content),
      channel: { id: "ch-1", name: "general", description: "", is_nsfw: false, type: "text", mention: "<#ch-1>" },
    });
    const evaluated = buildEvaluatedEntity(ewf, ctx);

    expect(evaluated.exprContext?.channel.name).toBe("general");
  });

  test("applies entity config defaults", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "is a character");
    setEntityConfig(entity.id, { config_model: "google:gemini-3-flash-preview" });

    const ewf = getEntityWithFacts(entity.id)!;
    const ctx = testContext({ facts: ewf.facts.map(f => f.content) });
    const evaluated = buildEvaluatedEntity(ewf, ctx);

    expect(evaluated.modelSpec).toBe("google:gemini-3-flash-preview");
  });
});
