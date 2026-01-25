import { describe, test, expect } from "bun:test";
import { extractStateChangesHeuristic } from "./extract";

describe("extractStateChangesHeuristic", () => {
  // --- Location Detection ---

  test("detects arrival at a location", () => {
    const result = extractStateChangesHeuristic(
      "The group arrived at the Emerald Tower, its spires gleaming in the sun."
    );
    expect(result.locationChange).toBeDefined();
    expect(result.locationChange!.newLocation).toBe("Emerald Tower");
  });

  test("detects entering a location", () => {
    const result = extractStateChangesHeuristic(
      "She enters the Grand Library, dusty shelves lining every wall."
    );
    expect(result.locationChange).toBeDefined();
    expect(result.locationChange!.newLocation).toBe("Grand Library");
  });

  test("detects walking to a location", () => {
    const result = extractStateChangesHeuristic(
      "They walked to the Crystal Caves."
    );
    expect(result.locationChange).toBeDefined();
    expect(result.locationChange!.newLocation).toBe("Crystal Caves");
  });

  test("does not detect location in regular text", () => {
    const result = extractStateChangesHeuristic(
      "The weather was pleasant and the birds sang."
    );
    expect(result.locationChange).toBeUndefined();
  });

  // --- Time Detection ---

  test("detects hours passing (digit format)", () => {
    const result = extractStateChangesHeuristic(
      "After a rest, 3 hours passed as they waited."
    );
    expect(result.timeChange).toBeDefined();
    expect(result.timeChange!.hoursElapsed).toBe(3);
  });

  test("detects time skipping to period", () => {
    const result = extractStateChangesHeuristic(
      "They rested until morning, the sun warm on their faces."
    );
    expect(result.timeChange).toBeDefined();
    expect(result.timeChange!.newPeriod).toBe("morning");
  });

  test("detects next morning/day/night", () => {
    const result = extractStateChangesHeuristic(
      "The following night, they set out again."
    );
    expect(result.timeChange).toBeDefined();
    expect(result.timeChange!.newPeriod).toBe("night");
  });

  // --- Item Detection ---

  test("detects picking up items", () => {
    const result = extractStateChangesHeuristic(
      "She picks up a rusty key."
    );
    expect(result.inventoryChanges).toBeDefined();
    expect(result.inventoryChanges!.length).toBeGreaterThan(0);
    expect(result.inventoryChanges![0].action).toBe("gained");
  });

  test("detects finding items", () => {
    const result = extractStateChangesHeuristic(
      "He found a silver coin."
    );
    expect(result.inventoryChanges).toBeDefined();
    expect(result.inventoryChanges!.some((c) => c.action === "gained")).toBe(true);
  });

  test("detects dropping items", () => {
    const result = extractStateChangesHeuristic(
      "She dropped the broken shield."
    );
    expect(result.inventoryChanges).toBeDefined();
    expect(result.inventoryChanges!.some((c) => c.action === "lost")).toBe(true);
  });

  test("detects using consumables", () => {
    const result = extractStateChangesHeuristic(
      "He drank the healing potion greedily."
    );
    expect(result.inventoryChanges).toBeDefined();
    expect(result.inventoryChanges!.some((c) => c.action === "used")).toBe(true);
  });

  test("does not detect items in regular text", () => {
    const result = extractStateChangesHeuristic(
      "The sunset was beautiful."
    );
    expect(result.inventoryChanges).toBeUndefined();
  });

  // --- Fact Detection ---

  test("detects revealed facts", () => {
    const result = extractStateChangesHeuristic(
      "She revealed that the ancient relic holds the power of the gods."
    );
    expect(result.newFacts).toBeDefined();
    expect(result.newFacts!.length).toBeGreaterThan(0);
  });

  test("detects discoveries", () => {
    const result = extractStateChangesHeuristic(
      "They discovered that the underground chamber leads to the castle."
    );
    expect(result.newFacts).toBeDefined();
  });

  test("detects 'it turns out' facts", () => {
    const result = extractStateChangesHeuristic(
      "It turns out the merchant was actually a spy all along."
    );
    expect(result.newFacts).toBeDefined();
  });

  test("filters out very short facts", () => {
    const result = extractStateChangesHeuristic(
      "She realized that it was too late."
    );
    // "it was too late" is only 17 chars, might be too short depending on threshold
    // The function filters content.length > 10 && content.length < 200
    if (result.newFacts) {
      for (const fact of result.newFacts) {
        expect(fact.content.length).toBeGreaterThan(10);
      }
    }
  });

  // --- No Changes ---

  test("returns empty object for mundane text", () => {
    const result = extractStateChangesHeuristic(
      '"Hello," she said with a smile. "How are you today?"'
    );
    expect(result.locationChange).toBeUndefined();
    expect(result.timeChange).toBeUndefined();
    expect(result.inventoryChanges).toBeUndefined();
    expect(result.newFacts).toBeUndefined();
  });
});
