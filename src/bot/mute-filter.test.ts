import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "../db/test-utils";
import type { EntityWithFacts } from "../db/entities";

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import { filterMutedEntities } from "./mute-filter";
import { addMute } from "../db/moderation";
import { createEntity } from "../db/entities";

beforeEach(() => {
  testDb = createTestDb();
});

// ── helpers ───────────────────────���───────────────────────���──────────────────

function makeEntityWithFacts(id: number, name = `entity-${id}`, owned_by: string | null = "owner1"): EntityWithFacts {
  return {
    id,
    name,
    owned_by,
    created_at: new Date().toISOString(),
    template: null,
    system_template: null,
    facts: [],
  };
}

// ── no mutes ──────────────────────────────────────────────────────────────────

describe("no mutes", () => {
  test("all entities are active when no mutes", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    const result = filterMutedEntities(
      [makeEntityWithFacts(a.id, "A", "u1"), makeEntityWithFacts(b.id, "B", "u2")],
      "ch1",
      "g1"
    );
    expect(result.active.length).toBe(2);
    expect(result.muted.length).toBe(0);
  });

  test("empty entity list returns empty result", () => {
    const result = filterMutedEntities([], "ch1", "g1");
    expect(result.active.length).toBe(0);
    expect(result.muted.length).toBe(0);
  });
});

// ── channel kill-switch ───────────────────────────────────────────────────────

describe("channel kill-switch", () => {
  test("muted channel silences all entities", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    addMute({ scope_type: "channel", scope_id: "ch1", guild_id: "g1", channel_id: "ch1", created_by: "mod1" });
    const result = filterMutedEntities(
      [makeEntityWithFacts(a.id, "A"), makeEntityWithFacts(b.id, "B")],
      "ch1",
      "g1"
    );
    expect(result.active.length).toBe(0);
    expect(result.muted.every(m => m.scope === "channel")).toBe(true);
  });

  test("different channel is not affected", () => {
    const a = createEntity("A", "u1");
    addMute({ scope_type: "channel", scope_id: "ch1", guild_id: "g1", channel_id: "ch1", created_by: "mod1" });
    const result = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch2", "g1");
    expect(result.active.length).toBe(1);
  });

  test("expired channel mute does not silence", () => {
    const a = createEntity("A", "u1");
    testDb.prepare(`
      INSERT INTO entity_mutes (scope_type, scope_id, guild_id, channel_id, expires_at, created_by)
      VALUES ('channel', 'ch1', 'g1', 'ch1', datetime('now', '-1 hour'), 'mod1')
    `).run();
    const result = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch1", "g1");
    expect(result.active.length).toBe(1);
  });
});

// ── guild kill-switch ─────────────────────────────────────────────────────────

describe("guild kill-switch", () => {
  test("muted guild silences all entities in any channel", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    addMute({ scope_type: "guild", scope_id: "g1", created_by: "mod1" });
    const result = filterMutedEntities(
      [makeEntityWithFacts(a.id, "A"), makeEntityWithFacts(b.id, "B")],
      "ch1",
      "g1"
    );
    expect(result.active.length).toBe(0);
    expect(result.muted.every(m => m.scope === "guild")).toBe(true);
  });

  test("different guild is not affected", () => {
    const a = createEntity("A", "u1");
    addMute({ scope_type: "guild", scope_id: "g1", created_by: "mod1" });
    const result = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch1", "g2");
    expect(result.active.length).toBe(1);
  });
});

// ── per-owner mute ────────────────────────────────────────────────────────────

describe("per-owner mute", () => {
  test("owner mute silences all entities by that owner", () => {
    const a = createEntity("A", "owner1");
    const b = createEntity("B", "owner1");
    const c = createEntity("C", "owner2");
    addMute({ scope_type: "owner", scope_id: "owner1", guild_id: "g1", created_by: "mod1" });
    const result = filterMutedEntities(
      [makeEntityWithFacts(a.id, "A", "owner1"), makeEntityWithFacts(b.id, "B", "owner1"), makeEntityWithFacts(c.id, "C", "owner2")],
      "ch1",
      "g1"
    );
    expect(result.active.length).toBe(1);
    expect(result.active[0]!.id).toBe(c.id);
    expect(result.muted.every(m => m.scope === "owner")).toBe(true);
  });

  test("entity without owner is not affected by owner mute", () => {
    const a = createEntity("A");
    addMute({ scope_type: "owner", scope_id: "owner1", created_by: "mod1" });
    const result = filterMutedEntities([makeEntityWithFacts(a.id, "A", null)], "ch1", "g1");
    expect(result.active.length).toBe(1);
  });
});

// ── per-entity mute ───────────────────────────────────────────────────────────

describe("per-entity mute", () => {
  test("entity mute silences only that entity", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    addMute({ scope_type: "entity", scope_id: String(a.id), created_by: "mod1" });
    const result = filterMutedEntities(
      [makeEntityWithFacts(a.id, "A"), makeEntityWithFacts(b.id, "B")],
      "ch1",
      "g1"
    );
    expect(result.active.length).toBe(1);
    expect(result.active[0]!.id).toBe(b.id);
    expect(result.muted[0]!.scope).toBe("entity");
  });

  test("entity mute with guild restriction only applies in that guild", () => {
    const a = createEntity("A", "u1");
    addMute({ scope_type: "entity", scope_id: String(a.id), guild_id: "g1", created_by: "mod1" });
    const resultG1 = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch1", "g1");
    const resultG2 = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch1", "g2");
    expect(resultG1.active.length).toBe(0);
    expect(resultG2.active.length).toBe(1);
  });

  test("expired entity mute is ignored", () => {
    const a = createEntity("A", "u1");
    testDb.prepare(`
      INSERT INTO entity_mutes (scope_type, scope_id, expires_at, created_by)
      VALUES ('entity', ?, datetime('now', '-1 minute'), 'mod1')
    `).run(String(a.id));
    const result = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch1", "g1");
    expect(result.active.length).toBe(1);
  });
});

// ── scope precedence ──────────────────────────────────────────────────────────

describe("check order", () => {
  test("channel kill-switch checked before per-entity", () => {
    const a = createEntity("A", "u1");
    // Both channel kill-switch and entity mute exist
    addMute({ scope_type: "channel", scope_id: "ch1", guild_id: "g1", channel_id: "ch1", created_by: "mod1" });
    addMute({ scope_type: "entity", scope_id: String(a.id), created_by: "mod1" });
    const result = filterMutedEntities([makeEntityWithFacts(a.id, "A")], "ch1", "g1");
    // channel scope is reported (kill-switch checked first)
    expect(result.muted[0]!.scope).toBe("channel");
  });
});
