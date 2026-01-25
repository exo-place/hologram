import { describe, test, expect } from "bun:test";
import { parseMultiCharResponse, formatMultiCharOutput } from "./webhooks";

// --- parseMultiCharResponse ---

describe("parseMultiCharResponse", () => {
  test("parses two-character response", () => {
    const text = '**Alice:** "Hello there!" **Bob:** "Hey Alice!"';
    const result = parseMultiCharResponse(text, ["Alice", "Bob"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].characterName).toBe("Alice");
    expect(result![0].content).toContain("Hello there!");
    expect(result![1].characterName).toBe("Bob");
    expect(result![1].content).toContain("Hey Alice!");
  });

  test("parses three-character response", () => {
    const text =
      '**Alice:** "Hi!" **Bob:** "Hello!" **Carol:** "Hey everyone!"';
    const result = parseMultiCharResponse(text, ["Alice", "Bob", "Carol"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
  });

  test("returns null for single-character list", () => {
    const text = '**Alice:** "Hello"';
    const result = parseMultiCharResponse(text, ["Alice"]);
    expect(result).toBeNull();
  });

  test("returns null for no matches", () => {
    const text = "Just some plain text without character tags.";
    const result = parseMultiCharResponse(text, ["Alice", "Bob"]);
    expect(result).toBeNull();
  });

  test("handles multiline content per character", () => {
    const text = [
      "**Alice:** She looked around nervously.",
      '"I don\'t think we should be here."',
      "",
      '**Bob:** "Relax," he said with a grin.',
    ].join("\n");
    const result = parseMultiCharResponse(text, ["Alice", "Bob"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].content).toContain("don't think");
    expect(result![1].content).toContain("Relax");
  });

  test("handles names with special regex characters", () => {
    const text =
      '**Dr. Smith:** "Hello." **Ms. Jones:** "Hi."';
    const result = parseMultiCharResponse(text, ["Dr. Smith", "Ms. Jones"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
  });

  test("skips content before first tag", () => {
    const text =
      'The room was quiet. **Alice:** "Hello." **Bob:** "Hi."';
    const result = parseMultiCharResponse(text, ["Alice", "Bob"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // The pre-tag content should not appear in any segment
    expect(result![0].characterName).toBe("Alice");
  });

  test("ignores unknown character names", () => {
    const text =
      '**Alice:** "Hello." **Unknown:** "Hi." **Bob:** "Hey."';
    const result = parseMultiCharResponse(text, ["Alice", "Bob"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // Unknown's content should be part of Alice's segment
    expect(result![0].content).toContain("Unknown");
  });

  test("empty segments are skipped", () => {
    const text = "**Alice:** **Bob:** Hello!";
    const result = parseMultiCharResponse(text, ["Alice", "Bob"]);

    expect(result).not.toBeNull();
    // Alice has no content, should be skipped
    expect(result!.length).toBeGreaterThanOrEqual(1);
    expect(result![result!.length - 1].characterName).toBe("Bob");
  });
});

// --- formatMultiCharOutput ---

describe("formatMultiCharOutput", () => {
  const responses = [
    { characterId: 1, characterName: "Alice", content: '"Hello!"' },
    { characterId: 2, characterName: "Bob", content: '"Hi there!"' },
  ];

  test("tagged mode uses bold character names", () => {
    const result = formatMultiCharOutput(responses, "tagged");
    expect(result).toContain("**Alice:**");
    expect(result).toContain("**Bob:**");
    expect(result).toContain('"Hello!"');
    expect(result).toContain('"Hi there!"');
  });

  test("narrator mode uses character name as prefix", () => {
    const result = formatMultiCharOutput(responses, "narrator");
    expect(result).toContain("Alice ");
    expect(result).toContain("Bob ");
    // Should not have bold markers for narrator
    expect(result).not.toContain("**Alice:**");
  });

  test("segments are separated by double newlines", () => {
    const result = formatMultiCharOutput(responses, "tagged");
    expect(result).toContain("\n\n");
  });
});
