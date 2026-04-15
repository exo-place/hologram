import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "./test-utils";

// =============================================================================
// In-memory DB mock
// =============================================================================

let testDb: Database;

mock.module("./index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import {
  addEffect,
  getActiveEffects,
  getActiveEffectFacts,
  removeEffect,
  clearEffects,
  clearEffectsBySource,
  cleanupExpiredEffects,
  extendEffect,
  hasActiveEffects,
} from "./effects";

function insertEntity(db: Database, name = "TestEntity"): number {
  const result = db.prepare(`INSERT INTO entities (name) VALUES (?) RETURNING id`).get(name) as { id: number };
  return result.id;
}

// =============================================================================
// addEffect / getActiveEffects
// =============================================================================

describe("addEffect / getActiveEffects", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("adds an effect and retrieves it", () => {
    const entityId = insertEntity(testDb);
    const effect = addEffect(entityId, "is on fire", 60_000);
    expect(effect.id).toBeGreaterThan(0);
    expect(effect.entity_id).toBe(entityId);
    expect(effect.content).toBe("is on fire");
    expect(effect.source).toBeNull();

    const active = getActiveEffects(entityId);
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("is on fire");
  });

  test("stores source when provided", () => {
    const entityId = insertEntity(testDb);
    const effect = addEffect(entityId, "is stunned", 60_000, "spell:stun");
    expect(effect.source).toBe("spell:stun");
  });

  test("expired effects are not returned by getActiveEffects", () => {
    const entityId = insertEntity(testDb);
    // Insert an already-expired effect directly (negative duration would be in the past)
    const pastDate = new Date(Date.now() - 10_000).toISOString();
    testDb.prepare(`
      INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)
    `).run(entityId, "was on fire", pastDate);

    const active = getActiveEffects(entityId);
    expect(active).toHaveLength(0);
  });

  test("only returns effects for the given entity", () => {
    const entity1 = insertEntity(testDb, "Entity1");
    const entity2 = insertEntity(testDb, "Entity2");
    addEffect(entity1, "effect for 1", 60_000);
    addEffect(entity2, "effect for 2", 60_000);

    expect(getActiveEffects(entity1)).toHaveLength(1);
    expect(getActiveEffects(entity2)).toHaveLength(1);
    expect(getActiveEffects(entity1)[0].content).toBe("effect for 1");
  });

  test("returns multiple active effects ordered by created_at ASC", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "first", 60_000);
    addEffect(entityId, "second", 60_000);
    addEffect(entityId, "third", 60_000);

    const active = getActiveEffects(entityId);
    expect(active).toHaveLength(3);
    expect(active[0].content).toBe("first");
    expect(active[2].content).toBe("third");
  });
});

// =============================================================================
// getActiveEffectFacts
// =============================================================================

describe("getActiveEffectFacts", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns content strings of active effects", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "is glowing", 60_000);
    addEffect(entityId, "moves silently", 60_000);

    const facts = getActiveEffectFacts(entityId);
    expect(facts).toEqual(["is glowing", "moves silently"]);
  });

  test("returns empty array when no active effects", () => {
    const entityId = insertEntity(testDb);
    expect(getActiveEffectFacts(entityId)).toEqual([]);
  });
});

// =============================================================================
// removeEffect
// =============================================================================

describe("removeEffect", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("removes an effect by ID", () => {
    const entityId = insertEntity(testDb);
    const effect = addEffect(entityId, "is poisoned", 60_000);
    expect(removeEffect(effect.id)).toBe(true);
    expect(getActiveEffects(entityId)).toHaveLength(0);
  });

  test("returns false when effect does not exist", () => {
    expect(removeEffect(999)).toBe(false);
  });

  test("only removes the targeted effect", () => {
    const entityId = insertEntity(testDb);
    const e1 = addEffect(entityId, "first", 60_000);
    addEffect(entityId, "second", 60_000);

    removeEffect(e1.id);
    const remaining = getActiveEffects(entityId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("second");
  });
});

