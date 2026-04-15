/**
 * Unit tests for pure helper functions in the commands module.
 *
 * Tests are split across two groups:
 * 1. Pure helpers (helpers.ts) — no DB needed, no Discord dependency
 * 2. Permission check logic — tested directly via expr.ts + DB-backed entities.ts
 *    (mirrors the logic in canUserEdit / canUserView / canUserUse / canUserBindInLocation)
 *
 * Note: commands.ts itself cannot be imported in tests because it transitively
 * imports ../client which calls createBot() and checks DISCORD_TOKEN at module
 * load time. Pure functions are extracted to helpers.ts for testability.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// =============================================================================
// In-memory DB mock — must be set up before any DB-backed imports
// =============================================================================

let testDb: Database;

mock.module("../../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// =============================================================================
// Pure helper functions — import directly, no mocking needed
// =============================================================================

import {
  chunkContent,
  elideText,
  buildDefaultValues,
  buildEntries,
} from "./helpers";

// =============================================================================
// Permission logic — import from underlying modules, not commands.ts
// (commands.ts can't be imported in tests due to circular dep via ../client)
// =============================================================================

import {
  parsePermissionDirectives,
  matchesUserEntry,
  isUserBlacklisted,
  isUserAllowed,
} from "../../logic/expr";
import {
  createEntity,
  setEntityConfig,
  getPermissionDefaults,
} from "../../db/entities";
import {
  setDiscordConfig,
  resolveDiscordConfig,
} from "../../db/discord";

// =============================================================================
// Schema setup
// =============================================================================

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
      config_keywords TEXT,
      config_safety TEXT
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
    CREATE TABLE IF NOT EXISTS discord_config (
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('channel', 'guild')),
      config_bind TEXT,
      config_persona TEXT,
      config_blacklist TEXT,
      PRIMARY KEY (discord_id, discord_type)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_entity ON effects(entity_id)`);
}

// =============================================================================
// Helpers for permission tests — mirrors canUserEdit/View/Use logic
// =============================================================================

function checkCanEdit(entityId: number, ownedBy: string | null, facts: string[], userId: string, username: string, userRoles: string[] = []): boolean {
  if (ownedBy === userId) return true;
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entityId));
  if (isUserBlacklisted(permissions, userId, username, ownedBy, userRoles)) return false;
  if (permissions.editList === "@everyone") return true;
  if (permissions.editList && permissions.editList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;
  return false;
}

function checkCanView(entityId: number, ownedBy: string | null, facts: string[], userId: string, username: string, userRoles: string[] = []): boolean {
  if (ownedBy === userId) return true;
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entityId));
  if (isUserBlacklisted(permissions, userId, username, ownedBy, userRoles)) return false;
  if (permissions.viewList === null) return false;
  if (permissions.viewList === "@everyone") return true;
  if (permissions.viewList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;
  return false;
}

function checkCanUse(entityId: number, ownedBy: string | null, facts: string[], userId: string, username: string, userRoles: string[] = []): boolean {
  if (ownedBy === userId) return true;
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entityId));
  if (isUserBlacklisted(permissions, userId, username, ownedBy, userRoles)) return false;
  return isUserAllowed(permissions, userId, username, ownedBy, userRoles);
}

function checkCanBind(userId: string, username: string, userRoles: string[], channelId?: string, guildId?: string): boolean {
  const config = resolveDiscordConfig(channelId, guildId);
  if (config.blacklist?.some(entry => matchesUserEntry(entry, userId, username, userRoles))) return false;
  if (!config.bind) return true;
  return config.bind.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}

function checkCanPersona(userId: string, username: string, userRoles: string[], channelId?: string, guildId?: string): boolean {
  const config = resolveDiscordConfig(channelId, guildId);
  if (config.blacklist?.some(entry => matchesUserEntry(entry, userId, username, userRoles))) return false;
  if (!config.persona) return true;
  return config.persona.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}

// Realistic Discord snowflake IDs for tests
const OWNER_ID = "123456789012345678";
const OTHER_ID = "234567890123456789";
const ROLE_ID = "111111111111111111";
const ROLE_ID_2 = "999999999999999999";
const CHANNEL_ID = "345678901234567890";
const GUILD_ID = "456789012345678901";

// =============================================================================
// chunkContent
// =============================================================================

describe("chunkContent", () => {
  test("returns single chunk when content fits", () => {
    expect(chunkContent("hello world", 100)).toEqual(["hello world"]);
  });

  test("splits at newline when possible", () => {
    const content = "line one\nline two\nline three";
    const chunks = chunkContent(content, 10);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    expect(chunks.join("\n")).toBe(content);
  });

  test("hard splits without dropping characters when no newline available", () => {
    const content = "abcdefghij"; // 10 chars, no newlines
    const chunks = chunkContent(content, 5);
    expect(chunks).toEqual(["abcde", "fghij"]);
  });

  test("returns empty array for empty string", () => {
    expect(chunkContent("", 100)).toEqual([]);
  });

  test("handles exact-length content without splitting", () => {
    expect(chunkContent("hello", 5)).toEqual(["hello"]);
  });

  test("each chunk fits within maxLen when splitting at newlines", () => {
    const content = "aaaa\nbbbb\ncccc";
    const chunks = chunkContent(content, 6);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(6);
    }
  });

  test("reconstructs original content correctly for newline splits", () => {
    const content = "hello\nworld\nfoo";
    const chunks = chunkContent(content, 7);
    expect(chunks.join("\n")).toBe(content);
  });

  test("reconstructs full content for hard splits", () => {
    const content = "abcdefghijklmnopqrst"; // 20 chars, no newlines
    const chunks = chunkContent(content, 7);
    expect(chunks.join("")).toBe(content);
  });
});

// =============================================================================
// elideText
// =============================================================================

describe("elideText", () => {
  test("returns text unchanged when within limit", () => {
    const text = "short text";
    expect(elideText(text, 100)).toBe(text);
  });

  test("returns text unchanged at exact limit", () => {
    const text = "a".repeat(100);
    expect(elideText(text, 100)).toBe(text);
  });

  test("elides text that exceeds limit", () => {
    const text = "a".repeat(500);
    const result = elideText(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("... (elided) ...");
  });

  test("keeps beginning and end of elided text", () => {
    const text = "START" + "x".repeat(1000) + "END";
    const result = elideText(text, 100);
    expect(result.startsWith("START")).toBe(true);
    expect(result.endsWith("END")).toBe(true);
  });

  test("uses default max of 8000 chars", () => {
    const shortText = "a".repeat(7999);
    expect(elideText(shortText)).toBe(shortText);
    const longText = "a".repeat(8001);
    expect(elideText(longText)).toContain("... (elided) ...");
  });
});

// =============================================================================
// buildDefaultValues
// =============================================================================

describe("buildDefaultValues", () => {
  test("returns empty array for null", () => {
    expect(buildDefaultValues(null)).toEqual([]);
  });

  test("returns empty array for @everyone", () => {
    expect(buildDefaultValues("@everyone")).toEqual([]);
  });

  test("returns empty array for empty array", () => {
    expect(buildDefaultValues([])).toEqual([]);
  });

  test("maps role: prefixed entries to role type", () => {
    const result = buildDefaultValues(["role:123456789012345678"]);
    expect(result).toEqual([{ id: "123456789012345678", type: "role" }]);
  });

  test("maps snowflake IDs (17-19 digits) to user type", () => {
    const result = buildDefaultValues(["123456789012345678"]);
    expect(result).toEqual([{ id: "123456789012345678", type: "user" }]);
  });

  test("skips username strings — cannot pre-populate in select", () => {
    const result = buildDefaultValues(["alice", "bob"]);
    expect(result).toEqual([]);
  });

  test("handles mixed entries: role, user, and username", () => {
    const result = buildDefaultValues([
      "role:111111111111111111",
      "222222222222222222",
      "someusername",
    ]);
    expect(result).toEqual([
      { id: "111111111111111111", type: "role" },
      { id: "222222222222222222", type: "user" },
    ]);
  });

  test("handles 17-digit snowflakes", () => {
    expect(buildDefaultValues(["12345678901234567"])).toEqual([
      { id: "12345678901234567", type: "user" },
    ]);
  });

  test("handles 19-digit snowflakes", () => {
    expect(buildDefaultValues(["1234567890123456789"])).toEqual([
      { id: "1234567890123456789", type: "user" },
    ]);
  });

  test("16-digit ID is not a valid snowflake — treated as username and skipped", () => {
    expect(buildDefaultValues(["1234567890123456"])).toEqual([]);
  });
});

// =============================================================================
// buildEntries — security-critical role detection
// =============================================================================

describe("buildEntries", () => {
  function makeResolved(roles: string[] = [], users: string[] = []) {
    const roleSet = new Set(roles.map(id => BigInt(id)));
    const userSet = new Set(users.map(id => BigInt(id)));
    return {
      roles: { has: (id: bigint) => roleSet.has(id) },
      users: { has: (id: bigint) => userSet.has(id) },
    };
  }

  test("ID found in resolved.roles gets role: prefix", () => {
    const resolved = makeResolved(["111111111111111111"], []);
    expect(buildEntries(["111111111111111111"], resolved)).toEqual(["role:111111111111111111"]);
  });

  test("ID found in resolved.users gets no prefix", () => {
    const resolved = makeResolved([], ["222222222222222222"]);
    expect(buildEntries(["222222222222222222"], resolved)).toEqual(["222222222222222222"]);
  });

  test("ID in neither resolved.roles nor resolved.users is dropped (security fix)", () => {
    const resolved = makeResolved([], []);
    expect(buildEntries(["333333333333333333"], resolved)).toEqual([]);
  });

  test("undefined resolved drops all IDs (security fix)", () => {
    expect(buildEntries(["444444444444444444", "555555555555555555"], undefined)).toEqual([]);
  });

  test("handles empty values array", () => {
    const resolved = makeResolved(["111111111111111111"], ["222222222222222222"]);
    expect(buildEntries([], resolved)).toEqual([]);
  });

  test("handles mixed: roles, users, and unknown IDs in one call", () => {
    const resolved = makeResolved(
      ["111111111111111111"],
      ["222222222222222222"],
    );
    const result = buildEntries(
      ["111111111111111111", "222222222222222222", "333333333333333333"],
      resolved,
    );
    expect(result).toEqual(["role:111111111111111111", "222222222222222222"]);
  });

  test("resolved with only roles map (no users property) — non-role IDs dropped", () => {
    const resolved = {
      roles: { has: (id: bigint) => id === BigInt("111111111111111111") },
    };
    const result = buildEntries(["111111111111111111", "222222222222222222"], resolved);
    expect(result).toEqual(["role:111111111111111111"]);
  });

  test("preserves order of valid entries", () => {
    const resolved = makeResolved(
      ["111111111111111111", "333333333333333333"],
      ["222222222222222222"],
    );
    const result = buildEntries(
      ["222222222222222222", "111111111111111111", "333333333333333333"],
      resolved,
    );
    expect(result).toEqual([
      "222222222222222222",
      "role:111111111111111111",
      "role:333333333333333333",
    ]);
  });
});

// =============================================================================
// canUserEdit — permission logic (via DB)
// =============================================================================

describe("canUserEdit (permission logic)", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("owner always can edit", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    expect(checkCanEdit(entity.id, entity.owned_by, [], OWNER_ID, "ownerName")).toBe(true);
  });

  test("non-owner blocked when no editList set (owner-only default)", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("non-owner allowed when editList is @everyone", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_edit: JSON.stringify("@everyone") });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner allowed when their user ID (snowflake) is in editList", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_edit: JSON.stringify([OTHER_ID]) });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner allowed by username match (case-insensitive)", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_edit: JSON.stringify(["alice"]) });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "Alice")).toBe(true);
  });

  test("non-owner allowed by role match in editList", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_edit: JSON.stringify([`role:${ROLE_ID}`]) });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName", [ROLE_ID])).toBe(true);
  });

  test("blacklisted user (by snowflake ID) blocked even if editList is @everyone", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, {
      config_edit: JSON.stringify("@everyone"),
      config_blacklist: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("owner is never blocked even if their snowflake ID is in blacklist", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_blacklist: JSON.stringify([OWNER_ID]) });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OWNER_ID, "ownerName")).toBe(true);
  });

  test("user not in editList is denied", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_edit: JSON.stringify([OWNER_ID]) });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("blacklist role blocks user with that role", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, {
      config_edit: JSON.stringify("@everyone"),
      config_blacklist: JSON.stringify([`role:${ROLE_ID_2}`]),
    });
    expect(checkCanEdit(entity.id, entity.owned_by, [], OTHER_ID, "otherName", [ROLE_ID_2])).toBe(false);
  });
});

// =============================================================================
// canUserView — permission logic (via DB)
// =============================================================================

describe("canUserView (permission logic)", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("owner always can view", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    expect(checkCanView(entity.id, entity.owned_by, [], OWNER_ID, "ownerName")).toBe(true);
  });

  test("non-owner blocked when viewList is null (owner-only default)", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    expect(checkCanView(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("non-owner allowed when viewList is @everyone", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_view: JSON.stringify("@everyone") });
    expect(checkCanView(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner allowed when their user ID (snowflake) is in viewList", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_view: JSON.stringify([OTHER_ID]) });
    expect(checkCanView(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner allowed by role in viewList", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_view: JSON.stringify([`role:${ROLE_ID}`]) });
    expect(checkCanView(entity.id, entity.owned_by, [], OTHER_ID, "otherName", [ROLE_ID])).toBe(true);
  });

  test("blacklisted user (by snowflake ID) blocked even if viewList is @everyone", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, {
      config_view: JSON.stringify("@everyone"),
      config_blacklist: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanView(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("user not in viewList is denied", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_view: JSON.stringify([OWNER_ID]) });
    expect(checkCanView(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });
});

// =============================================================================
// canUserUse — persona/trigger permission logic (via DB)
// =============================================================================

describe("canUserUse (permission logic)", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("owner always can use", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    expect(checkCanUse(entity.id, entity.owned_by, [], OWNER_ID, "ownerName")).toBe(true);
  });

  test("non-owner allowed when useList is null (no restriction, default)", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    expect(checkCanUse(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner allowed when useList is @everyone", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_use: JSON.stringify("@everyone") });
    expect(checkCanUse(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner allowed when their snowflake ID is in useList", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_use: JSON.stringify([OTHER_ID]) });
    expect(checkCanUse(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(true);
  });

  test("non-owner blocked when useList restricts and they are not in it", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_use: JSON.stringify([OWNER_ID]) });
    expect(checkCanUse(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("blacklisted user (by snowflake ID) blocked even if useList is null", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_blacklist: JSON.stringify([OTHER_ID]) });
    expect(checkCanUse(entity.id, entity.owned_by, [], OTHER_ID, "otherName")).toBe(false);
  });

  test("non-owner allowed by role in useList", () => {
    const entity = createEntity("TestEntity", OWNER_ID);
    setEntityConfig(entity.id, { config_use: JSON.stringify([`role:${ROLE_ID}`]) });
    expect(checkCanUse(entity.id, entity.owned_by, [], OTHER_ID, "otherName", [ROLE_ID])).toBe(true);
  });
});

// =============================================================================
// canUserBindInLocation — server-side bind permission logic (via DB)
// =============================================================================

describe("canUserBindInLocation (permission logic)", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("allows everyone when no config exists", () => {
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID, GUILD_ID)).toBe(true);
  });

  test("allows user explicitly in bind allowlist by snowflake ID", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_bind: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(true);
  });

  test("blocks user not in bind allowlist when allowlist is set", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_bind: JSON.stringify([OWNER_ID]),
    });
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(false);
  });

  test("allows everyone when bind config is null (no restriction)", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_bind: null,
    });
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(true);
  });

  test("blocks user in blacklist regardless of bind allowlist", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_bind: JSON.stringify([OTHER_ID]),
      config_blacklist: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(false);
  });

  test("allows user with matching role in bind allowlist", () => {
    setDiscordConfig(GUILD_ID, "guild", {
      config_bind: JSON.stringify([`role:${ROLE_ID}`]),
    });
    expect(checkCanBind(OTHER_ID, "otherName", [ROLE_ID], undefined, GUILD_ID)).toBe(true);
  });

  test("channel config takes precedence over guild config", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_bind: JSON.stringify([OTHER_ID]),
    });
    setDiscordConfig(GUILD_ID, "guild", {
      config_bind: JSON.stringify([OWNER_ID]),
    });
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID, GUILD_ID)).toBe(true);
  });

  test("guild config applies when no channel config row exists", () => {
    setDiscordConfig(GUILD_ID, "guild", {
      config_bind: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanBind(OWNER_ID, "ownerName", [], CHANNEL_ID, GUILD_ID)).toBe(false);
    expect(checkCanBind(OTHER_ID, "otherName", [], CHANNEL_ID, GUILD_ID)).toBe(true);
  });

  test("allows user by username match in bind allowlist (case-insensitive)", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_bind: JSON.stringify(["alice"]),
    });
    expect(checkCanBind(OTHER_ID, "Alice", [], CHANNEL_ID)).toBe(true);
  });
});

// =============================================================================
// canUserPersonaInLocation — server-side persona permission logic (via DB)
// =============================================================================

describe("canUserPersonaInLocation (permission logic)", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("allows everyone when no config exists", () => {
    expect(checkCanPersona(OTHER_ID, "otherName", [], CHANNEL_ID, GUILD_ID)).toBe(true);
  });

  test("allows user explicitly in persona allowlist by snowflake ID", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_persona: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanPersona(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(true);
  });

  test("blocks user not in persona allowlist when allowlist is set", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_persona: JSON.stringify([OWNER_ID]),
    });
    expect(checkCanPersona(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(false);
  });

  test("blocks user in persona blacklist (by snowflake ID)", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_persona: JSON.stringify([OTHER_ID]),
      config_blacklist: JSON.stringify([OTHER_ID]),
    });
    expect(checkCanPersona(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(false);
  });

  test("allows everyone when persona config is null (no restriction)", () => {
    setDiscordConfig(CHANNEL_ID, "channel", {
      config_persona: null,
    });
    expect(checkCanPersona(OTHER_ID, "otherName", [], CHANNEL_ID)).toBe(true);
  });

  test("allows user with matching role in persona allowlist", () => {
    setDiscordConfig(GUILD_ID, "guild", {
      config_persona: JSON.stringify([`role:${ROLE_ID_2}`]),
    });
    expect(checkCanPersona(OTHER_ID, "otherName", [ROLE_ID_2], undefined, GUILD_ID)).toBe(true);
  });
});
