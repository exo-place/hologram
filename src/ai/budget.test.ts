import { describe, test, expect } from "bun:test";
import {
  estimateTokens,
  estimateMessageTokens,
  allocateBudget,
  buildContextSections,
  ContextPriority,
  type BudgetSection,
} from "./budget";

// --- estimateTokens ---

describe("estimateTokens", () => {
  test("estimates empty string as 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("estimates 4 chars as 1 token", () => {
    expect(estimateTokens("abcd")).toBe(1);
  });

  test("rounds up fractional tokens", () => {
    expect(estimateTokens("ab")).toBe(1); // 2/4 = 0.5, ceil = 1
    expect(estimateTokens("abcde")).toBe(2); // 5/4 = 1.25, ceil = 2
  });

  test("handles long text", () => {
    const text = "a".repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});

// --- estimateMessageTokens ---

describe("estimateMessageTokens", () => {
  test("estimates single message", () => {
    const tokens = estimateMessageTokens([
      { role: "user", content: "Hello" },
    ]);
    // 4 (overhead) + ceil(5/4) = 4 + 2 = 6
    expect(tokens).toBe(6);
  });

  test("estimates multiple messages", () => {
    const tokens = estimateMessageTokens([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
    // (4 + ceil(2/4)) + (4 + ceil(5/4)) = 5 + 6 = 11
    expect(tokens).toBe(11);
  });

  test("accounts for name field", () => {
    const withName = estimateMessageTokens([
      { role: "user", content: "Hi", name: "Alice" },
    ]);
    const withoutName = estimateMessageTokens([
      { role: "user", content: "Hi" },
    ]);
    // Name adds estimateTokens("Alice") + 1 = ceil(5/4) + 1 = 3
    expect(withName).toBe(withoutName + 3);
  });

  test("returns 0 for empty array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });
});

// --- allocateBudget ---

describe("allocateBudget", () => {
  test("includes all sections when budget allows", () => {
    const sections: BudgetSection[] = [
      { name: "a", content: "short", priority: 100 },
      { name: "b", content: "also short", priority: 50 },
    ];
    const result = allocateBudget(sections, 10000, 0);
    expect(result.sections).toHaveLength(2);
    expect(result.droppedSections).toHaveLength(0);
  });

  test("orders by priority (highest first)", () => {
    const sections: BudgetSection[] = [
      { name: "low", content: "content", priority: 10 },
      { name: "high", content: "content", priority: 100 },
    ];
    const result = allocateBudget(sections, 10000, 0);
    expect(result.sections[0].name).toBe("high");
    expect(result.sections[1].name).toBe("low");
  });

  test("drops sections that exceed budget", () => {
    const bigContent = "x".repeat(4000); // ~1000 tokens
    const sections: BudgetSection[] = [
      { name: "high", content: "short", priority: 100 },
      { name: "low", content: bigContent, priority: 10 },
    ];
    const result = allocateBudget(sections, 100, 0); // Only 100 tokens
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe("high");
    expect(result.droppedSections).toContain("low");
  });

  test("truncates sections that can be truncated", () => {
    const bigContent = "x".repeat(4000);
    const sections: BudgetSection[] = [
      { name: "high", content: "short", priority: 100 },
      { name: "truncatable", content: bigContent, priority: 50, canTruncate: true, minTokens: 10 },
    ];
    const result = allocateBudget(sections, 200, 0);
    expect(result.truncatedSections).toContain("truncatable");
    expect(result.sections).toHaveLength(2);
  });

  test("reserves budget for messages", () => {
    const content = "x".repeat(800); // ~200 tokens
    const sections: BudgetSection[] = [
      { name: "a", content, priority: 100 },
    ];
    // Total 300, reserve 200 = only 100 available, can't fit 200 tokens
    const result = allocateBudget(sections, 300, 200);
    expect(result.droppedSections).toContain("a");
  });

  test("returns empty for no sections", () => {
    const result = allocateBudget([], 1000);
    expect(result.sections).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });
});

// --- buildContextSections ---

describe("buildContextSections", () => {
  test("builds sections from all params", () => {
    const sections = buildContextSections({
      characterSection: "Alice is brave",
      worldSection: "Medieval world",
      inventorySection: "Sword, shield",
      relationshipsSection: "Knows Bob",
      memorySection: "Met dragon",
      otherCharactersSection: "Bob nearby",
      sceneSection: "In a tavern",
      eventsSection: "Thunder rumbles",
      customInstructions: "Be concise",
    });
    expect(sections).toHaveLength(9);
  });

  test("skips undefined params", () => {
    const sections = buildContextSections({
      characterSection: "Alice",
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("character");
  });

  test("assigns correct priorities", () => {
    const sections = buildContextSections({
      characterSection: "Alice",
      customInstructions: "Instructions",
      memorySection: "Some memory",
    });

    const charSection = sections.find((s) => s.name === "character");
    const instrSection = sections.find((s) => s.name === "instructions");
    const memSection = sections.find((s) => s.name === "memory");

    expect(charSection!.priority).toBe(ContextPriority.CHARACTER_PERSONA);
    expect(instrSection!.priority).toBe(ContextPriority.SYSTEM_INSTRUCTIONS);
    expect(memSection!.priority).toBe(ContextPriority.RAG_RESULTS);
  });

  test("returns empty for no params", () => {
    const sections = buildContextSections({});
    expect(sections).toHaveLength(0);
  });

  test("marks character as truncatable with minTokens", () => {
    const sections = buildContextSections({
      characterSection: "A very detailed character description",
    });
    expect(sections[0].canTruncate).toBe(true);
    expect(sections[0].minTokens).toBe(200);
  });

  test("marks instructions as non-truncatable", () => {
    const sections = buildContextSections({
      customInstructions: "Must follow these rules",
    });
    expect(sections[0].canTruncate).toBe(false);
  });
});
