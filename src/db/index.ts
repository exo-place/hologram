import { Database } from "bun:sqlite";
import { load } from "sqlite-vec";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database("hologram.db");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // Load sqlite-vec extension
    load(db);

    // Initialize schema
    initSchema(db);
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(db: Database) {
  // Entities - the core of everything
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owned_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Facts - attached to entities
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Discord ID to entity mapping (scoped)
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('user', 'channel', 'guild')),
      scope_guild_id TEXT,
      scope_channel_id TEXT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id)
    )
  `);

  // Fact embeddings for semantic search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings USING vec0(
      fact_id INTEGER PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);

  // Message history per channel (simple buffer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Welcomed users (for onboarding DM tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS welcomed_users (
      discord_id TEXT PRIMARY KEY,
      welcomed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Effects - temporary fact overlays
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

  // Entity memories - LLM-curated long-term memory
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

  // Memory embeddings for semantic search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
      memory_id INTEGER PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);

  // Webhook cache (one per channel, reused with different username/avatar)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL UNIQUE,
      webhook_id TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Webhook messages - track which entity sent which message (for reply detection)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_messages (
      message_id TEXT PRIMARY KEY,
      entity_id INTEGER NOT NULL,
      entity_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Evaluation errors - for deduped DM notifications to entity owners
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      error_message TEXT NOT NULL,
      condition TEXT,
      notified_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (entity_id, error_message)
    )
  `);

  // Channel forget timestamps - messages before this time are excluded from context
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_forgets (
      channel_id TEXT PRIMARY KEY,
      forget_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discord_entities_lookup ON discord_entities(discord_id, discord_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_entity ON effects(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_expires ON effects(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity ON entity_memories(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_frecency ON entity_memories(entity_id, frecency DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON webhooks(channel_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_errors_owner ON eval_errors(owner_id, notified_at)`);

  // Migrations
  migrateCreatedByToOwnedBy(db);
  migrateDiscordEntitiesConstraint(db);
  migrateMessagesDiscordId(db);
  migrateEntityTemplate(db);
  migrateMessagesData(db);
  migrateEntityConfigColumns(db);
}

/**
 * Migrate entities table: rename created_by column to owned_by.
 * SQLite supports ALTER TABLE RENAME COLUMN since 3.25.0.
 */
function migrateCreatedByToOwnedBy(db: Database) {
  // Check if old column exists
  const columns = db.prepare(`PRAGMA table_info(entities)`).all() as Array<{ name: string }>;
  const hasOldColumn = columns.some((c) => c.name === "created_by");
  const hasNewColumn = columns.some((c) => c.name === "owned_by");

  if (hasOldColumn && !hasNewColumn) {
    db.exec(`ALTER TABLE entities RENAME COLUMN created_by TO owned_by`);
  }
}

/**
 * Add discord_message_id column to messages table for edit/delete tracking.
 */
function migrateMessagesDiscordId(db: Database) {
  const columns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  if (columns.some(c => c.name === "discord_message_id")) return;

  db.exec(`ALTER TABLE messages ADD COLUMN discord_message_id TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_discord_id ON messages(discord_message_id)`);
}

/**
 * Add template column to entities table for custom system prompt templates.
 */
function migrateEntityTemplate(db: Database) {
  const columns = db.prepare(`PRAGMA table_info(entities)`).all() as Array<{ name: string }>;
  if (columns.some(c => c.name === "template")) return;

  db.exec(`ALTER TABLE entities ADD COLUMN template TEXT`);
}

/**
 * Add data column to messages table for structured message metadata (JSON blob).
 */
function migrateMessagesData(db: Database) {
  const columns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  if (columns.some(c => c.name === "data")) return;
  db.exec(`ALTER TABLE messages ADD COLUMN data TEXT`);
}

/**
 * Migrate discord_entities table to allow multiple entities bound to the same channel.
 * Old constraint: UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id)
 * New constraint: UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
 */
function migrateDiscordEntitiesConstraint(db: Database) {
  // Check current schema
  const tableInfo = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name='discord_entities'
  `).get() as { sql: string } | null;

  if (!tableInfo) return;

  // Already migrated if entity_id is in the UNIQUE constraint
  if (tableInfo.sql.includes("scope_channel_id, entity_id)")) return;

  // Perform migration
  db.exec(`
    CREATE TABLE discord_entities_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('user', 'channel', 'guild')),
      scope_guild_id TEXT,
      scope_channel_id TEXT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
    );
    INSERT INTO discord_entities_new SELECT * FROM discord_entities;
    DROP TABLE discord_entities;
    ALTER TABLE discord_entities_new RENAME TO discord_entities;
    CREATE INDEX idx_discord_entities_lookup ON discord_entities(discord_id, discord_type);
  `);
}

/**
 * Add config columns to entities table for directive storage.
 * Migrates unconditional directive facts into config columns and removes them from facts.
 */
function migrateEntityConfigColumns(db: Database) {
  const columns = db.prepare(`PRAGMA table_info(entities)`).all() as Array<{ name: string }>;
  const hasConfigColumns = columns.some(c => c.name === "config_context");
  if (hasConfigColumns) return; // Already migrated

  // Add config columns
  db.exec(`ALTER TABLE entities ADD COLUMN config_context TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_model TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_respond TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_stream_mode TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_stream_delimiters TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_avatar TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_memory TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_freeform INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_strip TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_view TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_edit TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_use TEXT`);
  db.exec(`ALTER TABLE entities ADD COLUMN config_blacklist TEXT`);

  // Migrate existing facts into config columns
  const { parseFact, parsePermissionDirectives } = require("../logic/expr");

  const entities = db.prepare(`SELECT id FROM entities`).all() as Array<{ id: number }>;
  const updateStmt = db.prepare(`
    UPDATE entities SET
      config_context = ?, config_model = ?, config_respond = ?,
      config_stream_mode = ?, config_stream_delimiters = ?,
      config_avatar = ?, config_memory = ?, config_freeform = ?,
      config_strip = ?, config_view = ?, config_edit = ?,
      config_use = ?, config_blacklist = ?
    WHERE id = ?
  `);
  const deleteFactStmt = db.prepare(`DELETE FROM facts WHERE id = ?`);

  for (const { id } of entities) {
    const facts = db.prepare(`SELECT id, content FROM facts WHERE entity_id = ? ORDER BY created_at`).all(id) as Array<{ id: number; content: string }>;

    // Extract config from unconditional directives
    let configContext: string | null = null;
    let configModel: string | null = null;
    let configRespond: string | null = null;
    let configStreamMode: string | null = null;
    let configStreamDelimiters: string | null = null;
    let configAvatar: string | null = null;
    let configMemory: string | null = null;
    let configFreeform = 0;
    let configStrip: string | null = null;
    const factIdsToDelete: number[] = [];

    for (const fact of facts) {
      const parsed = parseFact(fact.content);
      // Only migrate unconditional directives
      if (parsed.conditional) continue;

      if (parsed.isContext && parsed.contextExpr) {
        configContext = parsed.contextExpr;
        factIdsToDelete.push(fact.id);
      } else if (parsed.isModel && parsed.modelSpec) {
        configModel = parsed.modelSpec;
        factIdsToDelete.push(fact.id);
      } else if (parsed.isRespond) {
        configRespond = parsed.respondValue === false ? "false" : "true";
        factIdsToDelete.push(fact.id);
      } else if (parsed.isStream) {
        configStreamMode = parsed.streamMode ?? null;
        configStreamDelimiters = parsed.streamDelimiter ? JSON.stringify(parsed.streamDelimiter) : null;
        factIdsToDelete.push(fact.id);
      } else if (parsed.isAvatar && parsed.avatarUrl) {
        configAvatar = parsed.avatarUrl;
        factIdsToDelete.push(fact.id);
      } else if (parsed.isMemory && parsed.memoryScope) {
        configMemory = parsed.memoryScope;
        factIdsToDelete.push(fact.id);
      } else if (parsed.isFreeform) {
        configFreeform = 1;
        factIdsToDelete.push(fact.id);
      } else if (parsed.isStrip) {
        configStrip = parsed.stripPatterns ? JSON.stringify(parsed.stripPatterns) : "[]";
        factIdsToDelete.push(fact.id);
      }
    }

    // Parse permission directives
    const rawFacts = facts.map(f => f.content);
    const permissions = parsePermissionDirectives(rawFacts);
    let configView: string | null = null;
    let configEdit: string | null = null;
    let configUse: string | null = null;
    let configBlacklist: string | null = null;

    if (permissions.viewList !== null) {
      configView = JSON.stringify(permissions.viewList);
    }
    if (permissions.editList !== null) {
      configEdit = JSON.stringify(permissions.editList);
    }
    if (permissions.useList !== null) {
      configUse = JSON.stringify(permissions.useList);
    }
    if (permissions.blacklist.length > 0) {
      configBlacklist = JSON.stringify(permissions.blacklist);
    }

    // Mark permission facts for deletion (unconditional only)
    for (const fact of facts) {
      const trimmed = fact.content.trim();
      if (trimmed.startsWith("$#")) continue; // comment
      if (trimmed.startsWith("$if ")) continue; // conditional
      if (trimmed.startsWith("$edit ") || trimmed.startsWith("$view ") ||
          trimmed.startsWith("$use ") || trimmed.startsWith("$blacklist ")) {
        factIdsToDelete.push(fact.id);
      }
    }

    // Write config columns
    const hasConfig = configContext || configModel || configRespond || configStreamMode ||
      configAvatar || configMemory || configFreeform || configStrip ||
      configView || configEdit || configUse || configBlacklist;

    if (hasConfig) {
      updateStmt.run(
        configContext, configModel, configRespond,
        configStreamMode, configStreamDelimiters,
        configAvatar, configMemory, configFreeform,
        configStrip, configView, configEdit,
        configUse, configBlacklist, id,
      );
    }

    // Delete migrated facts
    for (const factId of factIdsToDelete) {
      deleteFactStmt.run(factId);
    }
  }
}
