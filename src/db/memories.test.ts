import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// =============================================================================
// In-memory DB mock
// =============================================================================

let testDb: Database;

mock.module("./index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock embeddings — return deterministic 384-dim unit vector
const MOCK_DIM = 384;
const mockEmbedding = new Float32Array(MOCK_DIM).fill(1 / Math.sqrt(MOCK_DIM));

mock.module("../ai/embeddings", () => ({
  embed: async (_text: string): Promise<Float32Array> => mockEmbedding,
  similarityMatrix: (
    queries: Float32Array[],
    targets: Float32Array[],
  ): Float32Array => {
    // dot product of unit vectors all equal 1 (same direction)
    const M = queries.length;
    const N = targets.length;
    const result = new Float32Array(M * N).fill(1);
    return result;
  },
}));

import {
  addMemory,
  getMemory,
  getMemoriesForEntity,
  updateMemory,
  updateMemoryByContent,
  removeMemory,
  removeMemoryByContent,
  setMemories,
  getMemoriesForScope,
  boostMemoryFrecency,
  decayAllFrecency,
  cleanupLowFrecencyMemories,
  clearRetrievalCaches,
  getRetrievalCacheStats,
  setMemoryCacheMaxEntities,
  formatMemoriesForContext,
  searchMemoriesBySimilarity,
  retrieveRelevantMemories,
  getMemoryEmbedding,
  storeMemoryEmbedding,
} from "./memories";

function createTestSchema(db: Database) {
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owned_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      template TEXT,
      system_template TEXT,
      config_context TEXT,
      config_model TEXT,
      config_respond TEXT,
      config_stream_mode TEXT,
      config_stream_delimiters TEXT,
      config_avatar TEXT,
      config_memory TEXT,
      config_freeform INTEGER DEFAULT 0,
      config_strip TEXT,
      config_view TEXT,
      config_edit TEXT,
      config_use TEXT,
      config_blacklist TEXT,
      config_thinking TEXT,
      config_collapse TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_message_id TEXT,
      source_channel_id TEXT,
      source_guild_id TEXT,
      frecency REAL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Use a plain table instead of vec0 virtual table (sqlite-vec not available in tests)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity ON entity_memories(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_frecency ON entity_memories(entity_id, frecency DESC)`);
}

function insertEntity(db: Database, name = "TestEntity"): number {
  const result = db.prepare(`INSERT INTO entities (name) VALUES (?) RETURNING id`).get(name) as { id: number };
  return result.id;
}

// =============================================================================
// addMemory / getMemory / getMemoriesForEntity
// =============================================================================

describe("addMemory / getMemory", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("adds a memory and returns it", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "Aria saved the village");
    expect(memory.id).toBeGreaterThan(0);
    expect(memory.entity_id).toBe(entityId);
    expect(memory.content).toBe("Aria saved the village");
    expect(memory.source_message_id).toBeNull();
    expect(memory.frecency).toBe(1.0);
  });

  test("stores source fields when provided", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "content", "msg-1", "chan-1", "guild-1");
    expect(memory.source_message_id).toBe("msg-1");
    expect(memory.source_channel_id).toBe("chan-1");
    expect(memory.source_guild_id).toBe("guild-1");
  });

  test("getMemory retrieves by ID", async () => {
    const entityId = insertEntity(testDb);
    const created = await addMemory(entityId, "test memory");
    const found = getMemory(created.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe("test memory");
  });

  test("getMemory returns null for missing ID", () => {
    expect(getMemory(999)).toBeNull();
  });
});

describe("getMemoriesForEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("returns all memories for an entity ordered by frecency DESC", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "memory A");
    await addMemory(entityId, "memory B");
    // Manually set different frecency values
    testDb.prepare(`UPDATE entity_memories SET frecency = 2.0 WHERE content = 'memory B'`).run();

    const memories = getMemoriesForEntity(entityId);
    expect(memories).toHaveLength(2);
    expect(memories[0].content).toBe("memory B"); // higher frecency first
    expect(memories[1].content).toBe("memory A");
  });

  test("returns empty array when entity has no memories", () => {
    const entityId = insertEntity(testDb);
    expect(getMemoriesForEntity(entityId)).toHaveLength(0);
  });

  test("only returns memories for the given entity", async () => {
    const e1 = insertEntity(testDb, "E1");
    const e2 = insertEntity(testDb, "E2");
    await addMemory(e1, "e1 memory");
    await addMemory(e2, "e2 memory");

    expect(getMemoriesForEntity(e1)).toHaveLength(1);
    expect(getMemoriesForEntity(e1)[0].content).toBe("e1 memory");
  });
});

// =============================================================================
// removeMemory / removeMemoryByContent
// =============================================================================

describe("removeMemory", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("removes a memory by ID and returns true", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "to be removed");
    expect(removeMemory(memory.id)).toBe(true);
    expect(getMemory(memory.id)).toBeNull();
  });

  test("returns false for non-existent memory", () => {
    expect(removeMemory(999)).toBe(false);
  });

  test("also removes associated embedding", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "with embedding");
    removeMemory(memory.id);

    const row = testDb.prepare(`SELECT * FROM memory_embeddings WHERE memory_id = ?`).get(memory.id);
    expect(row).toBeNull();
  });
});

describe("removeMemoryByContent", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("removes memory matching content and returns true", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "the content to remove");
    expect(removeMemoryByContent(entityId, "the content to remove")).toBe(true);
    expect(getMemoriesForEntity(entityId)).toHaveLength(0);
  });

  test("returns false when content does not match", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "something else");
    expect(removeMemoryByContent(entityId, "nonexistent")).toBe(false);
  });

  test("does not remove memories from a different entity with same content", async () => {
    const e1 = insertEntity(testDb, "E1");
    const e2 = insertEntity(testDb, "E2");
    await addMemory(e1, "shared content");
    await addMemory(e2, "shared content");

    removeMemoryByContent(e1, "shared content");
    expect(getMemoriesForEntity(e2)).toHaveLength(1);
  });
});

// =============================================================================
// updateMemory / updateMemoryByContent
// =============================================================================

describe("updateMemory", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("updates memory content", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "old content");
    const updated = await updateMemory(memory.id, "new content");
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("new content");
    expect(getMemory(memory.id)!.content).toBe("new content");
  });

  test("returns null for non-existent memory ID", async () => {
    const result = await updateMemory(999, "anything");
    expect(result).toBeNull();
  });
});

describe("updateMemoryByContent", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("updates memory by matching old content", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "original");
    const updated = await updateMemoryByContent(entityId, "original", "revised");
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("revised");
  });

  test("returns null when old content does not match", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "original");
    const result = await updateMemoryByContent(entityId, "wrong", "new");
    expect(result).toBeNull();
  });
});

// =============================================================================
// setMemories
// =============================================================================

describe("setMemories", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("replaces all existing memories", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "old memory 1");
    await addMemory(entityId, "old memory 2");

    const result = await setMemories(entityId, ["new A", "new B", "new C"]);
    expect(result).toHaveLength(3);

    const all = getMemoriesForEntity(entityId);
    expect(all).toHaveLength(3);
    const contents = all.map(m => m.content).sort();
    expect(contents).toEqual(["new A", "new B", "new C"]);
  });

  test("can set to empty list", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "existing");
    await setMemories(entityId, []);
    expect(getMemoriesForEntity(entityId)).toHaveLength(0);
  });
});

// =============================================================================
// getMemoriesForScope
// =============================================================================

describe("getMemoriesForScope", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("scope=none returns empty array", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "some memory");
    expect(getMemoriesForScope(entityId, "none")).toHaveLength(0);
  });

  test("scope=global returns all entity memories", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "global A");
    await addMemory(entityId, "global B");
    expect(getMemoriesForScope(entityId, "global")).toHaveLength(2);
  });

  test("scope=channel filters by source_channel_id", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "in chan-1", undefined, "chan-1", "guild-1");
    await addMemory(entityId, "in chan-2", undefined, "chan-2", "guild-1");
    await addMemory(entityId, "no channel");

    const results = getMemoriesForScope(entityId, "channel", "chan-1");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("in chan-1");
  });

  test("scope=guild filters by source_guild_id", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "in guild-A", undefined, "chan-1", "guild-A");
    await addMemory(entityId, "in guild-B", undefined, "chan-2", "guild-B");

    const results = getMemoriesForScope(entityId, "guild", undefined, "guild-A");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("in guild-A");
  });

  test("scope=channel without channelId returns empty", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "memory", undefined, "chan-1");
    expect(getMemoriesForScope(entityId, "channel")).toHaveLength(0);
  });

  test("scope=guild without guildId returns empty", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "memory", undefined, "chan-1", "guild-1");
    expect(getMemoriesForScope(entityId, "guild")).toHaveLength(0);
  });
});

// =============================================================================
// Frecency operations
// =============================================================================

describe("boostMemoryFrecency", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("increases frecency using decay+boost formula", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "important event");
    const initialFrecency = 1.0;

    boostMemoryFrecency(memory.id, 0.1);

    const updated = getMemory(memory.id)!;
    // Formula: frecency = frecency * 0.95 + boost
    const expected = initialFrecency * 0.95 + 0.1;
    expect(updated.frecency).toBeCloseTo(expected, 5);
  });

  test("uses default boost of 0.1", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "default boost");

    boostMemoryFrecency(memory.id);

    const updated = getMemory(memory.id)!;
    expect(updated.frecency).toBeCloseTo(1.0 * 0.95 + 0.1, 5);
  });
});

describe("decayAllFrecency", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("multiplies all frecency scores by the decay factor", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "A");
    await addMemory(entityId, "B");

    decayAllFrecency(0.99);

    const memories = getMemoriesForEntity(entityId);
    for (const m of memories) {
      expect(m.frecency).toBeCloseTo(1.0 * 0.99, 5);
    }
  });
});

describe("cleanupLowFrecencyMemories", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("removes memories below the threshold and returns count", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "low frecency");
    // Set frecency below default threshold of 0.01
    testDb.prepare(`UPDATE entity_memories SET frecency = 0.005 WHERE content = 'low frecency'`).run();
    await addMemory(entityId, "normal frecency"); // stays at 1.0

    const deleted = cleanupLowFrecencyMemories(0.01);
    expect(deleted).toBe(1);
    const remaining = getMemoriesForEntity(entityId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("normal frecency");
  });

  test("returns 0 when no memories are below threshold", async () => {
    const entityId = insertEntity(testDb);
    await addMemory(entityId, "healthy memory");
    expect(cleanupLowFrecencyMemories(0.01)).toBe(0);
  });
});

// =============================================================================
// Cache invalidation
// =============================================================================

describe("clearRetrievalCaches / getRetrievalCacheStats", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("getRetrievalCacheStats returns zeroed stats on a fresh cache", () => {
    const stats = getRetrievalCacheStats();
    expect(stats.embeddingEntries).toBe(0);
    expect(stats.similarityEntries).toBe(0);
    expect(stats.maxEntities).toBeGreaterThan(0);
  });

  test("clearRetrievalCaches empties both cache levels", () => {
    // Verify the function runs without error and stats reflect cleared state
    clearRetrievalCaches();
    const stats = getRetrievalCacheStats();
    expect(stats.embeddingEntries).toBe(0);
    expect(stats.similarityEntries).toBe(0);
  });
});

describe("setMemoryCacheMaxEntities", () => {
  test("updates the max entities setting", () => {
    setMemoryCacheMaxEntities(10);
    const stats = getRetrievalCacheStats();
    expect(stats.maxEntities).toBe(10);
    // restore default
    setMemoryCacheMaxEntities(50);
  });
});

// =============================================================================
// formatMemoriesForContext
// =============================================================================

describe("formatMemoriesForContext", () => {
  test("returns empty string when no memories", () => {
    expect(formatMemoriesForContext("Aria", 1, [])).toBe("");
  });

  test("formats memories with entity name and ID", async () => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();

    const entityId = insertEntity(testDb);
    const m1 = await addMemory(entityId, "first memory");
    const m2 = await addMemory(entityId, "second memory");

    const result = formatMemoriesForContext("Aria", entityId, [m1, m2]);
    expect(result).toContain(`entity="Aria"`);
    expect(result).toContain(`id="${entityId}"`);
    expect(result).toContain("first memory");
    expect(result).toContain("second memory");
  });
});

// =============================================================================
// getMemoryEmbedding / storeMemoryEmbedding
// =============================================================================

describe("getMemoryEmbedding / storeMemoryEmbedding", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("returns null for missing memory ID", () => {
    expect(getMemoryEmbedding(9999)).toBeNull();
  });

  test("stores and retrieves a Float32Array embedding", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "test memory");

    const original = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    await storeMemoryEmbedding(memory.id, original);

    const retrieved = getMemoryEmbedding(memory.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(4);
    // Values should be approximately equal (float precision)
    for (let i = 0; i < 4; i++) {
      expect(retrieved![i]).toBeCloseTo(original[i], 5);
    }
  });

  test("replaces existing embedding on re-store", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "test memory");

    await storeMemoryEmbedding(memory.id, new Float32Array([1, 2, 3, 4]));
    await storeMemoryEmbedding(memory.id, new Float32Array([5, 6, 7, 8]));

    const retrieved = getMemoryEmbedding(memory.id);
    expect(retrieved![0]).toBeCloseTo(5, 5);
    expect(retrieved![3]).toBeCloseTo(8, 5);
  });
});

// =============================================================================
// searchMemoriesBySimilarity
// =============================================================================

describe("searchMemoriesBySimilarity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("returns empty array when scope=none", async () => {
    const entityId = insertEntity(testDb);
    const result = await searchMemoriesBySimilarity(entityId, ["hello"], "none");
    expect(result).toEqual([]);
  });

  test("returns empty array when no query texts", async () => {
    const entityId = insertEntity(testDb);
    const result = await searchMemoriesBySimilarity(entityId, [], "global");
    expect(result).toEqual([]);
  });

  test("returns empty array when entity has no memories", async () => {
    const entityId = insertEntity(testDb);
    const result = await searchMemoriesBySimilarity(entityId, ["hello"], "global");
    expect(result).toEqual([]);
  });

  test("returns empty array when memory embedding is deleted", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "a memory");
    // Delete the embedding that addMemory auto-stored
    testDb.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(memory.id);
    clearRetrievalCaches();

    const result = await searchMemoriesBySimilarity(entityId, ["hello"], "global");
    expect(result).toEqual([]);
  });

  test("returns memories with similarity score above threshold", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "relevant memory");
    // Store a real Float32Array embedding (mock similarityMatrix returns 1.0)
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    const results = await searchMemoriesBySimilarity(entityId, ["query text"], "global");
    expect(results).toHaveLength(1);
    expect(results[0].memory.id).toBe(memory.id);
    expect(results[0].similarity).toBe(1); // mock returns 1.0
  });

  test("returns multiple memories sorted by similarity desc", async () => {
    const entityId = insertEntity(testDb);
    const m1 = await addMemory(entityId, "memory one");
    const m2 = await addMemory(entityId, "memory two");
    await storeMemoryEmbedding(m1.id, mockEmbedding);
    await storeMemoryEmbedding(m2.id, mockEmbedding);

    const results = await searchMemoriesBySimilarity(entityId, ["query"], "global");
    expect(results).toHaveLength(2);
    // All similarities are 1.0 from mock, so any order is fine but both present
    const ids = results.map(r => r.memory.id);
    expect(ids).toContain(m1.id);
    expect(ids).toContain(m2.id);
  });

  test("uses cached result on second call with same queries", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "cached memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    // First call populates cache
    const r1 = await searchMemoriesBySimilarity(entityId, ["q1"], "global");
    // Second call should use cache (incrementally update)
    const r2 = await searchMemoriesBySimilarity(entityId, ["q1"], "global");

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r2[0].memory.id).toBe(r1[0].memory.id);

    // Cache should have 1 embedding entry and 1 similarity entry
    const stats = getRetrievalCacheStats();
    expect(stats.embeddingEntries).toBeGreaterThanOrEqual(1);
    expect(stats.similarityEntries).toBeGreaterThanOrEqual(1);
  });

  test("incrementally updates cache for new messages", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "a memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    // First call with one message
    await searchMemoriesBySimilarity(entityId, ["msg1"], "global");
    // Second call adds a new message — should compute only new message's similarity
    const results = await searchMemoriesBySimilarity(entityId, ["msg1", "msg2"], "global");
    expect(results).toHaveLength(1);
  });

  test("removes stale messages from cache when context shrinks", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "a memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    await searchMemoriesBySimilarity(entityId, ["msg1", "msg2"], "global");
    // Next call with only msg2 — msg1 should be evicted from cache
    const results = await searchMemoriesBySimilarity(entityId, ["msg2"], "global");
    expect(results).toHaveLength(1);
  });

  test("scope=channel filters by channel (no matching memories → empty)", async () => {
    const entityId = insertEntity(testDb);
    // Memory has no source_channel_id, so channel scope won't find it
    const memory = await addMemory(entityId, "global memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    const results = await searchMemoriesBySimilarity(entityId, ["q"], "channel", "ch-123");
    expect(results).toEqual([]);
  });

  test("invalidates cache when memories change via clearRetrievalCaches", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "a memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    await searchMemoriesBySimilarity(entityId, ["q"], "global");
    expect(getRetrievalCacheStats().embeddingEntries).toBeGreaterThanOrEqual(1);

    clearRetrievalCaches();
    expect(getRetrievalCacheStats().embeddingEntries).toBe(0);
    expect(getRetrievalCacheStats().similarityEntries).toBe(0);
  });
});

// =============================================================================
// retrieveRelevantMemories
// =============================================================================

describe("retrieveRelevantMemories", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
    clearRetrievalCaches();
  });

  test("returns relevant memories", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "retrievable memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    const results = await retrieveRelevantMemories(entityId, ["query"], "global");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(memory.id);
  });

  test("returns empty array when embedding is deleted", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "no embedding");
    testDb.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(memory.id);
    clearRetrievalCaches();

    const results = await retrieveRelevantMemories(entityId, ["query"], "global");
    expect(results).toEqual([]);
  });

  test("boosts frecency for retrieved memories", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "boosted memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    await addMemory(entityId, "x"); // fresh memory as frecency baseline ~1.0
    await retrieveRelevantMemories(entityId, ["query"], "global");

    // After retrieval, frecency should be boosted above initial
    const updated = testDb
      .prepare(`SELECT frecency FROM entity_memories WHERE id = ?`)
      .get(memory.id) as { frecency: number };
    expect(updated.frecency).toBeGreaterThan(1.0);
  });

  test("returns memories without duplicates for repeated queries", async () => {
    const entityId = insertEntity(testDb);
    const memory = await addMemory(entityId, "a memory");
    await storeMemoryEmbedding(memory.id, mockEmbedding);

    const r1 = await retrieveRelevantMemories(entityId, ["q"], "global");
    const r2 = await retrieveRelevantMemories(entityId, ["q"], "global");
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });
});
