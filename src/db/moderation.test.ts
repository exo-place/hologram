import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "./test-utils";

let testDb: Database;

mock.module("./index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import {
  recordEntityEvent,
  countEntityEvents,
  countOwnerEvents,
  countChannelEvents,
  gcOldEvents,
  addMute,
  removeMute,
  getMute,
  listActiveMutes,
  isMuted,
  gcExpiredMutes,
  recordModEvent,
  getModEvents,
} from "./moderation";
import { createEntity } from "./entities";

beforeEach(() => {
  testDb = createTestDb();
});

// =============================================================================
// Entity Events
// =============================================================================

describe("entity events", () => {
  test("records and counts events by entity", () => {
    const entity = createEntity("Aria", "user1");
    recordEntityEvent(entity.id, "user1", "ch1", "g1", "message");
    recordEntityEvent(entity.id, "user1", "ch1", "g1", "message");
    expect(countEntityEvents(entity.id)).toBe(2);
  });

  test("counts are scoped to entity", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    recordEntityEvent(a.id, "u1", "ch1", "g1", "message");
    recordEntityEvent(a.id, "u1", "ch1", "g1", "message");
    recordEntityEvent(b.id, "u2", "ch1", "g1", "message");
    expect(countEntityEvents(a.id)).toBe(2);
    expect(countEntityEvents(b.id)).toBe(1);
  });

  test("countOwnerEvents scoped by guild", () => {
    const entity = createEntity("Aria", "owner1");
    recordEntityEvent(entity.id, "owner1", "ch1", "g1", "message");
    recordEntityEvent(entity.id, "owner1", "ch2", "g1", "message");
    recordEntityEvent(entity.id, "owner1", "ch3", "g2", "message");
    expect(countOwnerEvents("owner1", "g1")).toBe(2);
    expect(countOwnerEvents("owner1", "g2")).toBe(1);
    expect(countOwnerEvents("owner1", null)).toBe(3);
  });

  test("countChannelEvents scoped by channel", () => {
    const a = createEntity("A", "u1");
    const b = createEntity("B", "u2");
    recordEntityEvent(a.id, "u1", "ch1", "g1", "message");
    recordEntityEvent(b.id, "u2", "ch1", "g1", "message");
    recordEntityEvent(a.id, "u1", "ch2", "g1", "message");
    expect(countChannelEvents("ch1")).toBe(2);
    expect(countChannelEvents("ch2")).toBe(1);
  });

  test("gcOldEvents removes old rows", () => {
    const entity = createEntity("Aria", "u1");
    // Insert a row with old timestamp directly
    testDb.prepare(`
      INSERT INTO entity_events (entity_id, owner_id, channel_id, guild_id, trigger_type, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '-8 days'))
    `).run(entity.id, "u1", "ch1", "g1", "message");
    // Insert a recent row
    recordEntityEvent(entity.id, "u1", "ch1", "g1", "message");

    const deleted = gcOldEvents(7);
    expect(deleted).toBe(1);
    expect(countEntityEvents(entity.id)).toBe(1);
  });
});

// =============================================================================
// Entity Mutes — CRUD
// =============================================================================

describe("mute CRUD", () => {
  test("addMute and getMute round-trip", () => {
    const mute = addMute({
      scope_type: "entity",
      scope_id: "42",
      guild_id: "g1",
      channel_id: null,
      expires_at: null,
      created_by: "mod1",
      reason: "test reason",
    });
    expect(mute.id).toBeGreaterThan(0);
    expect(mute.scope_type).toBe("entity");
    expect(mute.scope_id).toBe("42");
    expect(mute.reason).toBe("test reason");

    const fetched = getMute(mute.id);
    expect(fetched).toEqual(mute);
  });

  test("removeMute returns true and deletes", () => {
    const mute = addMute({ scope_type: "owner", scope_id: "u1", created_by: "mod1" });
    expect(removeMute(mute.id)).toBe(true);
    expect(getMute(mute.id)).toBeNull();
  });

  test("removeMute returns false for unknown id", () => {
    expect(removeMute(99999)).toBe(false);
  });
});

// =============================================================================
// Entity Mutes — List with filters
// =============================================================================

describe("listActiveMutes", () => {
  test("lists all active mutes", () => {
    addMute({ scope_type: "entity", scope_id: "1", created_by: "m" });
    addMute({ scope_type: "owner", scope_id: "u1", guild_id: "g1", created_by: "m" });
    const all = listActiveMutes();
    expect(all.length).toBe(2);
  });

  test("filters by scope_type", () => {
    addMute({ scope_type: "entity", scope_id: "1", created_by: "m" });
    addMute({ scope_type: "owner", scope_id: "u1", created_by: "m" });
    expect(listActiveMutes({ scope_type: "entity" }).length).toBe(1);
    expect(listActiveMutes({ scope_type: "owner" }).length).toBe(1);
  });

  test("filters by scope_id", () => {
    addMute({ scope_type: "entity", scope_id: "5", created_by: "m" });
    addMute({ scope_type: "entity", scope_id: "6", created_by: "m" });
    expect(listActiveMutes({ scope_id: "5" }).length).toBe(1);
  });

  test("excludes expired mutes by default", () => {
    // Insert already-expired mute directly
    testDb.prepare(`
      INSERT INTO entity_mutes (scope_type, scope_id, expires_at, created_by)
      VALUES ('entity', '99', datetime('now', '-1 hour'), 'mod1')
    `).run();
    expect(listActiveMutes({ scope_id: "99" }).length).toBe(0);
    expect(listActiveMutes({ scope_id: "99", includeExpired: true }).length).toBe(1);
  });

  test("filters by guild_id", () => {
    addMute({ scope_type: "owner", scope_id: "u1", guild_id: "g1", created_by: "m" });
    addMute({ scope_type: "owner", scope_id: "u1", guild_id: "g2", created_by: "m" });
    expect(listActiveMutes({ guild_id: "g1" }).length).toBe(1);
    expect(listActiveMutes({ guild_id: null }).length).toBe(0);
  });
});

