/**
 * API route tests.
 *
 * Uses mock.module to inject an in-memory DB (same pattern as existing DB tests).
 * Tests route handlers directly without a real HTTP server.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { load } from "sqlite-vec";

// =============================================================================
// In-memory DB + embedding mocks (must come before any DB imports)
// =============================================================================

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const MOCK_DIM = 384;
const mockEmbedding = new Float32Array(MOCK_DIM).fill(1 / Math.sqrt(MOCK_DIM));

mock.module("../ai/embeddings", () => ({
  embed: async (_text: string): Promise<Float32Array> => mockEmbedding,
  similarityMatrix: (_queries: Float32Array[], targets: Float32Array[]) =>
    new Float32Array(_queries.length * targets.length).fill(1),
  isEmbeddingModelLoaded: () => false,
  MODEL_NAME: "mock-model",
  EMBEDDING_DIMENSIONS: MOCK_DIM,
  getEmbeddingCacheStats: () => ({ size: 0, max: 10, ttl: 60000 }),
  cosineSimilarity: (_a: Float32Array, _b: Float32Array) => 1,
}));

// =============================================================================
// Imports (after mocks)
// =============================================================================

import { entityRoutes } from "./routes/entities";
import { chatRoutes } from "./routes/chat";
import { debugRoutes } from "./routes/debug";

// =============================================================================
// Test schema + helpers
// =============================================================================

function createTestSchema(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owned_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      template TEXT,
      system_template TEXT,
      config_context TEXT, config_model TEXT, config_respond TEXT,
      config_stream_mode TEXT, config_stream_delimiters TEXT,
      config_avatar TEXT, config_memory TEXT, config_freeform INTEGER DEFAULT 0,
      config_strip TEXT, config_view TEXT, config_edit TEXT, config_use TEXT,
      config_blacklist TEXT, config_thinking TEXT, config_collapse TEXT, config_keywords TEXT, config_safety TEXT
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
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
      memory_id INTEGER PRIMARY KEY,
      embedding FLOAT[384]
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_channels (
      id TEXT PRIMARY KEY,
      name TEXT,
      entity_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL,
      scope_guild_id TEXT,
      scope_channel_id TEXT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
    )
  `);
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_forgets (
      channel_id TEXT PRIMARY KEY,
      forget_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_messages (
      message_id TEXT PRIMARY KEY,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      entity_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings USING vec0(
      fact_id INTEGER PRIMARY KEY,
      embedding FLOAT[384]
    )
  `);
}

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.exec("PRAGMA journal_mode = WAL");
  load(testDb);
  createTestSchema(testDb);
});

import type { RouteHandler } from "./helpers";

/** Call a route handler with a fake Request; return the Response. */
async function callRoute(
  handler: RouteHandler,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(`http://localhost${path}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const req = new Request(url.toString(), init);
  const res = await handler(req, url);
  // Route returns null when it doesn't match — convert to 404
  return res ?? Response.json({ ok: false, error: "Not found" }, { status: 404 });
}

async function json<T>(handler: RouteHandler, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await callRoute(handler, method, path, body);
  return { status: res.status, body: (await res.json()) as T };
}

// =============================================================================
// Entity routes
// =============================================================================

describe("entityRoutes — CRUD", () => {
  test("POST /api/entities creates entity", async () => {
    const { status, body } = await json<{ ok: boolean; data: { id: number; name: string } }>(
      entityRoutes, "POST", "/api/entities", { name: "Aria" }
    );
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("Aria");
    expect(typeof body.data.id).toBe("number");
  });

  test("POST /api/entities rejects empty name", async () => {
    const { status, body } = await json<{ ok: boolean }>(
      entityRoutes, "POST", "/api/entities", { name: "" }
    );
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  test("POST /api/entities rejects missing name", async () => {
    const { status, body } = await json<{ ok: boolean }>(
      entityRoutes, "POST", "/api/entities", {}
    );
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  test("GET /api/entities returns list", async () => {
    // Create one first
    await callRoute(entityRoutes, "POST", "/api/entities", { name: "Bob" });
    const { status, body } = await json<{ ok: boolean; data: unknown[] }>(
      entityRoutes, "GET", "/api/entities"
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/entities?q= filters by name", async () => {
    await callRoute(entityRoutes, "POST", "/api/entities", { name: "SearchMe" });
    await callRoute(entityRoutes, "POST", "/api/entities", { name: "OtherName" });
    const { body } = await json<{ ok: boolean; data: { name: string }[] }>(
      entityRoutes, "GET", "/api/entities?q=Search"
    );
    expect(body.data.every(e => e.name.toLowerCase().includes("search"))).toBe(true);
  });

  test("GET /api/entities/:id returns entity with facts", async () => {
    const create = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "WithFacts" }
    );
    const id = create.body.data.id;
    const { status, body } = await json<{ ok: boolean; data: { facts: unknown[] } }>(
      entityRoutes, "GET", `/api/entities/${id}`
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data.facts)).toBe(true);
  });

  test("GET /api/entities/:id returns 404 for unknown id", async () => {
    const { status } = await json(entityRoutes, "GET", "/api/entities/99999");
    expect(status).toBe(404);
  });

  test("PUT /api/entities/:id renames entity", async () => {
    const { body: c } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "OldName" }
    );
    const id = c.data.id;
    const { status, body } = await json<{ ok: boolean; data: { name: string } }>(
      entityRoutes, "PUT", `/api/entities/${id}`, { name: "NewName" }
    );
    expect(status).toBe(200);
    expect(body.data.name).toBe("NewName");
  });

  test("DELETE /api/entities/:id removes entity", async () => {
    const { body: c } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "ToDelete" }
    );
    const id = c.data.id;
    const { status, body } = await json<{ ok: boolean; data: { deleted: boolean } }>(
      entityRoutes, "DELETE", `/api/entities/${id}`
    );
    expect(status).toBe(200);
    expect(body.data.deleted).toBe(true);
    // Confirm gone
    const { status: s2 } = await json(entityRoutes, "GET", `/api/entities/${id}`);
    expect(s2).toBe(404);
  });
});

describe("entityRoutes — facts", () => {
  let entityId: number;

  beforeEach(async () => {
    const { body } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "FactHost" }
    );
    entityId = body.data.id;
  });

  test("POST /api/entities/:id/facts adds a fact", async () => {
    const { status, body } = await json<{ ok: boolean; data: { id: number; content: string } }>(
      entityRoutes, "POST", `/api/entities/${entityId}/facts`, { content: "is brave" }
    );
    expect(status).toBe(201);
    expect(body.data.content).toBe("is brave");
  });

  test("POST /api/entities/:id/facts rejects empty content", async () => {
    const { status } = await json(entityRoutes, "POST", `/api/entities/${entityId}/facts`, { content: "" });
    expect(status).toBe(400);
  });

  test("GET /api/entities/:id/facts lists facts", async () => {
    await callRoute(entityRoutes, "POST", `/api/entities/${entityId}/facts`, { content: "fact one" });
    await callRoute(entityRoutes, "POST", `/api/entities/${entityId}/facts`, { content: "fact two" });
    const { status, body } = await json<{ ok: boolean; data: { content: string }[] }>(
      entityRoutes, "GET", `/api/entities/${entityId}/facts`
    );
    expect(status).toBe(200);
    expect(body.data.some(f => f.content === "fact one")).toBe(true);
    expect(body.data.some(f => f.content === "fact two")).toBe(true);
  });

  test("PUT /api/entities/:id/facts/:fid updates a fact", async () => {
    const { body: c } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", `/api/entities/${entityId}/facts`, { content: "old content" }
    );
    const factId = c.data.id;
    const { status, body } = await json<{ ok: boolean; data: { content: string } }>(
      entityRoutes, "PUT", `/api/entities/${entityId}/facts/${factId}`, { content: "new content" }
    );
    expect(status).toBe(200);
    expect(body.data.content).toBe("new content");
  });

  test("DELETE /api/entities/:id/facts/:fid removes a fact", async () => {
    const { body: c } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", `/api/entities/${entityId}/facts`, { content: "temp fact" }
    );
    const factId = c.data.id;
    const { status, body } = await json<{ ok: boolean; data: { deleted: boolean } }>(
      entityRoutes, "DELETE", `/api/entities/${entityId}/facts/${factId}`
    );
    expect(status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });
});

describe("entityRoutes — config", () => {
  let entityId: number;

  beforeEach(async () => {
    const { body } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "ConfigEntity" }
    );
    entityId = body.data.id;
  });

  test("GET /api/entities/:id/config returns config", async () => {
    const { status, body } = await json<{ ok: boolean; data: { config_model: string | null } }>(
      entityRoutes, "GET", `/api/entities/${entityId}/config`
    );
    expect(status).toBe(200);
    expect("config_model" in body.data).toBe(true);
  });

  test("PATCH /api/entities/:id/config updates model", async () => {
    const { status, body } = await json<{ ok: boolean; data: { config_model: string | null } }>(
      entityRoutes, "PATCH", `/api/entities/${entityId}/config`, { config_model: "anthropic:claude-4" }
    );
    expect(status).toBe(200);
    expect(body.data.config_model).toBe("anthropic:claude-4");
  });
});

describe("entityRoutes — templates", () => {
  let entityId: number;

  beforeEach(async () => {
    const { body } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "TplEntity" }
    );
    entityId = body.data.id;
  });

  test("GET template returns null by default", async () => {
    const { status, body } = await json<{ ok: boolean; data: { template: null } }>(
      entityRoutes, "GET", `/api/entities/${entityId}/template`
    );
    expect(status).toBe(200);
    expect(body.data.template).toBeNull();
  });

  test("PUT template sets and retrieves template", async () => {
    const { status, body } = await json<{ ok: boolean; data: { template: string } }>(
      entityRoutes, "PUT", `/api/entities/${entityId}/template`, { template: "Hello {{char}}" }
    );
    expect(status).toBe(200);
    expect(body.data.template).toBe("Hello {{char}}");
  });

  test("PUT system-template sets and retrieves system template", async () => {
    const { status, body } = await json<{ ok: boolean; data: { system_template: string } }>(
      entityRoutes, "PUT", `/api/entities/${entityId}/system-template`, { system_template: "You are {{char}}" }
    );
    expect(status).toBe(200);
    expect(body.data.system_template).toBe("You are {{char}}");
  });
});

// =============================================================================
// Chat routes
// =============================================================================

describe("chatRoutes — channels", () => {
  test("POST /api/channels creates a channel", async () => {
    const { status, body } = await json<{ ok: boolean; data: { id: string; entity_ids: number[] } }>(
      chatRoutes, "POST", "/api/channels", { name: "My Channel", entity_ids: [] }
    );
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toMatch(/^web:/);
    expect(body.data.entity_ids).toEqual([]);
  });

  test("POST /api/channels rejects missing entity_ids", async () => {
    const { status } = await json(chatRoutes, "POST", "/api/channels", { name: "bad" });
    expect(status).toBe(400);
  });

  test("GET /api/channels lists channels", async () => {
    await callRoute(chatRoutes, "POST", "/api/channels", { entity_ids: [] });
    const { status, body } = await json<{ ok: boolean; data: unknown[] }>(
      chatRoutes, "GET", "/api/channels"
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("PATCH /api/channels/:id updates channel name", async () => {
    const { body: c } = await json<{ ok: boolean; data: { id: string } }>(
      chatRoutes, "POST", "/api/channels", { entity_ids: [] }
    );
    const channelId = c.data.id;

    const { status, body } = await json<{ ok: boolean; data: { name: string | null } }>(
      chatRoutes, "PATCH", `/api/channels/${channelId}`, { name: "Renamed" }
    );
    expect(status).toBe(200);
    expect(body.data.name).toBe("Renamed");
  });

  test("DELETE /api/channels/:id deletes channel", async () => {
    const { body: c } = await json<{ ok: boolean; data: { id: string } }>(
      chatRoutes, "POST", "/api/channels", { entity_ids: [] }
    );
    const channelId = c.data.id;

    const { status, body } = await json<{ ok: boolean; data: { deleted: boolean } }>(
      chatRoutes, "DELETE", `/api/channels/${channelId}`
    );
    expect(status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  test("DELETE /api/channels/:id returns 404 for unknown channel", async () => {
    const { status } = await json(
      chatRoutes, "DELETE", `/api/channels/${encodeURIComponent("web:no-such-channel")}`
    );
    expect(status).toBe(404);
  });
});

describe("chatRoutes — messages", () => {
  let channelId: string;

  beforeEach(async () => {
    const { body } = await json<{ ok: boolean; data: { id: string } }>(
      chatRoutes, "POST", "/api/channels", { entity_ids: [] }
    );
    channelId = body.data.id;
  });

  test("GET /api/channels/:id/messages returns empty list", async () => {
    const { status, body } = await json<{ ok: boolean; data: unknown[] }>(
      chatRoutes, "GET", `/api/channels/${channelId}/messages`
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);
  });

  test("POST /api/channels/:id/messages stores message", async () => {
    const { status, body } = await json<{ ok: boolean; data: { message: { content: string } } }>(
      chatRoutes, "POST", `/api/channels/${channelId}/messages`,
      { content: "hello world", author_name: "Alice" }
    );
    expect(status).toBe(201);
    expect(body.data.message.content).toBe("hello world");
  });

  test("POST /api/channels/:id/messages rejects empty content", async () => {
    const { status } = await json(
      chatRoutes, "POST", `/api/channels/${channelId}/messages`,
      { content: "" }
    );
    expect(status).toBe(400);
  });

  test("messages appear in subsequent GET", async () => {
    await callRoute(chatRoutes, "POST", `/api/channels/${channelId}/messages`, {
      content: "stored msg",
    });
    const { body } = await json<{ ok: boolean; data: { content: string }[] }>(
      chatRoutes, "GET", `/api/channels/${channelId}/messages`
    );
    expect(body.data.some(m => m.content === "stored msg")).toBe(true);
  });
});

// =============================================================================
// Debug routes
// =============================================================================

describe("debugRoutes", () => {
  test("GET /api/debug/bindings returns binding graph", async () => {
    const { status, body } = await json<{ ok: boolean; data: { bindings: unknown[]; total: number } }>(
      debugRoutes, "GET", "/api/debug/bindings"
    );
    expect(status).toBe(200);
    expect(typeof body.data.total).toBe("number");
    expect(Array.isArray(body.data.bindings)).toBe(true);
  });

  test("GET /api/debug/errors returns error list", async () => {
    const { status, body } = await json<{ ok: boolean; data: unknown[] }>(
      debugRoutes, "GET", "/api/debug/errors"
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /api/debug/embedding-status returns status", async () => {
    const { status, body } = await json<{ ok: boolean; data: { loaded: boolean } }>(
      debugRoutes, "GET", "/api/debug/embedding-status"
    );
    expect(status).toBe(200);
    expect(typeof body.data.loaded).toBe("boolean");
  });

  test("GET /api/debug/embeddings requires entity param", async () => {
    const { status } = await json(debugRoutes, "GET", "/api/debug/embeddings");
    expect(status).toBe(400);
  });

  test("GET /api/debug/trace/:entityId returns trace", async () => {
    // Create an entity
    const { body: c } = await json<{ ok: boolean; data: { id: number } }>(
      entityRoutes, "POST", "/api/entities", { name: "TraceTarget" }
    );
    const entityId = c.data.id;

    const { status, body } = await json<{ ok: boolean }>(
      debugRoutes, "GET", `/api/debug/trace/${entityId}?channel=web:test`
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("GET /api/debug/simulate/:channelId returns simulation", async () => {
    const { status, body } = await json<{ ok: boolean; data: unknown[] }>(
      debugRoutes, "GET", `/api/debug/simulate/${encodeURIComponent("web:sim-channel")}`
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // non-GET methods pass through
  test("POST to debug route returns null (not handled)", async () => {
    const res = await callRoute(debugRoutes, "POST", "/api/debug/bindings");
    // null → 404 in our wrapper
    expect(res.status).toBe(404);
  });
});
