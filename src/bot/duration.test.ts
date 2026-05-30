import { describe, it, expect } from "bun:test";
import { parseDuration, discordRelative } from "./duration";

describe("parseDuration", () => {
  describe("forever/permanent forms", () => {
    it("parses 'forever'", () => {
      const r = parseDuration("forever");
      expect(r).toEqual({ ok: true, expiresAt: null });
    });

    it("parses 'permanent'", () => {
      const r = parseDuration("permanent");
      expect(r).toEqual({ ok: true, expiresAt: null });
    });

    it("parses 'perm'", () => {
      const r = parseDuration("perm");
      expect(r).toEqual({ ok: true, expiresAt: null });
    });
  });

  // The output timestamp is truncated to whole seconds (SQLite format),
  // so parsed-back ms can be up to 999ms less than `before + duration`.
  // Use a 1000ms slack window in lower-bound checks.
  const SLACK = 1000;

  describe("short unit forms", () => {
    it("parses '30s'", () => {
      const before = Date.now();
      const r = parseDuration("30s");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 30_000 - SLACK);
      expect(expiresMs).toBeLessThanOrEqual(Date.now() + 30_000 + 100);
    });

    it("parses '10m'", () => {
      const before = Date.now();
      const r = parseDuration("10m");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 10 * 60_000 - SLACK);
      expect(expiresMs).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 100);
    });

    it("parses '1h'", () => {
      const before = Date.now();
      const r = parseDuration("1h");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 3_600_000 - SLACK);
      expect(expiresMs).toBeLessThanOrEqual(Date.now() + 3_600_000 + 100);
    });

    it("parses '2d'", () => {
      const before = Date.now();
      const r = parseDuration("2d");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 2 * 86_400_000 - SLACK);
    });

    it("parses '1w'", () => {
      const before = Date.now();
      const r = parseDuration("1w");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 604_800_000 - SLACK);
    });
  });

  describe("long/plural/spaced forms", () => {
    it("parses '30 minutes'", () => {
      const r = parseDuration("30 minutes");
      expect(r.ok).toBe(true);
    });

    it("parses '30 mins'", () => {
      const r = parseDuration("30 mins");
      expect(r.ok).toBe(true);
    });

    it("parses '30 min'", () => {
      const r = parseDuration("30 min");
      expect(r.ok).toBe(true);
    });

    it("parses '1 hour'", () => {
      const r = parseDuration("1 hour");
      expect(r.ok).toBe(true);
    });

    it("parses '2 hours'", () => {
      const r = parseDuration("2 hours");
      expect(r.ok).toBe(true);
    });

    it("parses '2 hrs'", () => {
      const r = parseDuration("2 hrs");
      expect(r.ok).toBe(true);
    });

    it("parses '3 days'", () => {
      const r = parseDuration("3 days");
      expect(r.ok).toBe(true);
    });

    it("parses '2 weeks'", () => {
      const r = parseDuration("2 weeks");
      expect(r.ok).toBe(true);
    });

    it("parses '1 wk'", () => {
      const r = parseDuration("1 wk");
      expect(r.ok).toBe(true);
    });

    it("parses '30 seconds'", () => {
      const r = parseDuration("30 seconds");
      expect(r.ok).toBe(true);
    });

    it("parses '30 sec'", () => {
      const r = parseDuration("30 sec");
      expect(r.ok).toBe(true);
    });

    it("parses '30 secs'", () => {
      const r = parseDuration("30 secs");
      expect(r.ok).toBe(true);
    });
  });

  describe("chained segments", () => {
    it("parses '1h30m'", () => {
      const before = Date.now();
      const r = parseDuration("1h30m");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      const expectedMs = 90 * 60_000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - SLACK);
      expect(expiresMs).toBeLessThanOrEqual(Date.now() + expectedMs + 100);
    });

    it("parses '1 hour 30 minutes'", () => {
      const before = Date.now();
      const r = parseDuration("1 hour 30 minutes");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 90 * 60_000 - SLACK);
    });

    it("parses '2d12h'", () => {
      const before = Date.now();
      const r = parseDuration("2d12h");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      const expectedMs = 2 * 86_400_000 + 12 * 3_600_000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - SLACK);
    });

    it("produces correct SQLite format (YYYY-MM-DD HH:MM:SS)", () => {
      const r = parseDuration("1h");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("invalid input", () => {
    it("rejects empty string", () => {
      expect(parseDuration("")).toEqual({ ok: false });
    });

    it("rejects whitespace only", () => {
      expect(parseDuration("   ")).toEqual({ ok: false });
    });

    it("rejects unknown unit", () => {
      expect(parseDuration("5 months")).toEqual({ ok: false });
    });

    it("rejects bare number", () => {
      expect(parseDuration("30")).toEqual({ ok: false });
    });

    it("rejects negative", () => {
      // Negative numbers are not matched by our regex (no leading minus)
      expect(parseDuration("-5m")).toEqual({ ok: false });
    });

    it("rejects zero", () => {
      expect(parseDuration("0m")).toEqual({ ok: false });
    });

    it("rejects garbage string", () => {
      expect(parseDuration("hello world")).toEqual({ ok: false });
    });

    it("rejects trailing garbage after valid segment", () => {
      expect(parseDuration("5m garbage")).toEqual({ ok: false });
    });
  });

  describe("admin cmd compat (fixed choices)", () => {
    it("parses '10m' to ~10 minutes", () => {
      const before = Date.now();
      const r = parseDuration("10m");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 10 * 60_000 - SLACK);
    });

    it("parses '1h' to ~1 hour", () => {
      const before = Date.now();
      const r = parseDuration("1h");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 3_600_000 - SLACK);
    });

    it("parses '1d' to ~1 day", () => {
      const before = Date.now();
      const r = parseDuration("1d");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const expiresMs = new Date(r.expiresAt!.replace(" ", "T") + "Z").getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 86_400_000 - SLACK);
    });
  });
});

describe("discordRelative", () => {
  it("converts a known SQLite UTC timestamp to correct unix seconds", () => {
    // "2024-01-01 00:00:00" UTC → unix 1704067200
    const result = discordRelative("2024-01-01 00:00:00");
    expect(result).toBe("<t:1704067200:R>");
  });

  it("uses the space separator (SQLite format) not T", () => {
    // Verify it handles the space separator correctly
    const ts = "2025-06-01 12:30:00";
    const expected = Math.floor(new Date("2025-06-01T12:30:00Z").getTime() / 1000);
    const result = discordRelative(ts);
    expect(result).toBe(`<t:${expected}:R>`);
  });

  it("round-trips through parseDuration", () => {
    const r = parseDuration("1h");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rel = discordRelative(r.expiresAt!);
    expect(rel).toMatch(/^<t:\d+:R>$/);
    // The unix timestamp should be approximately now + 1h
    const match = rel.match(/<t:(\d+):R>/);
    const unix = parseInt(match![1]!);
    const approxMs = unix * 1000;
    expect(approxMs).toBeGreaterThanOrEqual(Date.now() + 3_600_000 - 1000);
    expect(approxMs).toBeLessThanOrEqual(Date.now() + 3_600_000 + 1000);
  });
});
