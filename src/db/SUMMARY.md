# src/db/

Database layer. Owns the SQLite schema (via `bun:sqlite` + `sqlite-vec`) and all persistence operations. No Discord or LLM logic here — pure data access.

## Key Files

- `index.ts` — `getDb()` / `closeDb()`. Opens `hologram.db` with WAL mode and foreign keys enabled, loads the `sqlite-vec` extension, and runs `initSchema()` from `schema.ts` to create all tables on first run. The singleton `Database` instance is shared across all modules. Re-exports `initSchema` for external consumers.
- `schema.ts` — `initSchema(db, { useVec0? })`. Contains all CREATE TABLE / CREATE INDEX / ALTER TABLE migration statements. Extracted from `index.ts` so tests can import it directly without triggering `mock.module` conflicts. The `useVec0` option controls whether embedding tables use `sqlite-vec` virtual tables or plain BLOB fallbacks.
- `test-utils.ts` — `createTestDb({ useVec0? })`. Creates an in-memory SQLite database with the full production schema for tests. All test files import this instead of duplicating CREATE TABLE statements.
- `entities.ts` — Entity and fact CRUD: `createEntity`, `getEntity`, `updateEntity`, `deleteEntity`, `transferOwnership`, `addFact`, `updateFactByContent`, `removeFactByContent`, `setFacts`, `searchEntities`. Also exposes `getEntityConfig`/`setEntityConfig`, per-entity eval defaults (`getEntityEvalDefaults`), `getEntityKeywords` (parses `config_keywords` into a string array for trigger keyword matching), and `safeParseFallback` (safe `JSON.parse` with a fallback, used throughout for corrupted DB data).
- `discord.ts` — Discord ID → entity bindings, message history, and config storage. `resolveDiscordEntity` (scope-priority resolution: channel > guild > global), `addDiscordEntity`, `removeDiscordEntityBinding`, `addMessage`, `updateMessageByDiscordId`, `mergeMessageData`, `trackWebhookMessage`, `getMessages`, `formatMessagesForContext`, `recordEvalError`, `setChannelForgetTime`, `resolveDiscordConfig` (field-level precedence — NULL channel values fall through to guild), `resolveChainLimit`. Includes an in-memory persona cache invalidated on binding mutations.
- `memories.ts` — LLM-curated long-term memory with frecency ranking + vector similarity retrieval. `addMemory`, `updateMemoryByContent`, `removeMemoryByContent`, `retrieveRelevantMemories` (two-level cache: embeddings per entity, similarity scores per message). Threshold: cosine ≥ 0.2.
- `effects.ts` — Temporary fact overlays that expire after a duration. `addEffect`, `getActiveEffects`, `getActiveEffectFacts` (merged with entity facts at evaluation time).
- `attachment-cache.ts` — SHA-256-keyed persistent cache for fetched attachment bytes (`getCachedAttachment`, `setCachedAttachment`). Used by `src/ai/attachments.ts` to avoid re-fetching Discord CDN images.
- `moderation.ts` — Rate-limit sliding-window queries and mute/audit persistence. `recordEntityEvent`, `countEntityEvents`/`countOwnerEvents`/`countChannelEvents` (sliding-window over `entity_events`), `addMute`, `removeMute`, `getMute`, `listActiveMutes`, `isMuted` (scope-aware: entity/owner/channel/guild with channel→guild→global matching), `gcOldEvents`/`gcExpiredMutes`, `recordModEvent`, `getModEvents`.

## Schema (13 core tables + 3 moderation tables)

`entities`, `facts`, `discord_entities`, `discord_config`, `messages`, `welcomed_users`, `webhook_messages`, `eval_errors`, `attachment_cache`, `entity_events` (rate-limit log), `entity_mutes` (scope-based suppression), `mod_events` (audit log) (+ `fact_embeddings`, `memory_embeddings` via sqlite-vec).

## Notes

- All `JSON.parse` calls on config columns use `safeParseFallback` to prevent crashes from corrupted data.
- `sqlite-vec` BLOB values arrive as `Uint8Array`; convert with `new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)` before arithmetic.