// =============================================================================
// isMuted — scope resolution
// =============================================================================

describe("isMuted", () => {
  test("returns null when no mutes", () => {
    expect(isMuted("entity", "1", "ch1", "g1")).toBeNull();
  });

  test("entity scope matches in any channel/guild", () => {
    addMute({ scope_type: "entity", scope_id: "42", created_by: "m" });
    expect(isMuted("entity", "42", "ch1", "g1")).not.toBeNull();
    expect(isMuted("entity", "42", "ch2", "g2")).not.toBeNull();
  });

  test("entity scope with guild restriction only matches that guild", () => {
    addMute({ scope_type: "entity", scope_id: "42", guild_id: "g1", created_by: "m" });
    expect(isMuted("entity", "42", "ch1", "g1")).not.toBeNull();
    expect(isMuted("entity", "42", "ch1", "g2")).toBeNull();
  });

  test("entity scope with channel+guild restriction only matches that channel", () => {
    addMute({ scope_type: "entity", scope_id: "42", guild_id: "g1", channel_id: "ch1", created_by: "m" });
    expect(isMuted("entity", "42", "ch1", "g1")).not.toBeNull();
    expect(isMuted("entity", "42", "ch2", "g1")).toBeNull();
  });

  test("expired mutes are ignored", () => {
    testDb.prepare(`
      INSERT INTO entity_mutes (scope_type, scope_id, expires_at, created_by)
      VALUES ('entity', '7', datetime('now', '-1 minute'), 'mod1')
    `).run();
    expect(isMuted("entity", "7", "ch1", "g1")).toBeNull();
  });

  test("owner scope", () => {
    addMute({ scope_type: "owner", scope_id: "u1", guild_id: "g1", created_by: "m" });
    expect(isMuted("owner", "u1", "ch1", "g1")).not.toBeNull();
    expect(isMuted("owner", "u2", "ch1", "g1")).toBeNull();
  });

  test("channel scope (kill switch)", () => {
    addMute({ scope_type: "channel", scope_id: "ch1", guild_id: "g1", channel_id: "ch1", created_by: "m" });
    expect(isMuted("channel", "ch1", "ch1", "g1")).not.toBeNull();
    expect(isMuted("channel", "ch2", "ch2", "g1")).toBeNull();
  });

  test("guild scope (guild kill switch)", () => {
    addMute({ scope_type: "guild", scope_id: "g1", created_by: "m" });
    expect(isMuted("guild", "g1", "ch1", "g1")).not.toBeNull();
    expect(isMuted("guild", "g2", "ch1", "g2")).toBeNull();
  });
});

// =============================================================================
// gcExpiredMutes
// =============================================================================

describe("gcExpiredMutes", () => {
  test("removes expired mutes", () => {
    testDb.prepare(`
      INSERT INTO entity_mutes (scope_type, scope_id, expires_at, created_by)
      VALUES ('entity', '1', datetime('now', '-1 hour'), 'mod1')
    `).run();
    addMute({ scope_type: "entity", scope_id: "2", expires_at: null, created_by: "m" });
    const deleted = gcExpiredMutes();
    expect(deleted).toBe(1);
    expect(listActiveMutes().length).toBe(1);
  });
});

// =============================================================================
// Mod Events
// =============================================================================

describe("mod events", () => {
  test("recordModEvent and getModEvents round-trip", () => {
    const ev = recordModEvent({
      event_type: "rate_limited",
      actor_id: null,
      target_type: "entity",
      target_id: "5",
      channel_id: "ch1",
      guild_id: "g1",
      details: { limit: 5, current: 6 },
    });
    expect(ev.id).toBeGreaterThan(0);
    expect(ev.event_type).toBe("rate_limited");

    const events = getModEvents({ guild_id: "g1" });
    expect(events.length).toBe(1);
    expect(events[0]!.target_id).toBe("5");
  });

  test("filters by event_type", () => {
    recordModEvent({ event_type: "rate_limited", target_type: "entity", target_id: "1" });
    recordModEvent({ event_type: "muted", target_type: "entity", target_id: "2" });
    expect(getModEvents({ event_type: "rate_limited" }).length).toBe(1);
    expect(getModEvents({ event_type: "muted" }).length).toBe(1);
  });

  test("filters by target_type and target_id", () => {
    recordModEvent({ event_type: "muted", target_type: "entity", target_id: "10" });
    recordModEvent({ event_type: "muted", target_type: "owner", target_id: "u1" });
    expect(getModEvents({ target_type: "entity", target_id: "10" }).length).toBe(1);
    expect(getModEvents({ target_type: "owner" }).length).toBe(1);
  });

  test("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      recordModEvent({ event_type: "rate_limited" });
    }
    expect(getModEvents({ limit: 3 }).length).toBe(3);
  });
});
