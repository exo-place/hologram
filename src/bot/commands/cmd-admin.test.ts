import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "../../db/test-utils";
import { ApplicationCommandOptionTypes } from "@discordeno/bot";

let testDb: Database;

mock.module("../../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import { parseAdminOptions, parseDuration } from "./cmd-admin";

beforeEach(() => {
  testDb = createTestDb();
});

// =============================================================================
// parseDuration
// =============================================================================

describe("parseDuration", () => {
  test("returns null for 'forever'", () => {
    expect(parseDuration("forever")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseDuration("")).toBeNull();
  });

  test("10m returns a timestamp ~10 minutes in future", () => {
    const before = Date.now();
    const result = parseDuration("10m");
    const after = Date.now();
    expect(result).not.toBeNull();
    const ts = new Date(result!.replace(" ", "T") + "Z").getTime();
    expect(ts).toBeGreaterThanOrEqual(before + 9 * 60 * 1000);
    expect(ts).toBeLessThanOrEqual(after + 11 * 60 * 1000);
  });

  test("1h returns a timestamp ~1 hour in future", () => {
    const result = parseDuration("1h");
    expect(result).not.toBeNull();
    const ts = new Date(result!.replace(" ", "T") + "Z").getTime();
    expect(ts).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
  });

  test("1d returns a timestamp ~1 day in future", () => {
    const result = parseDuration("1d");
    expect(result).not.toBeNull();
    const ts = new Date(result!.replace(" ", "T") + "Z").getTime();
    expect(ts).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  test("format is YYYY-MM-DD HH:MM:SS", () => {
    const result = parseDuration("1h");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("unknown string returns null", () => {
    expect(parseDuration("2h")).toBeNull();
    expect(parseDuration("foobar")).toBeNull();
  });
});

// =============================================================================
// parseAdminOptions
// =============================================================================

const SUB_COMMAND = ApplicationCommandOptionTypes.SubCommand;
const SUB_COMMAND_GROUP = ApplicationCommandOptionTypes.SubCommandGroup;
const STRING = ApplicationCommandOptionTypes.String;

describe("parseAdminOptions", () => {
  test("returns null for empty options", () => {
    expect(parseAdminOptions([])).toBeNull();
  });

  test("parses SubCommandGroup + SubCommand", () => {
    const opts = [
      {
        type: SUB_COMMAND_GROUP,
        name: "mute",
        options: [
          {
            type: SUB_COMMAND,
            name: "create",
            options: [
              { type: STRING, name: "target", value: "Aria" },
              { type: STRING, name: "scope", value: "entity" },
              { type: STRING, name: "duration", value: "1h" },
            ],
          },
        ],
      },
    ];
    const parsed = parseAdminOptions(opts);
    expect(parsed).not.toBeNull();
    expect(parsed!.group).toBe("mute");
    expect(parsed!.sub).toBe("create");
    expect(parsed!.opts.target).toBe("Aria");
    expect(parsed!.opts.scope).toBe("entity");
    expect(parsed!.opts.duration).toBe("1h");
  });

  test("parses top-level SubCommand (audit)", () => {
    const opts = [
      {
        type: SUB_COMMAND,
        name: "audit",
        options: [
          { type: STRING, name: "filter", value: "rate_limited" },
          { type: ApplicationCommandOptionTypes.Integer, name: "hours", value: 12 },
        ],
      },
    ];
    const parsed = parseAdminOptions(opts);
    expect(parsed!.group).toBe("");
    expect(parsed!.sub).toBe("audit");
    expect(parsed!.opts.filter).toBe("rate_limited");
    expect(parsed!.opts.hours).toBe(12);
  });

  test("parses SubCommandGroup with no options in subcommand", () => {
    const opts = [
      {
        type: SUB_COMMAND_GROUP,
        name: "enable",
        options: [
          { type: SUB_COMMAND, name: "channel" },
        ],
      },
    ];
    const parsed = parseAdminOptions(opts);
    expect(parsed!.group).toBe("enable");
    expect(parsed!.sub).toBe("channel");
    expect(Object.keys(parsed!.opts).length).toBe(0);
  });

  test("returns null if SubCommandGroup has no nested subcommand", () => {
    const opts = [
      {
        type: SUB_COMMAND_GROUP,
        name: "mute",
        options: [],
      },
    ];
    expect(parseAdminOptions(opts)).toBeNull();
  });
});
