import { describe, test, expect } from "bun:test";
import { formatOutfitForContext, type OutfitData } from ".";

// --- formatOutfitForContext ---

describe("formatOutfitForContext", () => {
  test("returns empty string for null", () => {
    expect(formatOutfitForContext(null)).toBe("");
  });

  test("formats freeform description only", () => {
    const outfit: OutfitData = {
      description: "A flowing red dress with gold trim",
    };
    const result = formatOutfitForContext(outfit);
    expect(result).toContain("Outfit: A flowing red dress with gold trim");
  });

  test("formats structured items only", () => {
    const outfit: OutfitData = {
      items: [
        { name: "Leather boots", slot: "feet" },
        { name: "Iron helm", slot: "head" },
      ],
    };
    const result = formatOutfitForContext(outfit);
    expect(result).toContain("Wearing:");
    expect(result).toContain("Leather boots (feet)");
    expect(result).toContain("Iron helm (head)");
  });

  test("formats items without slots", () => {
    const outfit: OutfitData = {
      items: [{ name: "Cloak" }],
    };
    const result = formatOutfitForContext(outfit);
    expect(result).toContain("Wearing: Cloak");
    expect(result).not.toContain("(");
  });

  test("formats both items and description", () => {
    const outfit: OutfitData = {
      description: "Battle-worn and travel-stained",
      items: [{ name: "Chainmail", slot: "body" }],
    };
    const result = formatOutfitForContext(outfit);
    expect(result).toContain("Wearing: Chainmail (body)");
    expect(result).toContain("Outfit: Battle-worn and travel-stained");
  });

  test("handles empty items array", () => {
    const outfit: OutfitData = {
      items: [],
      description: "Simple clothes",
    };
    const result = formatOutfitForContext(outfit);
    expect(result).not.toContain("Wearing:");
    expect(result).toContain("Outfit: Simple clothes");
  });

  test("returns empty string for empty outfit", () => {
    const outfit: OutfitData = {};
    expect(formatOutfitForContext(outfit)).toBe("");
  });
});
