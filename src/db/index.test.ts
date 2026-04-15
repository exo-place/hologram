/**
 * Tests for src/db/index.ts — schema initialization.
 *
 * We bypass the singleton getDb() (which opens hologram.db on disk) and instead
 * test the schema by calling initSchema via a fresh in-memory Database each time.
 * The initSchema function is private, so we replicate its SQL here. This keeps
 * the test isolated and verifies the actual DDL statements used in production.
 *
 * We verify:
 *   - All tables and virtual tables are created
 *   - FK constraints work (insert with nonexistent parent → error)
 *   - CASCADE deletes propagate from entities to all child tables
 *   - Unique constraints are enforced
 *   - The migration block (webhook_messages FK) produces the correct schema
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { load } from "sqlite-vec";
import { createTestDb } from "./test-utils";
import { initSchema } from "./schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fully-initialised in-memory DB with the production schema. */
function makeDb(): Database {
  return createTestDb({ useVec0: true });
}

/**
 * Alias for initSchema — kept for backward-compat in the "run twice" test.
 */
function applySchema(db: Database) {
  initSchema(db);
}

/** Helper: insert a minimal entity and return its id. */
function insertEntity(db: Database, name = "TestEntity"): number {
  const result = db.prepare("INSERT INTO entities (name) VALUES (?)").run(name);
  return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------

describe("schema: all tables exist", () => {
  test("every expected table is present in sqlite_master", () => {
    const db = makeDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','shadow') ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    const expectedTables = [
      "attachment_cache",
      "channel_forgets",
      "discord_config",
      "discord_entities",
      "effects",
      "entities",
      "entity_memories",
      "eval_errors",
      "facts",
      "messages",
      "web_channels",
      "webhook_messages",
      "webhooks",
      "welcomed_users",
    ];
    for (const t of expectedTables) {
      expect(tables).toContain(t);
    }
  });

  test("virtual tables fact_embeddings and memory_embeddings exist", () => {
    const db = makeDb();
    const vtables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%embeddings%'")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    // vec0 virtual tables appear as regular tables in sqlite_master
    expect(vtables.some((n) => n.includes("fact_embeddings"))).toBe(true);
    expect(vtables.some((n) => n.includes("memory_embeddings"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Foreign key constraints
// ---------------------------------------------------------------------------

describe("schema: FK constraints are enforced (PRAGMA foreign_keys = ON)", () => {
  test("inserting a fact with a nonexistent entity_id fails", () => {
    const db = makeDb();
    expect(() => {
      db.prepare("INSERT INTO facts (entity_id, content) VALUES (?, ?)").run(9999, "orphan fact");
    }).toThrow();
  });

  test("inserting a discord_entity with nonexistent entity_id fails", () => {
    const db = makeDb();
    expect(() => {
      db.prepare(
        "INSERT INTO discord_entities (discord_id, discord_type, entity_id) VALUES (?, ?, ?)",
      ).run("chan-1", "channel", 9999);
    }).toThrow();
  });

  test("inserting an effect with nonexistent entity_id fails", () => {
    const db = makeDb();
    expect(() => {
      db.prepare(
        "INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)",
      ).run(9999, "effect", "2099-01-01");
    }).toThrow();
  });

  test("inserting a webhook_message with nonexistent entity_id fails", () => {
    const db = makeDb();
    expect(() => {
      db.prepare(
        "INSERT INTO webhook_messages (message_id, entity_id, entity_name) VALUES (?, ?, ?)",
      ).run("msg-1", 9999, "Ghost");
    }).toThrow();
  });

  test("inserting an eval_error with nonexistent entity_id fails", () => {
    const db = makeDb();
    expect(() => {
      db.prepare(
        "INSERT INTO eval_errors (entity_id, owner_id, error_message) VALUES (?, ?, ?)",
      ).run(9999, "owner-1", "boom");
    }).toThrow();
  });

  test("inserting an entity_memory with nonexistent entity_id fails", () => {
    const db = makeDb();
    expect(() => {
      db.prepare(
        "INSERT INTO entity_memories (entity_id, content) VALUES (?, ?)",
      ).run(9999, "a memory");
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CASCADE deletes
// ---------------------------------------------------------------------------

describe("schema: CASCADE deletes from entities", () => {
  test("deleting an entity cascades to facts", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare("INSERT INTO facts (entity_id, content) VALUES (?, ?)").run(id, "some fact");

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const remaining = db.prepare("SELECT COUNT(*) as n FROM facts WHERE entity_id = ?").get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test("deleting an entity cascades to effects", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare("INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)").run(id, "glowing", "2099-01-01");

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const remaining = db.prepare("SELECT COUNT(*) as n FROM effects WHERE entity_id = ?").get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test("deleting an entity cascades to discord_entities", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare(
      "INSERT INTO discord_entities (discord_id, discord_type, entity_id) VALUES (?, ?, ?)",
    ).run("ch-123", "channel", id);

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM discord_entities WHERE entity_id = ?")
      .get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test("deleting an entity cascades to webhook_messages", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare(
      "INSERT INTO webhook_messages (message_id, entity_id, entity_name) VALUES (?, ?, ?)",
    ).run("msg-cascade", id, "TestEntity");

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM webhook_messages WHERE entity_id = ?")
      .get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test("deleting an entity cascades to eval_errors", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare(
      "INSERT INTO eval_errors (entity_id, owner_id, error_message) VALUES (?, ?, ?)",
    ).run(id, "owner-1", "template parse error");

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM eval_errors WHERE entity_id = ?")
      .get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test("deleting an entity cascades to entity_memories", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare("INSERT INTO entity_memories (entity_id, content) VALUES (?, ?)").run(id, "I remember");

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM entity_memories WHERE entity_id = ?")
      .get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test("deleting an entity removes all child rows in one operation (full cascade)", () => {
    const db = makeDb();
    const id = insertEntity(db, "FullCascade");

    // Populate every child table that FKs to entities
    db.prepare("INSERT INTO facts (entity_id, content) VALUES (?, ?)").run(id, "fact");
    db.prepare("INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)").run(id, "eff", "2099-01-01");
    db.prepare("INSERT INTO discord_entities (discord_id, discord_type, entity_id) VALUES (?, ?, ?)").run("u-1", "user", id);
    db.prepare("INSERT INTO webhook_messages (message_id, entity_id, entity_name) VALUES (?, ?, ?)").run("wm-1", id, "FullCascade");
    db.prepare("INSERT INTO eval_errors (entity_id, owner_id, error_message) VALUES (?, ?, ?)").run(id, "owner-1", "err");
    db.prepare("INSERT INTO entity_memories (entity_id, content) VALUES (?, ?)").run(id, "mem");

    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const counts = [
      db.prepare("SELECT COUNT(*) as n FROM facts WHERE entity_id = ?").get(id) as { n: number },
      db.prepare("SELECT COUNT(*) as n FROM effects WHERE entity_id = ?").get(id) as { n: number },
      db.prepare("SELECT COUNT(*) as n FROM discord_entities WHERE entity_id = ?").get(id) as { n: number },
      db.prepare("SELECT COUNT(*) as n FROM webhook_messages WHERE entity_id = ?").get(id) as { n: number },
      db.prepare("SELECT COUNT(*) as n FROM eval_errors WHERE entity_id = ?").get(id) as { n: number },
      db.prepare("SELECT COUNT(*) as n FROM entity_memories WHERE entity_id = ?").get(id) as { n: number },
    ];
    for (const { n } of counts) {
      expect(n).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Unique constraints
// ---------------------------------------------------------------------------

describe("schema: unique constraints", () => {
  test("discord_entities: duplicate (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id) is rejected", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare(
      "INSERT INTO discord_entities (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id) VALUES (?, ?, ?, ?, ?)",
    ).run("ch-1", "channel", "g-1", "sc-1", id);

    expect(() => {
      db.prepare(
        "INSERT INTO discord_entities (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id) VALUES (?, ?, ?, ?, ?)",
      ).run("ch-1", "channel", "g-1", "sc-1", id);
    }).toThrow();
  });

  test("webhooks: duplicate channel_id is rejected", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO webhooks (channel_id, webhook_id, webhook_token) VALUES (?, ?, ?)",
    ).run("ch-100", "wh-1", "tok-1");

    expect(() => {
      db.prepare(
        "INSERT INTO webhooks (channel_id, webhook_id, webhook_token) VALUES (?, ?, ?)",
      ).run("ch-100", "wh-2", "tok-2");
    }).toThrow();
  });

  test("eval_errors: duplicate (entity_id, error_message) is rejected", () => {
    const db = makeDb();
    const id = insertEntity(db);
    db.prepare(
      "INSERT INTO eval_errors (entity_id, owner_id, error_message) VALUES (?, ?, ?)",
    ).run(id, "owner-1", "same error");

    expect(() => {
      db.prepare(
        "INSERT INTO eval_errors (entity_id, owner_id, error_message) VALUES (?, ?, ?)",
      ).run(id, "owner-1", "same error");
    }).toThrow();
  });

  test("messages: duplicate discord_message_id (non-null) is rejected", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO messages (channel_id, author_id, author_name, content, discord_message_id) VALUES (?, ?, ?, ?, ?)",
    ).run("ch-1", "u-1", "Alice", "hello", "disc-msg-1");

    expect(() => {
      db.prepare(
        "INSERT INTO messages (channel_id, author_id, author_name, content, discord_message_id) VALUES (?, ?, ?, ?, ?)",
      ).run("ch-1", "u-2", "Bob", "hi", "disc-msg-1");
    }).toThrow();
  });

  test("messages: multiple rows with NULL discord_message_id are allowed", () => {
    const db = makeDb();
    // SQLite partial unique index: NULLs are excluded, so multiple NULLs must be OK
    db.prepare(
      "INSERT INTO messages (channel_id, author_id, author_name, content) VALUES (?, ?, ?, ?)",
    ).run("ch-1", "u-1", "Alice", "msg 1");
    db.prepare(
      "INSERT INTO messages (channel_id, author_id, author_name, content) VALUES (?, ?, ?, ?)",
    ).run("ch-1", "u-2", "Bob", "msg 2");

    const count = db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number };
    expect(count.n).toBe(2);
  });

  test("discord_config: duplicate (discord_id, discord_type) primary key is rejected", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO discord_config (discord_id, discord_type) VALUES (?, ?)",
    ).run("guild-1", "guild");

    expect(() => {
      db.prepare(
        "INSERT INTO discord_config (discord_id, discord_type) VALUES (?, ?)",
      ).run("guild-1", "guild");
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CHECK constraints
// ---------------------------------------------------------------------------

describe("schema: CHECK constraints", () => {
  test("discord_entities: invalid discord_type is rejected", () => {
    const db = makeDb();
    const id = insertEntity(db);
    expect(() => {
      db.prepare(
        "INSERT INTO discord_entities (discord_id, discord_type, entity_id) VALUES (?, ?, ?)",
      ).run("x-1", "bot", id);
    }).toThrow();
  });

  test("discord_config: invalid discord_type is rejected", () => {
    const db = makeDb();
    expect(() => {
      db.prepare(
        "INSERT INTO discord_config (discord_id, discord_type) VALUES (?, ?)",
      ).run("x-1", "user");
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema is idempotent (CREATE IF NOT EXISTS + migrations)
// ---------------------------------------------------------------------------

describe("schema: idempotent initialization", () => {
  test("running applySchema twice does not throw", () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    load(db);
    expect(() => {
      applySchema(db);
      applySchema(db);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// webhook_messages FK migration
// ---------------------------------------------------------------------------

describe("webhook_messages FK migration", () => {
  test("webhook_messages has ON DELETE CASCADE after migration", () => {
    const db = makeDb();
    const id = insertEntity(db, "MigTest");
    db.prepare(
      "INSERT INTO webhook_messages (message_id, entity_id, entity_name) VALUES (?, ?, ?)",
    ).run("wm-migrate", id, "MigTest");

    // Deleting the entity should cascade — the FK + CASCADE is the whole point of the migration
    db.prepare("DELETE FROM entities WHERE id = ?").run(id);

    const row = db.prepare("SELECT * FROM webhook_messages WHERE message_id = ?").get("wm-migrate");
    expect(row).toBeNull();
  });

  test("pre-existing webhook_messages rows survive the migration", () => {
    // Simulate old state: webhook_messages without FK (plain table), then migrate
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    load(db);

    // Create entities first (needed for FK after migration)
    db.exec(`CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owned_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, template TEXT, system_template TEXT, config_context TEXT, config_model TEXT, config_respond TEXT, config_stream_mode TEXT, config_stream_delimiters TEXT, config_avatar TEXT, config_memory TEXT, config_freeform INTEGER DEFAULT 0, config_strip TEXT, config_view TEXT, config_edit TEXT, config_use TEXT, config_blacklist TEXT)`);

    const entityId = Number(db.prepare("INSERT INTO entities (name) VALUES (?)").run("OldEntity").lastInsertRowid);

    // Create old-style webhook_messages without FK
    db.exec(`
      CREATE TABLE webhook_messages (
        message_id TEXT PRIMARY KEY,
        entity_id INTEGER NOT NULL,
        entity_name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.prepare(
      "INSERT INTO webhook_messages (message_id, entity_id, entity_name) VALUES (?, ?, ?)",
    ).run("old-msg", entityId, "OldEntity");

    // Run migration block (mirrors production code)
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_messages_new (
        message_id TEXT PRIMARY KEY,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        entity_name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`INSERT OR IGNORE INTO webhook_messages_new SELECT * FROM webhook_messages`);
    db.exec(`DROP TABLE webhook_messages`);
    db.exec(`ALTER TABLE webhook_messages_new RENAME TO webhook_messages`);

    // Pre-existing row should still be there
    const row = db.prepare("SELECT * FROM webhook_messages WHERE message_id = ?").get("old-msg") as { entity_id: number } | null;
    expect(row).not.toBeNull();
    expect(row!.entity_id).toBe(entityId);
  });
});
