import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "../db/test-utils";
import type { EvaluatedEntity } from "../ai/context";

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import { checkRateLimits, shouldWarnRateLimit, gcRateLimitWarns } from "./rate-limit";
import { createEntity, setEntityConfig } from "../db/entities";
import { setDiscordConfig } from "../db/discord";
import { recordEntityEvent } from "../db/moderation";

beforeEach(() => {
  testDb = createTestDb();
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntity(id: number, name = `entity-${id}`): EvaluatedEntity {
  return {
    id,
    name,
    facts: [],
    avatarUrl: null,
    streamMode: null,
    streamDelimiter: null,
    memoryScope: "none",
    contextExpr: null,
    isFreeform: false,
    modelSpec: null,
    stripPatterns: null,
    thinkingLevel: null,
    collapseMessages: null,
    contentFilters: [],
    template: null,
    systemTemplate: null,
  };
}

// ── no limits ─────────────────────────────────────────────────────────────────

describe("no limits configured", () => {
  test("all entities allowed when no limits set", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(a.id, "A"), makeEntity(b.id, "B")]);
    expect(decision.allow.length).toBe(2);
    expect(decision.denied.length).toBe(0);
  });

  test("empty entity list returns empty decision", () => {
    const decision = checkRateLimits("ch1", "g1", []);
    expect(decision.allow.length).toBe(0);
    expect(decision.denied.length).toBe(0);
  });
});

// ── per-entity limit ──────────────────────────────────────────────────────────

describe("per-entity limit", () => {
  test("entity under limit is allowed", () => {
    const e = createEntity("Aria", "u1");
    setEntityConfig(e.id, { config_rate_per_min: 5 });
    recordEntityEvent(e.id, "u1", "ch1", "g1", "message"); // 1 event
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.allow.length).toBe(1);
  });

  test("entity at limit is denied", () => {
    const e = createEntity("Aria", "u1");
    setEntityConfig(e.id, { config_rate_per_min: 2 });
    recordEntityEvent(e.id, "u1", "ch1", "g1", "message");
    recordEntityEvent(e.id, "u1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.allow.length).toBe(0);
    expect(decision.denied.length).toBe(1);
    expect(decision.denied[0]!.scope).toBe("entity");
    expect(decision.denied[0]!.limit).toBe(2);
  });

  test("one entity denied does not affect another", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    setEntityConfig(a.id, { config_rate_per_min: 1 });
    recordEntityEvent(a.id, "u1", "ch1", "g1", "message"); // A at limit
    const decision = checkRateLimits("ch1", "g1", [makeEntity(a.id, "A"), makeEntity(b.id, "B")]);
    expect(decision.allow.length).toBe(1);
    expect(decision.allow[0]!.id).toBe(b.id);
    expect(decision.denied[0]!.entity.id).toBe(a.id);
  });
});

// ── per-owner limit ───────────────────────────────────────────────────────────

describe("per-owner limit", () => {
  test("owner under limit is allowed", () => {
    const e = createEntity("Aria", "owner1");
    setDiscordConfig("g1", "guild", { config_rate_owner_per_min: 5 });
    recordEntityEvent(e.id, "owner1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.allow.length).toBe(1);
  });

  test("owner at limit is denied", () => {
    const e = createEntity("Aria", "owner1");
    setDiscordConfig("g1", "guild", { config_rate_owner_per_min: 2 });
    recordEntityEvent(e.id, "owner1", "ch1", "g1", "message");
    recordEntityEvent(e.id, "owner1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.denied[0]!.scope).toBe("owner");
  });

  test("channel config overrides guild config for owner limit", () => {
    const e = createEntity("Aria", "owner1");
    setDiscordConfig("g1", "guild", { config_rate_owner_per_min: 1 });
    setDiscordConfig("ch1", "channel", { config_rate_owner_per_min: 10 });
    recordEntityEvent(e.id, "owner1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.allow.length).toBe(1); // channel override (10) not hit
  });
});

// ── per-channel limit ─────────────────────────────────────────────────────────

describe("per-channel limit", () => {
  test("channel under limit is allowed", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    setDiscordConfig("ch1", "channel", { config_rate_channel_per_min: 5 });
    recordEntityEvent(a.id, "u1", "ch1", "g1", "message");
    recordEntityEvent(b.id, "u2", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(a.id, "A"), makeEntity(b.id, "B")]);
    expect(decision.allow.length).toBe(2);
  });

  test("channel at limit denies all further entities", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    setDiscordConfig("ch1", "channel", { config_rate_channel_per_min: 2 });
    recordEntityEvent(a.id, "u1", "ch1", "g1", "message");
    recordEntityEvent(b.id, "u2", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(a.id, "A"), makeEntity(b.id, "B")]);
    expect(decision.allow.length).toBe(0);
    expect(decision.denied.every(d => d.scope === "channel")).toBe(true);
  });
});

// ── limit precedence ──────────────────────────────────────────────────────────

describe("limit precedence", () => {
  test("entity limit checked before owner limit", () => {
    const e = createEntity("Aria", "owner1");
    setEntityConfig(e.id, { config_rate_per_min: 1 });
    setDiscordConfig("g1", "guild", { config_rate_owner_per_min: 100 });
    recordEntityEvent(e.id, "owner1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.denied[0]!.scope).toBe("entity");
  });

  test("owner limit checked before channel limit", () => {
    const e = createEntity("Aria", "owner1");
    setDiscordConfig("g1", "guild", { config_rate_owner_per_min: 1, config_rate_channel_per_min: 100 });
    recordEntityEvent(e.id, "owner1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.denied[0]!.scope).toBe("owner");
  });
});

// ── ownerIds map ──────────────────────────────────────────────────────────────

describe("ownerIds in decision", () => {
  test("maps entity id to owner id for allowed entities", () => {
    const e = createEntity("Aria", "owner99");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.ownerIds.get(e.id)).toBe("owner99");
  });

  test("denied entities are not in ownerIds", () => {
    const e = createEntity("Aria", "u1");
    setEntityConfig(e.id, { config_rate_per_min: 1 });
    recordEntityEvent(e.id, "u1", "ch1", "g1", "message");
    const decision = checkRateLimits("ch1", "g1", [makeEntity(e.id, "Aria")]);
    expect(decision.ownerIds.has(e.id)).toBe(false);
  });
});

// ── warn dedup ────────────────────────────────────────────────────────────────

describe("shouldWarnRateLimit dedup", () => {
  test("first call returns true", () => {
    expect(shouldWarnRateLimit(999, "entity")).toBe(true);
  });

  test("second call within TTL returns false", () => {
    shouldWarnRateLimit(998, "channel");
    expect(shouldWarnRateLimit(998, "channel")).toBe(false);
  });

  test("different scope for same entity returns true", () => {
    shouldWarnRateLimit(997, "entity");
    expect(shouldWarnRateLimit(997, "owner")).toBe(true);
  });

  test("gcRateLimitWarns does not throw", () => {
    expect(() => gcRateLimitWarns()).not.toThrow();
  });
});
