import { describe, expect, test } from "bun:test";
import {
  namePrefixSource,
  stripNamePrefix,
  stripNamePrefixFromStream,
  parseNamePrefixResponse,
  NAME_BOUNDARY,
} from "./parsing";
import type { EvaluatedEntity } from "./context";

/** Create a minimal EvaluatedEntity for testing */
function makeEntity(overrides: Partial<EvaluatedEntity> & { name: string; id: number }): EvaluatedEntity {
  return {
    facts: [],
    avatarUrl: null,
    streamMode: null,
    streamDelimiter: null,
    memoryScope: "none",
    contextExpr: null,
    isFreeform: false,
    modelSpec: null,
    stripPatterns: null,
    template: null,
    systemTemplate: null,
    ...overrides,
  };
}

/** Collect all chunks from an async generator into a single string */
async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  let result = "";
  for await (const chunk of gen) result += chunk;
  return result;
}

/** Create an async iterable from an array of string chunks */
async function* fromChunks(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

// =============================================================================
// namePrefixSource
// =============================================================================

describe("namePrefixSource", () => {
  test("matches plain Name:", () => {
    const regex = new RegExp(`^${namePrefixSource("Alice")}`, "i");
    expect(regex.test("Alice:")).toBe(true);
  });

  test("matches bold **Name:**", () => {
    const regex = new RegExp(`^${namePrefixSource("Alice")}`, "i");
    expect(regex.test("**Alice:**")).toBe(true);
  });

  test("matches bold **Name**:", () => {
    const regex = new RegExp(`^${namePrefixSource("Alice")}`, "i");
    expect(regex.test("**Alice**:")).toBe(true);
  });

  test("matches italic *Name:*", () => {
    const regex = new RegExp(`^${namePrefixSource("Alice")}`, "i");
    expect(regex.test("*Alice:*")).toBe(true);
  });

  test("matches italic *Name*:", () => {
    const regex = new RegExp(`^${namePrefixSource("Alice")}`, "i");
    expect(regex.test("*Alice*:")).toBe(true);
  });

  test("does not match without colon", () => {
    const regex = new RegExp(`^${namePrefixSource("Alice")}`, "i");
    expect(regex.test("Alice")).toBe(false);
  });
});

// =============================================================================
// stripNamePrefix
// =============================================================================

describe("stripNamePrefix", () => {
  test("strips plain Name: prefix", () => {
    expect(stripNamePrefix("Alice: Hello there!", "Alice")).toBe("Hello there!");
  });

  test("strips bold **Name:** prefix", () => {
    expect(stripNamePrefix("**Alice:** Hello", "Alice")).toBe("Hello");
  });

  test("strips bold **Name**: prefix", () => {
    expect(stripNamePrefix("**Alice**: Hello", "Alice")).toBe("Hello");
  });

  test("strips italic *Name:* prefix", () => {
    expect(stripNamePrefix("*Alice:* Hello", "Alice")).toBe("Hello");
  });

  test("is case-insensitive", () => {
    expect(stripNamePrefix("ALICE: Hello", "Alice")).toBe("Hello");
    expect(stripNamePrefix("alice: Hello", "Alice")).toBe("Hello");
  });

  test("strips from multiple lines", () => {
    const text = "Alice: Hello\nAlice: How are you?";
    expect(stripNamePrefix(text, "Alice")).toBe("Hello\nHow are you?");
  });

  test("only strips at line start", () => {
    const text = "She said Alice: hi";
    expect(stripNamePrefix(text, "Alice")).toBe("She said Alice: hi");
  });

  test("leaves text without prefix unchanged", () => {
    expect(stripNamePrefix("Hello there!", "Alice")).toBe("Hello there!");
  });

  test("handles name with regex special characters", () => {
    expect(stripNamePrefix("A.B: test", "A.B")).toBe("test");
    // The dot should be literal, not wildcard
    expect(stripNamePrefix("AXB: test", "A.B")).toBe("AXB: test");
  });

  test("strips extra whitespace after prefix", () => {
    expect(stripNamePrefix("Alice:   Hello", "Alice")).toBe("Hello");
  });
});

// =============================================================================
// stripNamePrefixFromStream
// =============================================================================

describe("stripNamePrefixFromStream", () => {
  test("strips prefix from streamed chunks", async () => {
    const stream = fromChunks(["Ali", "ce: Hel", "lo!"]);
    const result = await collectStream(stripNamePrefixFromStream(stream, "Alice"));
    expect(result).toBe("Hello!");
  });

  test("strips prefix from multiple lines", async () => {
    const stream = fromChunks(["Alice: Line 1\nAlice: Line 2"]);
    const result = await collectStream(stripNamePrefixFromStream(stream, "Alice"));
    expect(result).toBe("Line 1\nLine 2");
  });

  test("passes through text without prefix", async () => {
    const stream = fromChunks(["Hello world"]);
    const result = await collectStream(stripNamePrefixFromStream(stream, "Alice"));
    expect(result).toBe("Hello world");
  });

  test("inserts boundary character between Name: segments", async () => {
    const stream = fromChunks(["Alice: First\nAlice: Second"]);
    const result = await collectStream(stripNamePrefixFromStream(stream, "Alice", NAME_BOUNDARY));
    expect(result).toBe(`First${NAME_BOUNDARY}Second`);
  });

  test("handles empty stream", async () => {
    const stream = fromChunks([]);
    const result = await collectStream(stripNamePrefixFromStream(stream, "Alice"));
    expect(result).toBe("");
  });

  test("handles prefix split across chunks", async () => {
    const stream = fromChunks(["**Al", "ice:** ", "content"]);
    const result = await collectStream(stripNamePrefixFromStream(stream, "Alice"));
    expect(result).toBe("content");
  });
});

// =============================================================================
// parseNamePrefixResponse
// =============================================================================

describe("parseNamePrefixResponse", () => {
  const alice = makeEntity({ name: "Alice", id: 1 });
  const bob = makeEntity({ name: "Bob", id: 2 });

  test("returns undefined for single entity", () => {
    expect(parseNamePrefixResponse("Alice: Hello", [alice])).toBeUndefined();
  });

  test("returns undefined when no name prefixes found", () => {
    expect(parseNamePrefixResponse("Just some text", [alice, bob])).toBeUndefined();
  });

  test("parses two-entity response", () => {
    const response = "Alice: Hello!\nBob: Hi there!";
    const result = parseNamePrefixResponse(response, [alice, bob]);
    expect(result).toBeDefined();
    expect(result!.length).toBe(2);
    expect(result![0].name).toBe("Alice");
    expect(result![0].content).toBe("Hello!");
    expect(result![0].entityId).toBe(1);
    expect(result![1].name).toBe("Bob");
    expect(result![1].content).toBe("Hi there!");
    expect(result![1].entityId).toBe(2);
  });

  test("handles bold name prefixes", () => {
    const response = "**Alice:** Hello!\n**Bob:** Hi!";
    const result = parseNamePrefixResponse(response, [alice, bob]);
    expect(result).toBeDefined();
    expect(result!.length).toBe(2);
    expect(result![0].content).toBe("Hello!");
    expect(result![1].content).toBe("Hi!");
  });

  test("handles multi-line content per entity", () => {
    const response = "Alice: Line 1\nLine 2\nBob: Response";
    const result = parseNamePrefixResponse(response, [alice, bob]);
    expect(result).toBeDefined();
    expect(result![0].content).toBe("Line 1\nLine 2");
    expect(result![1].content).toBe("Response");
  });

  test("is case-insensitive", () => {
    const response = "ALICE: Hello\nbob: Hi";
    const result = parseNamePrefixResponse(response, [alice, bob]);
    expect(result).toBeDefined();
    expect(result!.length).toBe(2);
  });

  test("skips empty content segments", () => {
    const response = "Alice: \nBob: Hi";
    const result = parseNamePrefixResponse(response, [alice, bob]);
    expect(result).toBeDefined();
    // Alice's segment is empty/whitespace, so only Bob
    expect(result!.length).toBe(1);
    expect(result![0].name).toBe("Bob");
  });

  test("includes avatarUrl and streamMode from entity", () => {
    const aliceWithAvatar = makeEntity({
      name: "Alice", id: 1,
      avatarUrl: "https://example.com/alice.png",
      streamMode: "lines",
    });
    const response = "Alice: Hello\nBob: Hi";
    const result = parseNamePrefixResponse(response, [aliceWithAvatar, bob]);
    expect(result![0].avatarUrl).toBe("https://example.com/alice.png");
    expect(result![0].streamMode).toBe("lines");
    expect(result![1].avatarUrl).toBeUndefined();
    expect(result![1].streamMode).toBeNull();
  });

  test("returns undefined when empty array", () => {
    expect(parseNamePrefixResponse("text", [])).toBeUndefined();
  });
});