// =============================================================================
// clearEffects
// =============================================================================

describe("clearEffects", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("deletes all effects for an entity and returns count", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "a", 60_000);
    addEffect(entityId, "b", 60_000);
    addEffect(entityId, "c", 60_000);

    const deleted = clearEffects(entityId);
    expect(deleted).toBe(3);
    expect(getActiveEffects(entityId)).toHaveLength(0);
  });

  test("does not affect other entities", () => {
    const e1 = insertEntity(testDb, "E1");
    const e2 = insertEntity(testDb, "E2");
    addEffect(e1, "effect", 60_000);
    addEffect(e2, "other effect", 60_000);

    clearEffects(e1);
    expect(getActiveEffects(e2)).toHaveLength(1);
  });

  test("returns 0 when no effects to clear", () => {
    const entityId = insertEntity(testDb);
    expect(clearEffects(entityId)).toBe(0);
  });
});

// =============================================================================
// clearEffectsBySource
// =============================================================================

describe("clearEffectsBySource", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("removes effects matching the given source", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "effect A", 60_000, "spell:fire");
    addEffect(entityId, "effect B", 60_000, "spell:fire");
    addEffect(entityId, "effect C", 60_000, "spell:ice");

    const deleted = clearEffectsBySource(entityId, "spell:fire");
    expect(deleted).toBe(2);
    const remaining = getActiveEffects(entityId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("effect C");
  });

  test("returns 0 when source does not match any effect", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "effect", 60_000, "other");
    expect(clearEffectsBySource(entityId, "missing")).toBe(0);
  });
});

// =============================================================================
// cleanupExpiredEffects
// =============================================================================

describe("cleanupExpiredEffects", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("removes expired effects and returns count", () => {
    const entityId = insertEntity(testDb);
    const pastDate = new Date(Date.now() - 10_000).toISOString();
    testDb.prepare(`INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)`).run(entityId, "stale", pastDate);
    testDb.prepare(`INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)`).run(entityId, "also stale", pastDate);
    addEffect(entityId, "still active", 60_000);

    const deleted = cleanupExpiredEffects();
    expect(deleted).toBe(2);
    expect(getActiveEffects(entityId)).toHaveLength(1);
    expect(getActiveEffects(entityId)[0].content).toBe("still active");
  });

  test("returns 0 when no expired effects exist", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "active", 60_000);
    expect(cleanupExpiredEffects()).toBe(0);
  });
});

// =============================================================================
// extendEffect
// =============================================================================

describe("extendEffect", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("extends an effect's expiration", () => {
    const entityId = insertEntity(testDb);
    const effect = addEffect(entityId, "extended effect", 60_000);

    const before = new Date(effect.expires_at).getTime();
    expect(extendEffect(effect.id, 30_000)).toBe(true);

    const updated = testDb
      .prepare(`SELECT expires_at FROM effects WHERE id = ?`)
      .get(effect.id) as { expires_at: string };
    const after = new Date(updated.expires_at).getTime();
    // Should be at least 30 seconds later
    expect(after).toBeGreaterThan(before);
  });

  test("returns false for non-existent effect", () => {
    expect(extendEffect(999, 60_000)).toBe(false);
  });
});

// =============================================================================
// hasActiveEffects
// =============================================================================

describe("hasActiveEffects", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns true when entity has active effects", () => {
    const entityId = insertEntity(testDb);
    addEffect(entityId, "active", 60_000);
    expect(hasActiveEffects(entityId)).toBe(true);
  });

  test("returns false when entity has no effects", () => {
    const entityId = insertEntity(testDb);
    expect(hasActiveEffects(entityId)).toBe(false);
  });

  test("returns false when all effects are expired", () => {
    const entityId = insertEntity(testDb);
    const pastDate = new Date(Date.now() - 10_000).toISOString();
    testDb.prepare(`INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)`).run(entityId, "expired", pastDate);
    expect(hasActiveEffects(entityId)).toBe(false);
  });
});
