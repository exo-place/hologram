import { describe, test, expect } from "bun:test";
import { getAffinityLabel } from ".";

// --- getAffinityLabel ---

describe("getAffinityLabel", () => {
  test("returns Hatred for -100", () => {
    expect(getAffinityLabel(-100)).toBe("Hatred");
  });

  test("returns Dislike for -50", () => {
    expect(getAffinityLabel(-50)).toBe("Dislike");
  });

  test("returns Neutral for 0", () => {
    expect(getAffinityLabel(0)).toBe("Neutral");
  });

  test("returns Friendly for 50", () => {
    expect(getAffinityLabel(50)).toBe("Friendly");
  });

  test("returns Love for 100", () => {
    expect(getAffinityLabel(100)).toBe("Love");
  });

  test("returns correct label for in-between values", () => {
    // -75 is >= -100 (Hatred) and < -50, so Hatred
    expect(getAffinityLabel(-75)).toBe("Hatred");
    // 25 is >= 0 (Neutral) and < 50, so Neutral
    expect(getAffinityLabel(25)).toBe("Neutral");
    // 75 is >= 50 (Friendly) and < 100, so Friendly
    expect(getAffinityLabel(75)).toBe("Friendly");
  });

  test("uses custom config labels", () => {
    const config = {
      enabled: true,
      useAffinity: true,
      affinityRange: [-10, 10] as [number, number],
      affinityLabels: { "-10": "Enemy", "0": "Stranger", "10": "Ally" },
      useFactions: false,
      relationshipTypes: [],
    };
    expect(getAffinityLabel(-10, config)).toBe("Enemy");
    expect(getAffinityLabel(0, config)).toBe("Stranger");
    expect(getAffinityLabel(10, config)).toBe("Ally");
  });

  test("returns Unknown for value below all thresholds", () => {
    // -200 < -100 (lowest threshold), no match
    expect(getAffinityLabel(-200)).toBe("Unknown");
  });
});
