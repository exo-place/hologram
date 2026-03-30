/**
 * Tests for src/ai/tools.ts
 *
 * Tests:
 *  - checkEntityLocked()   — entity-level $locked detection
 *  - checkFactLocked()     — entity-level + fact-level $locked detection
 *  - createTools() execute — add_fact / update_fact / remove_fact / save_memory
 *    / update_memory / remove_memory blocked when entity is locked
 *  - createTools() execute — successful operations when entity is not locked
 *
 * DB is provided via an in-memory SQLite instance mocked through mock.module.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// In-memory DB mock — must come before any import that transitively uses getDb
// ---------------------------------------------------------------------------

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

mock.module("../ai/embeddings", () => ({
  embed: async () => new Float32Array(384),
  similarityMatrix: () => new Float32Array(0),
  maxSimilarityMatrix: () => new Float32Array(0),
}));

import { checkEntityLocked, checkFactLocked, createTools, LOCKED_SIGIL } from "./tools";
import { createEntity, addFact } from "../db/entities";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

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
      config_collapse TEXT,
      config_keywords TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_entity ON effects(entity_id)`);
}

// ---------------------------------------------------------------------------
// Typed helpers for calling tool execute functions
//
// The AI SDK Tool type marks execute as optional (tools may be provider-executed)
// and the return type is AsyncIterable<OUTPUT> | OUTPUT depending on the SDK
// version.  Our tools always return plain objects synchronously from async
// functions, so we use non-null assertion on execute (!) and cast the awaited
// result to the concrete return shape we defined.
// ---------------------------------------------------------------------------

type FactResult = { success: boolean; error?: string; factId?: number };
type MemoryResult = { success: boolean; error?: string; memoryId?: number };

async function callAddFact(tools: ReturnType<typeof createTools>, args: { entityId: number; content: string }): Promise<FactResult> {
  return (await tools.add_fact.execute!(args, {} as never)) as FactResult;
}

async function callUpdateFact(tools: ReturnType<typeof createTools>, args: { entityId: number; oldContent: string; newContent: string }): Promise<FactResult> {
  return (await tools.update_fact.execute!(args, {} as never)) as FactResult;
}

async function callRemoveFact(tools: ReturnType<typeof createTools>, args: { entityId: number; content: string }): Promise<FactResult> {
  return (await tools.remove_fact.execute!(args, {} as never)) as FactResult;
}

async function callSaveMemory(tools: ReturnType<typeof createTools>, args: { entityId: number; content: string }): Promise<MemoryResult> {
  return (await tools.save_memory.execute!(args, {} as never)) as MemoryResult;
}

async function callUpdateMemory(tools: ReturnType<typeof createTools>, args: { entityId: number; oldContent: string; newContent: string }): Promise<MemoryResult> {
  return (await tools.update_memory.execute!(args, {} as never)) as MemoryResult;
}

async function callRemoveMemory(tools: ReturnType<typeof createTools>, args: { entityId: number; content: string }): Promise<MemoryResult> {
  return (await tools.remove_memory.execute!(args, {} as never)) as MemoryResult;
}

// ---------------------------------------------------------------------------
// checkEntityLocked
// ---------------------------------------------------------------------------

describe("checkEntityLocked", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns locked:false for entity with no facts", () => {
    const entity = createEntity("Aria");
    expect(checkEntityLocked(entity.id)).toEqual({ locked: false });
  });

  test("returns locked:false for entity with normal facts only", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "is a character");
    addFact(entity.id, "has silver hair");
    expect(checkEntityLocked(entity.id)).toEqual({ locked: false });
  });

  test("returns locked:true when entity has bare $locked fact", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, LOCKED_SIGIL);
    const result = checkEntityLocked(entity.id);
    expect(result.locked).toBe(true);
    if (result.locked) {
      expect(result.reason).toBe("Entity is locked");
    }
  });

  test("returns locked:true when $locked is surrounded by whitespace", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "  $locked  ");
    expect(checkEntityLocked(entity.id).locked).toBe(true);
  });

  test("$locked prefix on a fact (e.g. $locked has silver hair) does not lock entity", () => {
    // A fact-level lock like "$locked has silver hair" should not lock the entity —
    // only bare $locked does
    const entity = createEntity("Aria");
    addFact(entity.id, "$locked has silver hair");
    expect(checkEntityLocked(entity.id)).toEqual({ locked: false });
  });

  test("non-existent entity returns locked:false", () => {
    expect(checkEntityLocked(9999)).toEqual({ locked: false });
  });
});

// ---------------------------------------------------------------------------
// checkFactLocked
// ---------------------------------------------------------------------------

describe("checkFactLocked", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns locked:false when entity has no facts", () => {
    const entity = createEntity("Aria");
    expect(checkFactLocked(entity.id, "has silver hair")).toEqual({ locked: false });
  });

  test("returns locked:true for entity-level lock (bare $locked)", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, LOCKED_SIGIL);
    const result = checkFactLocked(entity.id, "any fact content");
    expect(result.locked).toBe(true);
    if (result.locked) {
      expect(result.reason).toBe("Entity is locked");
    }
  });

  test("returns locked:true for fact that matches $locked prefix", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "$locked has silver hair");
    const result = checkFactLocked(entity.id, "has silver hair");
    expect(result.locked).toBe(true);
    if (result.locked) {
      expect(result.reason).toBe("Fact is locked");
    }
  });

  test("returns locked:false for unlocked fact when other facts have lock prefix", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "$locked has silver hair");
    // Different fact content — not locked
    expect(checkFactLocked(entity.id, "is a character")).toEqual({ locked: false });
  });

  test("returns locked:false for normal facts with no lock", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "is a character");
    addFact(entity.id, "has silver hair");
    expect(checkFactLocked(entity.id, "has silver hair")).toEqual({ locked: false });
  });

  test("$locked prefix + fact content matching is exact (parseFact strips directives)", () => {
    const entity = createEntity("Aria");
    // Fact stored as "$locked has silver hair" — checking "has silver hair" should lock
    addFact(entity.id, "$locked has silver hair");
    expect(checkFactLocked(entity.id, "has silver hair").locked).toBe(true);
    // "silver hair" alone (not exact match) should not lock
    expect(checkFactLocked(entity.id, "silver hair")).toEqual({ locked: false });
  });
});

// ---------------------------------------------------------------------------
// LOCKED_SIGIL constant
// ---------------------------------------------------------------------------

describe("LOCKED_SIGIL", () => {
  test("is the string $locked", () => {
    expect(LOCKED_SIGIL).toBe("$locked");
  });
});

// ---------------------------------------------------------------------------
// createTools — blocked when entity is locked
// ---------------------------------------------------------------------------

describe("createTools — locked entity blocks all mutations", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("add_fact returns error when entity is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, LOCKED_SIGIL);
    const tools = createTools("ch-1", "guild-1");
    const result = await callAddFact(tools, { entityId: entity.id, content: "new fact" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("update_fact returns error when entity is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "original fact");
    addFact(entity.id, LOCKED_SIGIL);
    const tools = createTools();
    const result = await callUpdateFact(tools, { entityId: entity.id, oldContent: "original fact", newContent: "modified fact" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("remove_fact returns error when entity is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "a fact");
    addFact(entity.id, LOCKED_SIGIL);
    const tools = createTools();
    const result = await callRemoveFact(tools, { entityId: entity.id, content: "a fact" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("save_memory returns error when entity is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, LOCKED_SIGIL);
    const tools = createTools();
    const result = await callSaveMemory(tools, { entityId: entity.id, content: "a memory" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("update_memory returns error when entity is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, LOCKED_SIGIL);
    const tools = createTools();
    const result = await callUpdateMemory(tools, { entityId: entity.id, oldContent: "old memory", newContent: "new memory" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("remove_memory returns error when entity is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, LOCKED_SIGIL);
    const tools = createTools();
    const result = await callRemoveMemory(tools, { entityId: entity.id, content: "some memory" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createTools — blocked when specific fact is locked
// ---------------------------------------------------------------------------

describe("createTools — fact-level lock blocks update/remove of that fact", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("update_fact blocked when target fact is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "$locked has silver hair");
    const tools = createTools();
    const result = await callUpdateFact(tools, { entityId: entity.id, oldContent: "has silver hair", newContent: "has golden hair" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Fact is locked");
  });

  test("remove_fact blocked when target fact is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "$locked has silver hair");
    const tools = createTools();
    const result = await callRemoveFact(tools, { entityId: entity.id, content: "has silver hair" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Fact is locked");
  });

  test("update_fact allowed for unlocked fact when another fact is locked", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "$locked has silver hair");
    addFact(entity.id, "is cheerful");
    const tools = createTools();
    const result = await callUpdateFact(tools, { entityId: entity.id, oldContent: "is cheerful", newContent: "is reserved" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createTools — successful operations on unlocked entity
// ---------------------------------------------------------------------------

describe("createTools — successful operations on unlocked entity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("add_fact succeeds and returns factId", async () => {
    const entity = createEntity("Aria");
    const tools = createTools();
    const result = await callAddFact(tools, { entityId: entity.id, content: "has silver hair" });
    expect(result.success).toBe(true);
    expect(result.factId).toBeGreaterThan(0);
  });

  test("update_fact succeeds when fact exists", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "has silver hair");
    const tools = createTools();
    const result = await callUpdateFact(tools, { entityId: entity.id, oldContent: "has silver hair", newContent: "has golden hair" });
    expect(result.success).toBe(true);
  });

  test("update_fact returns success:false when fact not found", async () => {
    const entity = createEntity("Aria");
    const tools = createTools();
    const result = await callUpdateFact(tools, { entityId: entity.id, oldContent: "nonexistent", newContent: "new" });
    expect(result.success).toBe(false);
  });

  test("remove_fact succeeds when fact exists", async () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "to remove");
    const tools = createTools();
    const result = await callRemoveFact(tools, { entityId: entity.id, content: "to remove" });
    expect(result.success).toBe(true);
  });

  test("remove_fact returns success:false when fact not found", async () => {
    const entity = createEntity("Aria");
    const tools = createTools();
    const result = await callRemoveFact(tools, { entityId: entity.id, content: "nonexistent" });
    expect(result.success).toBe(false);
  });

  test("save_memory succeeds and returns memoryId", async () => {
    const entity = createEntity("Aria");
    const tools = createTools("ch-1", "guild-1");
    const result = await callSaveMemory(tools, { entityId: entity.id, content: "met the hero" });
    expect(result.success).toBe(true);
    expect(result.memoryId).toBeDefined();
  });

  test("update_memory succeeds when memory exists", async () => {
    const entity = createEntity("Aria");
    const tools = createTools();
    await callSaveMemory(tools, { entityId: entity.id, content: "old event" });
    const result = await callUpdateMemory(tools, { entityId: entity.id, oldContent: "old event", newContent: "updated event" });
    expect(result.success).toBe(true);
  });

  test("remove_memory succeeds when memory exists", async () => {
    const entity = createEntity("Aria");
    const tools = createTools();
    await callSaveMemory(tools, { entityId: entity.id, content: "some event" });
    const result = await callRemoveMemory(tools, { entityId: entity.id, content: "some event" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createTools — tool structure
// ---------------------------------------------------------------------------

describe("createTools — tool structure", () => {
  test("returns all expected tool names", () => {
    const tools = createTools();
    const keys = Object.keys(tools);
    expect(keys).toContain("add_fact");
    expect(keys).toContain("update_fact");
    expect(keys).toContain("remove_fact");
    expect(keys).toContain("save_memory");
    expect(keys).toContain("update_memory");
    expect(keys).toContain("remove_memory");
    expect(keys).toContain("trigger_entity");
    expect(keys).toContain("skip_response");
  });

  test("each tool has an execute function", () => {
    const tools = createTools();
    for (const [, toolDef] of Object.entries(tools)) {
      expect(typeof toolDef.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// createTools — trigger_entity
// ---------------------------------------------------------------------------

type TriggerResult = { success: boolean; error?: string };

async function callTriggerEntity(
  tools: ReturnType<typeof createTools>,
  args: { entityId: number; verb: string; author: string },
): Promise<TriggerResult> {
  return (await tools.trigger_entity.execute!(args, {} as never)) as TriggerResult;
}

describe("createTools — trigger_entity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns error when no triggerEntityFn provided", async () => {
    const tools = createTools();
    const result = await callTriggerEntity(tools, { entityId: 1, verb: "drink", author: "Aria" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  test("calls triggerEntityFn with correct args", async () => {
    const calls: Array<{ entityId: number; verb: string; authorName: string }> = [];
    const triggerFn = async (entityId: number, verb: string, authorName: string) => {
      calls.push({ entityId, verb, authorName });
    };
    const tools = createTools("ch-1", "guild-1", triggerFn);
    const result = await callTriggerEntity(tools, { entityId: 42, verb: "drink", author: "Aria" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ entityId: 42, verb: "drink", authorName: "Aria" });
  });

  test("propagates rejection from triggerEntityFn", async () => {
    const triggerFn = async () => { throw new Error("chain limit"); };
    const tools = createTools(undefined, undefined, triggerFn);
    await expect(callTriggerEntity(tools, { entityId: 1, verb: "use", author: "Bob" })).rejects.toThrow("chain limit");
  });
});
