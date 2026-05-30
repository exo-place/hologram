import { describe, it, expect } from "bun:test";
import { decideMuteAuth, type MuteAuthInput } from "./cmd-mute";

describe("decideMuteAuth", () => {
  // Helper builders
  function input(overrides: Partial<MuteAuthInput>): MuteAuthInput {
    return {
      target: "entity",
      scope: "channel",
      hasTimeout: false,
      canEdit: false,
      isAdmin: false,
      ...overrides,
    };
  }

  // ==========================================================================
  // entity × channel
  // ==========================================================================

  describe("target=entity, scope=channel", () => {
    it("allows if hasTimeout only", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "channel", hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("allows if canEdit only", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "channel", canEdit: true }));
      expect(r.allow).toBe(true);
    });

    it("allows if both hasTimeout and canEdit", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "channel", hasTimeout: true, canEdit: true }));
      expect(r.allow).toBe(true);
    });

    it("allows if isAdmin (isAdmin implies hasTimeout in real code, but matrix uses hasTimeout flag)", () => {
      // isAdmin alone does NOT grant entity-channel mute in the matrix — hasTimeout or canEdit required.
      // The caller passes hasTimeout=true when isAdmin, so this tests that.
      const r = decideMuteAuth(input({ target: "entity", scope: "channel", isAdmin: true, hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if none set", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "channel" }));
      expect(r.allow).toBe(false);
      if (!r.allow) expect(r.reason).toBeTruthy();
    });

    it("denies if only isAdmin (no hasTimeout, no canEdit)", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "channel", isAdmin: true }));
      expect(r.allow).toBe(false);
    });
  });

  // ==========================================================================
  // entity × server
  // ==========================================================================

  describe("target=entity, scope=server", () => {
    it("allows if hasTimeout only", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "server", hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("allows if canEdit only", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "server", canEdit: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if none set", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "server" }));
      expect(r.allow).toBe(false);
    });
  });

  // ==========================================================================
  // entity × everywhere
  // ==========================================================================

  describe("target=entity, scope=everywhere", () => {
    it("allows if canEdit only", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "everywhere", canEdit: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if hasTimeout only (not enough for everywhere)", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "everywhere", hasTimeout: true }));
      expect(r.allow).toBe(false);
      if (!r.allow) expect(r.reason).toContain("edit access");
    });

    it("denies if none set", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "everywhere" }));
      expect(r.allow).toBe(false);
    });

    it("allows if both hasTimeout and canEdit", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "everywhere", hasTimeout: true, canEdit: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if isAdmin without canEdit", () => {
      const r = decideMuteAuth(input({ target: "entity", scope: "everywhere", isAdmin: true }));
      expect(r.allow).toBe(false);
    });
  });

  // ==========================================================================
  // allbots × channel
  // ==========================================================================

  describe("target=allbots, scope=channel", () => {
    it("allows if hasTimeout", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "channel", hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("allows if isAdmin (real code also passes hasTimeout=true for admins)", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "channel", isAdmin: true, hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if only canEdit (canEdit alone not enough for kill switch)", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "channel", canEdit: true }));
      expect(r.allow).toBe(false);
      if (!r.allow) expect(r.reason).toContain("Moderate Members");
    });

    it("denies if none set", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "channel" }));
      expect(r.allow).toBe(false);
    });

    it("denies if isAdmin alone (no hasTimeout)", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "channel", isAdmin: true }));
      expect(r.allow).toBe(false);
    });
  });

  // ==========================================================================
  // allbots × server
  // ==========================================================================

  describe("target=allbots, scope=server", () => {
    it("allows if hasTimeout", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "server", hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if only canEdit", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "server", canEdit: true }));
      expect(r.allow).toBe(false);
    });

    it("denies if none set", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "server" }));
      expect(r.allow).toBe(false);
    });
  });

  // ==========================================================================
  // allbots × everywhere
  // ==========================================================================

  describe("target=allbots, scope=everywhere", () => {
    it("allows if isAdmin", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "everywhere", isAdmin: true, hasTimeout: true }));
      expect(r.allow).toBe(true);
    });

    it("denies if only hasTimeout (not admin)", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "everywhere", hasTimeout: true }));
      expect(r.allow).toBe(false);
      if (!r.allow) expect(r.reason).toContain("Administrator");
    });

    it("denies if none set", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "everywhere" }));
      expect(r.allow).toBe(false);
    });

    it("denies if only canEdit", () => {
      const r = decideMuteAuth(input({ target: "allbots", scope: "everywhere", canEdit: true }));
      expect(r.allow).toBe(false);
    });
  });
});
