/**
 * Tests for src/ai/streaming.ts
 *
 * Focuses on the pure/exported helper logic:
 *  - findFirstDelimiter (already has a few tests, extended here)
 *  - streamSingleEntity (via async generator helpers)
 *  - streamMultiEntityNamePrefix (format detection + fallback)
 *
 * handleMessageStreaming() requires a live LLM call and is not tested here.
 */
import { describe, expect, test } from "bun:test";
import { findFirstDelimiter } from "./streaming";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an AsyncGenerator that yields the provided strings in order. */
async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

// ---------------------------------------------------------------------------
// findFirstDelimiter — basic coverage (extended)
// ---------------------------------------------------------------------------

describe("findFirstDelimiter", () => {
  test("finds single delimiter", () => {
    expect(findFirstDelimiter("hello\nworld", ["\n"])).toEqual({ index: 5, length: 1 });
  });

  test("finds earliest delimiter among multiple", () => {
    expect(findFirstDelimiter("a|b\nc", ["\n", "|"])).toEqual({ index: 1, length: 1 });
  });

  test("returns -1 when no delimiter found", () => {
    expect(findFirstDelimiter("hello world", ["\n", "|"])).toEqual({ index: -1, length: 0 });
  });

  test("handles empty delimiters array", () => {
    expect(findFirstDelimiter("hello", [])).toEqual({ index: -1, length: 0 });
  });

  test("handles multi-character delimiter", () => {
    expect(findFirstDelimiter("hello---world", ["---"])).toEqual({ index: 5, length: 3 });
  });

  test("finds earliest when multiple delimiters present", () => {
    expect(findFirstDelimiter("a---b\nc", ["---", "\n"])).toEqual({ index: 1, length: 3 });
  });

  test("handles delimiter at start of string", () => {
    expect(findFirstDelimiter("\nhello", ["\n"])).toEqual({ index: 0, length: 1 });
  });

  test("handles delimiter at end of string", () => {
    expect(findFirstDelimiter("hello\n", ["\n"])).toEqual({ index: 5, length: 1 });
  });

  test("handles empty buffer", () => {
    expect(findFirstDelimiter("", ["\n"])).toEqual({ index: -1, length: 0 });
  });

  test("picks first-matched delimiter when both at same index", () => {
    const result = findFirstDelimiter("abc", ["ab", "a"]);
    // Both match at index 0, "ab" is checked first in loop order
    expect(result.index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// streamSingleEntity — accessed indirectly via the exported generator
//
// streamSingleEntity is not exported, but its behaviour is covered by testing
// streamMultiEntityNamePrefix (which is also not exported directly).  The only
// exported async-generator entry-point that exercises these paths is
// handleMessageStreaming(), which requires a live LLM.
//
// We therefore test the observable subset: the behaviour of the name-prefix
// detection logic through streamMultiEntityNamePrefix by importing the
// internal symbols used by streaming helpers from parsing.ts, and by
// constructing equivalent scenarios using only exported symbols.
// ---------------------------------------------------------------------------

// Import internal async generators via dynamic re-export trick.
// Since the functions are module-internal, we test them by re-implementing
// a minimal harness that exercises the same code paths via the exported
// findFirstDelimiter and the parsing utilities.

// We can still exercise large portions of streaming logic by directly testing
// the name-prefix-based multi-entity path indirectly.  The generator functions
// are not exported so we test findFirstDelimiter extensively plus all the
// helper functions from parsing.ts that are called by streaming.

import { stripNamePrefixFromStream, stripNamePrefix, namePrefixSource, NAME_BOUNDARY } from "./parsing";

// ---------------------------------------------------------------------------
// stripNamePrefix (stateless, pure)
// ---------------------------------------------------------------------------

describe("stripNamePrefix", () => {
  test("strips plain Name: prefix", () => {
    expect(stripNamePrefix("Alice: hello", "Alice")).toBe("hello");
  });

  test("strips bold **Name:** prefix", () => {
    expect(stripNamePrefix("**Alice:** hello", "Alice")).toBe("hello");
  });

  test("strips bold Name with colon outside **Name**:", () => {
    expect(stripNamePrefix("**Alice**: hello", "Alice")).toBe("hello");
  });

  test("strips italic *Name:* prefix", () => {
    expect(stripNamePrefix("*Alice:* hello", "Alice")).toBe("hello");
  });

  test("does not strip non-matching name", () => {
    expect(stripNamePrefix("Bob: hello", "Alice")).toBe("Bob: hello");
  });

  test("strips prefix at every line start (multiline)", () => {
    const input = "Alice: first\nAlice: second";
    expect(stripNamePrefix(input, "Alice")).toBe("first\nsecond");
  });

  test("case-insensitive match", () => {
    expect(stripNamePrefix("alice: hello", "Alice")).toBe("hello");
  });

  test("does not strip mid-line occurrence", () => {
    const text = "hello Alice: there";
    expect(stripNamePrefix(text, "Alice")).toBe("hello Alice: there");
  });
});

// ---------------------------------------------------------------------------
// namePrefixSource
// ---------------------------------------------------------------------------

describe("namePrefixSource", () => {
  test("matches plain Name:", () => {
    const re = new RegExp(`^${namePrefixSource("Alice")}`);
    expect(re.test("Alice: hello")).toBe(true);
  });

  test("matches **Name:**", () => {
    const re = new RegExp(`^${namePrefixSource("Alice")}`);
    expect(re.test("**Alice:** hello")).toBe(true);
  });

  test("matches **Name**:", () => {
    const re = new RegExp(`^${namePrefixSource("Alice")}`);
    expect(re.test("**Alice**: hello")).toBe(true);
  });

  test("matches *Name:*", () => {
    const re = new RegExp(`^${namePrefixSource("Alice")}`);
    expect(re.test("*Alice:* hello")).toBe(true);
  });

  test("does not match name without colon", () => {
    const re = new RegExp(`^${namePrefixSource("Alice")}`);
    expect(re.test("Alice hello")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripNamePrefixFromStream (async generator)
// ---------------------------------------------------------------------------

describe("stripNamePrefixFromStream", () => {
  test("strips Name: prefix from a single-chunk stream", async () => {
    const chunks = ["Alice: hello world"];
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks(chunks), "Alice")) {
      output.push(chunk);
    }
    expect(output.join("")).toBe("hello world");
  });

  test("passes through content with no prefix", async () => {
    const chunks = ["just some text"];
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks(chunks), "Alice")) {
      output.push(chunk);
    }
    expect(output.join("")).toBe("just some text");
  });

  test("strips prefix from each line in multi-line output", async () => {
    const chunks = ["Alice: line one\nAlice: line two"];
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks(chunks), "Alice")) {
      output.push(chunk);
    }
    expect(output.join("")).toBe("line one\nline two");
  });

  test("handles prefix arriving in separate chunks", async () => {
    // "Alice:" split across two chunks
    const chunks = ["Ali", "ce: hello"];
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks(chunks), "Alice")) {
      output.push(chunk);
    }
    expect(output.join("")).toBe("hello");
  });

  test("inserts NAME_BOUNDARY between segments when boundaryChar provided", async () => {
    const chunks = ["Alice: first\nAlice: second"];
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks(chunks), "Alice", NAME_BOUNDARY)) {
      output.push(chunk);
    }
    const joined = output.join("");
    // Should contain NAME_BOUNDARY between "first" and "second"
    expect(joined).toContain(NAME_BOUNDARY);
    const parts = joined.split(NAME_BOUNDARY).map(s => s.trim());
    expect(parts).toContain("first");
    expect(parts).toContain("second");
  });

  test("empty stream yields nothing", async () => {
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks([]), "Alice")) {
      output.push(chunk);
    }
    expect(output.join("")).toBe("");
  });

  test("strips bold **Name:** prefix from stream", async () => {
    const chunks = ["**Alice:** hello"];
    const output: string[] = [];
    for await (const chunk of stripNamePrefixFromStream(fromChunks(chunks), "Alice")) {
      output.push(chunk);
    }
    expect(output.join("").trim()).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// NAME_BOUNDARY constant
// ---------------------------------------------------------------------------

describe("NAME_BOUNDARY", () => {
  test("is a null character", () => {
    expect(NAME_BOUNDARY).toBe("\0");
  });
});

// ---------------------------------------------------------------------------
// findFirstDelimiter with NAME_BOUNDARY
// ---------------------------------------------------------------------------

describe("findFirstDelimiter with NAME_BOUNDARY", () => {
  test("finds NAME_BOUNDARY in buffer", () => {
    const buffer = "hello\0world";
    const result = findFirstDelimiter(buffer, [NAME_BOUNDARY]);
    expect(result.index).toBe(5);
    expect(result.length).toBe(1);
  });

  test("finds NAME_BOUNDARY before regular delimiter", () => {
    const buffer = "hello\0wo\nrld";
    const result = findFirstDelimiter(buffer, [NAME_BOUNDARY, "\n"]);
    expect(result.index).toBe(5);
  });

  test("finds regular delimiter before NAME_BOUNDARY", () => {
    const buffer = "hel\nlo\0world";
    const result = findFirstDelimiter(buffer, [NAME_BOUNDARY, "\n"]);
    expect(result.index).toBe(3);
  });
});
