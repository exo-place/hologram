import { describe, test, expect } from "bun:test";
import { parseExplicitMemories, formatEntriesForContext, type ChronicleEntry } from ".";

// --- parseExplicitMemories ---

describe("parseExplicitMemories", () => {
  test("parses ```memory blocks", () => {
    const text = "Some text\n```memory\nAlice met Bob at the tavern.\n```\nMore text";
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Alice met Bob at the tavern.");
    expect(result[0].type).toBe("note");
  });

  test("parses multiple ```memory blocks", () => {
    const text = [
      "```memory",
      "Fact one",
      "```",
      "middle text",
      "```memory",
      "Fact two",
      "```",
    ].join("\n");
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Fact one");
    expect(result[1].content).toBe("Fact two");
  });

  test("parses [[remember: ...]] markers", () => {
    const text = "She said [[remember: The password is dragon123]] and left.";
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("The password is dragon123");
    expect(result[0].type).toBeUndefined(); // No type specified for remember
  });

  test("parses [[fact: ...]] markers", () => {
    const text = "He revealed [[fact: The castle was built 300 years ago]] during conversation.";
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("The castle was built 300 years ago");
    expect(result[0].type).toBe("fact");
  });

  test("parses mixed marker types", () => {
    const text = [
      "```memory",
      "Alice is the queen",
      "```",
      "She whispered [[remember: The secret passage is behind the painting]]",
      "And mentioned [[fact: The kingdom has 12 provinces]]",
    ].join("\n");
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(3);
  });

  test("returns empty array for text without markers", () => {
    const result = parseExplicitMemories("Just regular text with no markers.");
    expect(result).toHaveLength(0);
  });

  test("handles case-insensitive markers", () => {
    const text = "Note: [[Remember: Something important]] and [[FACT: Another thing]]";
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(2);
  });

  test("trims whitespace from content", () => {
    const text = "```memory\n  Spaced content  \n```";
    const result = parseExplicitMemories(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Spaced content");
  });
});

// --- formatEntriesForContext ---

describe("formatEntriesForContext", () => {
  const makeEntry = (content: string, type: ChronicleEntry["type"] = "fact", importance = 5): ChronicleEntry => ({
    id: 1,
    sceneId: 1,
    worldId: 1,
    type,
    content,
    importance,
    perspective: "shared",
    visibility: "public" as const,
    source: "auto" as const,
    sourceMessageId: null,
    createdAt: Date.now(),
  });

  test("formats entries as markdown list", () => {
    const result = formatEntriesForContext([
      makeEntry("Alice is the queen"),
      makeEntry("The castle has 7 towers"),
    ]);

    expect(result).toContain("## Memory");
    expect(result).toContain("- Alice is the queen");
    expect(result).toContain("- The castle has 7 towers");
  });

  test("includes type labels when requested", () => {
    const result = formatEntriesForContext(
      [makeEntry("Something happened", "event")],
      { includeType: true }
    );

    expect(result).toContain("[event]");
  });

  test("includes importance when requested", () => {
    const result = formatEntriesForContext(
      [makeEntry("Important fact", "fact", 8)],
      { includeImportance: true }
    );

    expect(result).toContain("(8/10)");
  });

  test("returns empty string for no entries", () => {
    expect(formatEntriesForContext([])).toBe("");
  });
});
