/**
 * Database schema initialization — extracted so tests can import it directly
 * without going through the singleton in index.ts (which gets mocked in tests).
 */
import type { Database } from "bun:sqlite";

/**
 * Initialize the full database schema.
 *
 * @param useVec0 - If false, creates plain BLOB tables instead of vec0 virtual
 *   tables for embeddings. Useful in tests that don't load sqlite-vec.
 */
export function initSchema(db: Database, { useVec0 = true } = {}) {
  // Entities - the core of everything
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
      config_keywords TEXT,
      config_safety TEXT,
      config_queue_disabled INTEGER DEFAULT 0,
      config_rate_per_min INTEGER
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

  // Discord ID to entity mapping (scoped, multiple entities per target).
  // Invariant: for 'channel' and 'guild' types, discord_id IS the scope, so
  // scope_channel_id / scope_guild_id must be NULL. Only 'user' bindings use
  // them (channel-scoped persona, guild-scoped persona, global persona).
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('user', 'channel', 'guild')),
      scope_guild_id TEXT,
      scope_channel_id TEXT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id),
      CHECK (
        discord_type = 'user'
        OR (scope_channel_id IS NULL AND scope_guild_id IS NULL)
      )
    )
  `);

  // Fact embeddings for semantic search
  if (useVec0) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings USING vec0(
        fact_id INTEGER PRIMARY KEY,
        embedding FLOAT[384]
      )
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fact_embeddings (
        fact_id INTEGER PRIMARY KEY,
        embedding BLOB
      )
    `);
  }

  // Message history per channel (simple buffer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      discord_message_id TEXT,
      data TEXT,
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
  if (useVec0) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
        memory_id INTEGER PRIMARY KEY,
        embedding FLOAT[384]
      )
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id INTEGER PRIMARY KEY,
        embedding BLOB
      )
    `);
  }

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
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
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
      notify_count INTEGER NOT NULL DEFAULT 0,
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

  // Discord config - per-channel/guild bind permission settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_config (
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('channel', 'guild')),
      config_bind TEXT,
      config_persona TEXT,
      config_blacklist TEXT,
      config_chain_limit INTEGER,
      config_rate_channel_per_min INTEGER,
      config_rate_owner_per_min INTEGER,
      PRIMARY KEY (discord_id, discord_type)
    )
  `);

  // Models known to not support tool calls - auto-detected, persisted to avoid repeated failures
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_no_tools (
      model_spec TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Attachment cache - fetched Discord attachment bytes, keyed by URL hash
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachment_cache (
      url_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      data BLOB NOT NULL,
      content_type TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      message_id TEXT
    )
  `);

  // Discord channel metadata - name/display info cached from Discord API
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_channel_meta (
      channel_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_dm INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Web channels - synthetic channel sessions for the web frontend
  // entity_ids is a JSON array of bound entity IDs
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_channels (
      id TEXT PRIMARY KEY,
      name TEXT,
      entity_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      config_chain_limit INTEGER,
      config_rate_channel_per_min INTEGER
    )
  `);

  // Entity events - append-only log for rate-limit sliding window and audit
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      owner_id TEXT,
      channel_id TEXT NOT NULL,
      guild_id TEXT,
      trigger_type TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Entity mutes - scope-based response suppression (owner, entity, channel, guild)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_mutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('entity', 'owner', 'channel', 'guild')),
      scope_id TEXT NOT NULL,
      guild_id TEXT,
      channel_id TEXT,
      expires_at TEXT,
      created_by TEXT NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Mod events - audit log for moderator actions and system enforcement
  db.exec(`
    CREATE TABLE IF NOT EXISTS mod_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      target_type TEXT,
      target_id TEXT,
      channel_id TEXT,
      guild_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discord_entities_lookup ON discord_entities(discord_id, discord_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC)`);
  // Partial unique index: prevents duplicate storage of the same Discord message.
  // NULL discord_message_id (synthetic messages) are excluded — SQLite NULL != NULL.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_discord_id ON messages(discord_message_id) WHERE discord_message_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_entity ON effects(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_expires ON effects(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity ON entity_memories(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_frecency ON entity_memories(entity_id, frecency DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON webhooks(channel_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_errors_owner ON eval_errors(owner_id, notified_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_attachment_cache_message ON attachment_cache(message_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_events_channel_time ON entity_events(channel_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_events_owner_time ON entity_events(owner_id, guild_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_events_entity_time ON entity_events(entity_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_mutes_lookup ON entity_mutes(scope_type, scope_id, guild_id, channel_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_mutes_expires ON entity_mutes(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_events_time ON mod_events(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_events_guild_time ON mod_events(guild_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_events_target ON mod_events(target_type, target_id)`);
}
