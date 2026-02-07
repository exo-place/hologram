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

import {
  createEntity,
  getEntity,
  getEntityByName,
  updateEntity,
  deleteEntity,
  listEntities,
  searchEntities,
  searchEntitiesOwnedBy,
  getEntityConfig,
  setEntityConfig,
  getPermissionDefaults,
  getEntityEvalDefaults,
  getEntityTemplate,
  setEntityTemplate,
  getEntitySystemTemplate,
  setEntitySystemTemplate,
  addFact,
  getFact,
  getFactsForEntity,
  updateFact,
  updateFactByContent,
  removeFact,
  removeFactByContent,
  setFacts,
  getEntityWithFacts,
  getEntityWithFactsByName,
  getEntitiesWithFacts,
  formatEntityForContext,
  formatEntitiesForContext,
  transferOwnership,
} from "./entities";

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
      config_thinking TEXT
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

  db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_entity ON effects(entity_id)`);
}

// =============================================================================
// Entity CRUD
// =============================================================================

describe("createEntity / getEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("creates entity and returns it", () => {
    const entity = createEntity("Aria", "owner-1");
    expect(entity.name).toBe("Aria");
    expect(entity.owned_by).toBe("owner-1");
    expect(entity.id).toBeGreaterThan(0);
  });

  test("creates entity without owner", () => {
    const entity = createEntity("Location");
    expect(entity.owned_by).toBeNull();
  });

  test("getEntity retrieves by ID", () => {
    const created = createEntity("Aria");
    const found = getEntity(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Aria");
  });

  test("getEntity returns null for missing ID", () => {
    expect(getEntity(999)).toBeNull();
  });
});

describe("getEntityByName", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("finds entity case-insensitively", () => {
    createEntity("Aria");
    expect(getEntityByName("aria")).not.toBeNull();
    expect(getEntityByName("ARIA")).not.toBeNull();
    expect(getEntityByName("Aria")).not.toBeNull();
  });

  test("returns null when not found", () => {
    expect(getEntityByName("missing")).toBeNull();
  });
});

describe("updateEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("updates entity name", () => {
    const entity = createEntity("OldName");
    const updated = updateEntity(entity.id, "NewName");
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("NewName");
  });

  test("returns null for missing ID", () => {
    expect(updateEntity(999, "Name")).toBeNull();
  });
});

describe("deleteEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("deletes entity and returns true", () => {
    const entity = createEntity("Aria");
    expect(deleteEntity(entity.id)).toBe(true);
    expect(getEntity(entity.id)).toBeNull();
  });

  test("returns false for missing ID", () => {
    expect(deleteEntity(999)).toBe(false);
  });

  test("cascades to facts", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "is a character");
    deleteEntity(entity.id);
    expect(getFactsForEntity(entity.id)).toEqual([]);
  });
});

describe("listEntities", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("lists entities", () => {
    createEntity("A");
    createEntity("B");
    createEntity("C");
    const all = listEntities();
    expect(all.length).toBe(3);
  });

  test("respects limit and offset", () => {
    createEntity("A");
    createEntity("B");
    createEntity("C");
    expect(listEntities(2, 0).length).toBe(2);
    expect(listEntities(2, 2).length).toBe(1);
  });

  test("returns empty for no entities", () => {
    expect(listEntities()).toEqual([]);
  });
});

describe("searchEntities", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("searches by name substring", () => {
    createEntity("Alice");
    createEntity("Bob");
    createEntity("Alicia");
    const results = searchEntities("Ali");
    expect(results.length).toBe(2);
  });

  test("is case-insensitive", () => {
    createEntity("Alice");
    expect(searchEntities("alice").length).toBe(1);
  });

  test("returns empty for no match", () => {
    createEntity("Alice");
    expect(searchEntities("xyz")).toEqual([]);
  });
});

describe("searchEntitiesOwnedBy", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("filters by owner", () => {
    createEntity("Alice", "owner-1");
    createEntity("Bob", "owner-2");
    createEntity("Alicia", "owner-1");
    const results = searchEntitiesOwnedBy("", "owner-1");
    expect(results.length).toBe(2);
  });

  test("filters by both name and owner", () => {
    createEntity("Alice", "owner-1");
    createEntity("Bob", "owner-1");
    const results = searchEntitiesOwnedBy("Ali", "owner-1");
    expect(results.length).toBe(1);
  });
});

// =============================================================================
// Fact CRUD
// =============================================================================

describe("fact operations", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("addFact creates a fact", () => {
    const entity = createEntity("Aria");
    const fact = addFact(entity.id, "is a character");
    expect(fact.entity_id).toBe(entity.id);
    expect(fact.content).toBe("is a character");
  });

  test("getFact retrieves by ID", () => {
    const entity = createEntity("Aria");
    const fact = addFact(entity.id, "has silver hair");
    expect(getFact(fact.id)!.content).toBe("has silver hair");
  });

  test("getFact returns null for missing ID", () => {
    expect(getFact(999)).toBeNull();
  });

  test("getFactsForEntity returns all facts in order", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "fact 1");
    addFact(entity.id, "fact 2");
    addFact(entity.id, "fact 3");
    const facts = getFactsForEntity(entity.id);
    expect(facts.length).toBe(3);
    expect(facts.map(f => f.content)).toEqual(["fact 1", "fact 2", "fact 3"]);
  });

  test("updateFact changes content", () => {
    const entity = createEntity("Aria");
    const fact = addFact(entity.id, "old content");
    const updated = updateFact(fact.id, "new content");
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("new content");
  });

  test("updateFact returns null for missing ID", () => {
    expect(updateFact(999, "content")).toBeNull();
  });

  test("updateFactByContent updates matching fact", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "old fact");
    const updated = updateFactByContent(entity.id, "old fact", "new fact");
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("new fact");
  });

  test("updateFactByContent returns null when content not found", () => {
    const entity = createEntity("Aria");
    expect(updateFactByContent(entity.id, "nonexistent", "new")).toBeNull();
  });

  test("removeFact deletes a fact", () => {
    const entity = createEntity("Aria");
    const fact = addFact(entity.id, "to delete");
    expect(removeFact(fact.id)).toBe(true);
    expect(getFact(fact.id)).toBeNull();
  });

  test("removeFact returns false for missing ID", () => {
    expect(removeFact(999)).toBe(false);
  });

  test("removeFactByContent deletes matching fact", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "to delete");
    expect(removeFactByContent(entity.id, "to delete")).toBe(true);
    expect(getFactsForEntity(entity.id)).toEqual([]);
  });

  test("removeFactByContent returns false when not found", () => {
    const entity = createEntity("Aria");
    expect(removeFactByContent(entity.id, "nonexistent")).toBe(false);
  });

  test("setFacts replaces all facts", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "old 1");
    addFact(entity.id, "old 2");
    const newFacts = setFacts(entity.id, ["new 1", "new 2", "new 3"]);
    expect(newFacts.length).toBe(3);
    expect(getFactsForEntity(entity.id).map(f => f.content)).toEqual(["new 1", "new 2", "new 3"]);
  });

  test("setFacts with empty array clears facts", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "existing");
    setFacts(entity.id, []);
    expect(getFactsForEntity(entity.id)).toEqual([]);
  });
});

// =============================================================================
// Entity Config
// =============================================================================

describe("entity config", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("getEntityConfig returns config columns", () => {
    const entity = createEntity("Aria");
    const config = getEntityConfig(entity.id);
    expect(config).not.toBeNull();
    expect(config!.config_model).toBeNull();
    expect(config!.config_freeform).toBe(0);
  });

  test("setEntityConfig updates specific columns", () => {
    const entity = createEntity("Aria");
    setEntityConfig(entity.id, { config_model: "google:gemini-2.0-flash", config_freeform: 1 });
    const config = getEntityConfig(entity.id);
    expect(config!.config_model).toBe("google:gemini-2.0-flash");
    expect(config!.config_freeform).toBe(1);
  });

  test("setEntityConfig with empty object is a no-op", () => {
    const entity = createEntity("Aria");
    setEntityConfig(entity.id, {});
    expect(getEntityConfig(entity.id)).not.toBeNull();
  });

  test("getEntityConfig returns null for missing entity", () => {
    expect(getEntityConfig(999)).toBeNull();
  });
});

describe("getPermissionDefaults", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns nulls for entity with no config", () => {
    const entity = createEntity("Aria");
    const perms = getPermissionDefaults(entity.id);
    expect(perms.editList).toBeNull();
    expect(perms.viewList).toBeNull();
    expect(perms.useList).toBeNull();
    expect(perms.blacklist).toEqual([]);
  });

  test("parses JSON permission lists", () => {
    const entity = createEntity("Aria");
    setEntityConfig(entity.id, {
      config_edit: JSON.stringify(["user-1"]),
      config_view: JSON.stringify("@everyone"),
      config_blacklist: JSON.stringify(["bad-user"]),
    });
    const perms = getPermissionDefaults(entity.id);
    expect(perms.editList).toEqual(["user-1"]);
    expect(perms.viewList).toBe("@everyone");
    expect(perms.blacklist).toEqual(["bad-user"]);
  });

  test("returns defaults for missing entity", () => {
    const perms = getPermissionDefaults(999);
    expect(perms).toEqual({ editList: null, viewList: null, useList: null, blacklist: [] });
  });
});

describe("getEntityEvalDefaults", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns defaults for unconfigured entity", () => {
    const entity = createEntity("Aria");
    const defaults = getEntityEvalDefaults(entity.id);
    expect(defaults.contextExpr).toBeNull();
    expect(defaults.modelSpec).toBeNull();
    expect(defaults.isFreeform).toBe(false);
    expect(defaults.memoryScope).toBe("none");
  });

  test("parses configured values", () => {
    const entity = createEntity("Aria");
    setEntityConfig(entity.id, {
      config_context: "chars < 8000",
      config_model: "google:gemini-2.0-flash",
      config_stream_mode: "lines",
      config_freeform: 1,
      config_memory: "channel",
      config_respond: "true",
    });
    const defaults = getEntityEvalDefaults(entity.id);
    expect(defaults.contextExpr).toBe("chars < 8000");
    expect(defaults.modelSpec).toBe("google:gemini-2.0-flash");
    expect(defaults.streamMode).toBe("lines");
    expect(defaults.isFreeform).toBe(true);
    expect(defaults.memoryScope).toBe("channel");
    expect(defaults.shouldRespond).toBe(true);
  });

  test("parses shouldRespond false", () => {
    const entity = createEntity("Aria");
    setEntityConfig(entity.id, { config_respond: "false" });
    expect(getEntityEvalDefaults(entity.id).shouldRespond).toBe(false);
  });

  test("returns empty for missing entity", () => {
    expect(getEntityEvalDefaults(999)).toEqual({});
  });
});

// =============================================================================
// Templates
// =============================================================================

describe("entity templates", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("getEntityTemplate returns null by default", () => {
    const entity = createEntity("Aria");
    expect(getEntityTemplate(entity.id)).toBeNull();
  });

  test("setEntityTemplate and getEntityTemplate round-trip", () => {
    const entity = createEntity("Aria");
    setEntityTemplate(entity.id, "{% block main %}Hello{% endblock %}");
    expect(getEntityTemplate(entity.id)).toBe("{% block main %}Hello{% endblock %}");
  });

  test("setEntityTemplate to null clears template", () => {
    const entity = createEntity("Aria");
    setEntityTemplate(entity.id, "template");
    setEntityTemplate(entity.id, null);
    expect(getEntityTemplate(entity.id)).toBeNull();
  });

  test("getEntitySystemTemplate returns null by default", () => {
    const entity = createEntity("Aria");
    expect(getEntitySystemTemplate(entity.id)).toBeNull();
  });

  test("setEntitySystemTemplate and getEntitySystemTemplate round-trip", () => {
    const entity = createEntity("Aria");
    setEntitySystemTemplate(entity.id, "You are a helpful assistant.");
    expect(getEntitySystemTemplate(entity.id)).toBe("You are a helpful assistant.");
  });
});

// =============================================================================
// Combined Views
// =============================================================================

describe("getEntityWithFacts", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns entity with its facts", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "is a character");
    addFact(entity.id, "has silver hair");
    const result = getEntityWithFacts(entity.id);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Aria");
    expect(result!.facts.length).toBe(2);
    expect(result!.facts.map(f => f.content)).toEqual(["is a character", "has silver hair"]);
  });

  test("returns null for missing entity", () => {
    expect(getEntityWithFacts(999)).toBeNull();
  });
});

describe("getEntityWithFactsByName", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("finds by name case-insensitively", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "is a character");
    const result = getEntityWithFactsByName("aria");
    expect(result).not.toBeNull();
    expect(result!.facts.length).toBe(1);
  });

  test("returns null when not found", () => {
    expect(getEntityWithFactsByName("missing")).toBeNull();
  });
});

describe("getEntitiesWithFacts", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("batch loads entities with facts", () => {
    const e1 = createEntity("Alice");
    const e2 = createEntity("Bob");
    addFact(e1.id, "alice fact 1");
    addFact(e1.id, "alice fact 2");
    addFact(e2.id, "bob fact 1");
    const map = getEntitiesWithFacts([e1.id, e2.id]);
    expect(map.size).toBe(2);
    expect(map.get(e1.id)!.facts.length).toBe(2);
    expect(map.get(e2.id)!.facts.length).toBe(1);
  });

  test("handles empty array", () => {
    expect(getEntitiesWithFacts([])).toEqual(new Map());
  });

  test("handles entity with no facts", () => {
    const entity = createEntity("Empty");
    const map = getEntitiesWithFacts([entity.id]);
    expect(map.get(entity.id)!.facts).toEqual([]);
  });
});

// =============================================================================
// Context Formatting
// =============================================================================

describe("formatEntityForContext", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("formats entity with facts", () => {
    const entity = createEntity("Aria");
    addFact(entity.id, "is a character");
    addFact(entity.id, "has silver hair");
    const ewf = getEntityWithFacts(entity.id)!;
    expect(formatEntityForContext(ewf)).toBe(
      `<facts entity="Aria" id="${entity.id}">\nis a character\nhas silver hair\n</facts>`
    );
  });
});

describe("formatEntitiesForContext", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("formats multiple entities separated by double newlines", () => {
    const e1 = createEntity("Alice");
    const e2 = createEntity("Bob");
    addFact(e1.id, "is kind");
    addFact(e2.id, "is strong");
    const entities = [getEntityWithFacts(e1.id)!, getEntityWithFacts(e2.id)!];
    const result = formatEntitiesForContext(entities);
    expect(result).toContain('<facts entity="Alice"');
    expect(result).toContain('<facts entity="Bob"');
    expect(result).toContain("\n\n");
  });
});

// =============================================================================
// Ownership
// =============================================================================

describe("transferOwnership", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("transfers ownership to new user", () => {
    const entity = createEntity("Aria", "owner-1");
    const updated = transferOwnership(entity.id, "owner-2");
    expect(updated).not.toBeNull();
    expect(updated!.owned_by).toBe("owner-2");
  });

  test("returns null for missing entity", () => {
    expect(transferOwnership(999, "owner")).toBeNull();
  });
});
