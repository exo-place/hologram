import { describe, test, expect } from "bun:test";
import {
  mergeConfig,
  getConfigValue,
  setConfigValue,
  parseConfigValue,
  isFeatureEnabled,
  applyPreset,
  features,
  DEFAULT_CONFIG,
} from "./defaults";

// --- mergeConfig ---

describe("mergeConfig", () => {
  test("returns defaults when partial is null", () => {
    const result = mergeConfig(null);
    expect(result.multiCharMode).toBe(DEFAULT_CONFIG.multiCharMode);
    // Default is now minimal (chronicle disabled)
    expect(result.chronicle.enabled).toBe(false);
  });

  test("returns defaults when partial is undefined", () => {
    const result = mergeConfig(undefined);
    expect(result.chronicle.autoExtract).toBe(true); // autoExtract default is still true
  });

  test("overrides top-level properties", () => {
    const result = mergeConfig({ multiCharMode: "webhooks" });
    expect(result.multiCharMode).toBe("webhooks");
  });

  test("merges nested chronicle config", () => {
    const result = mergeConfig({
      chronicle: { autoExtract: false },
    });
    expect(result.chronicle.autoExtract).toBe(false);
    // Other chronicle fields should be preserved from defaults
    expect(result.chronicle.enabled).toBe(false); // Default is now false
    expect(result.chronicle.periodicSummary).toBe(true);
  });

  test("merges deeply nested scenes.boundaries", () => {
    const result = mergeConfig({
      scenes: { boundaries: { onLocationChange: "new_scene" } },
    });
    expect(result.scenes.boundaries.onLocationChange).toBe("new_scene");
    // Other boundary fields preserved
    expect(result.scenes.boundaries.onTimeSkip).toBe("continue");
  });

  test("preserves unrelated sections", () => {
    const result = mergeConfig({ inventory: { enabled: true } });
    expect(result.inventory.enabled).toBe(true);
    // Chronicle should be untouched (default is false now)
    expect(result.chronicle.enabled).toBe(false);
    expect(result.time.enabled).toBe(false); // Default is now false
  });
});

// --- getConfigValue ---

describe("getConfigValue", () => {
  test("gets top-level value", () => {
    expect(getConfigValue(DEFAULT_CONFIG, "multiCharMode")).toBe("auto");
  });

  test("gets nested value", () => {
    expect(getConfigValue(DEFAULT_CONFIG, "chronicle.autoExtract")).toBe(true);
  });

  test("gets deeply nested value", () => {
    expect(getConfigValue(DEFAULT_CONFIG, "scenes.boundaries.onLocationChange")).toBe("continue");
  });

  test("returns undefined for invalid path", () => {
    expect(getConfigValue(DEFAULT_CONFIG, "nonexistent.path")).toBeUndefined();
  });

  test("returns undefined for partial invalid path", () => {
    expect(getConfigValue(DEFAULT_CONFIG, "chronicle.nonexistent")).toBeUndefined();
  });
});

// --- setConfigValue ---

describe("setConfigValue", () => {
  test("sets top-level value", () => {
    const result = setConfigValue(DEFAULT_CONFIG, "multiCharMode", "webhooks");
    expect(result.multiCharMode).toBe("webhooks");
    // Original unchanged
    expect(DEFAULT_CONFIG.multiCharMode).toBe("auto");
  });

  test("sets nested value", () => {
    const result = setConfigValue(DEFAULT_CONFIG, "chronicle.autoExtract", false);
    expect(result.chronicle.autoExtract).toBe(false);
  });

  test("sets deeply nested value", () => {
    const result = setConfigValue(
      DEFAULT_CONFIG,
      "scenes.boundaries.onLocationChange",
      "new_scene"
    );
    expect(result.scenes.boundaries.onLocationChange).toBe("new_scene");
  });

  test("does not mutate original config", () => {
    const original = { ...DEFAULT_CONFIG };
    setConfigValue(DEFAULT_CONFIG, "chronicle.enabled", false);
    expect(DEFAULT_CONFIG.chronicle.enabled).toBe(original.chronicle.enabled);
  });
});

// --- parseConfigValue ---

describe("parseConfigValue", () => {
  test("parses booleans", () => {
    expect(parseConfigValue("true")).toBe(true);
    expect(parseConfigValue("false")).toBe(false);
  });

  test("parses numbers", () => {
    expect(parseConfigValue("42")).toBe(42);
    expect(parseConfigValue("3.14")).toBe(3.14);
    expect(parseConfigValue("0")).toBe(0);
  });

  test("parses comma-separated arrays", () => {
    const result = parseConfigValue("a,b,c") as string[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("parses mixed-type arrays", () => {
    const result = parseConfigValue("true,42,hello") as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([true, 42, "hello"]);
  });

  test("returns string for plain text", () => {
    expect(parseConfigValue("hello")).toBe("hello");
  });
});

// --- isFeatureEnabled ---

describe("isFeatureEnabled", () => {
  test("returns false for disabled features (minimal defaults)", () => {
    // Default is now minimal - most features disabled
    expect(isFeatureEnabled(DEFAULT_CONFIG, "chronicle")).toBe(false);
    expect(isFeatureEnabled(DEFAULT_CONFIG, "scenes")).toBe(false);
  });

  test("returns true for explicitly enabled features", () => {
    const config = mergeConfig({ chronicle: { enabled: true } });
    expect(isFeatureEnabled(config, "chronicle")).toBe(true);
  });

  test("returns false for disabled features", () => {
    const config = mergeConfig({ characterState: { enabled: false } });
    expect(isFeatureEnabled(config, "characterState")).toBe(false);
  });

  test("returns true for non-subsystem properties", () => {
    expect(isFeatureEnabled(DEFAULT_CONFIG, "multiCharMode")).toBe(true);
  });
});

// --- applyPreset ---

describe("applyPreset", () => {
  test("applies minimal preset", () => {
    const result = applyPreset("minimal");
    expect(result.chronicle.enabled).toBe(false);
    expect(result.scenes.enabled).toBe(false);
    expect(result.inventory.enabled).toBe(false);
  });

  test("applies full preset", () => {
    const result = applyPreset("full");
    expect(result.chronicle.enabled).toBe(true);
    expect(result.chronicle.autoExtract).toBe(true);
    expect(result.inventory.useEquipment).toBe(true);
  });

  test("throws for unknown preset", () => {
    expect(() => applyPreset("nonexistent")).toThrow();
  });
});

// --- features (helper functions) ---

describe("features helpers", () => {
  test("chronicle checks enabled flag", () => {
    // Default is now minimal - chronicle disabled
    expect(features.chronicle(DEFAULT_CONFIG)).toBe(false);
    const enabled = mergeConfig({ chronicle: { enabled: true } });
    expect(features.chronicle(enabled)).toBe(true);
  });

  test("autoExtract requires chronicle + autoExtract", () => {
    // Default chronicle is disabled, so autoExtract is false
    expect(features.autoExtract(DEFAULT_CONFIG)).toBe(false);
    const withChronicle = mergeConfig({ chronicle: { enabled: true, autoExtract: true } });
    expect(features.autoExtract(withChronicle)).toBe(true);
    const noExtract = mergeConfig({ chronicle: { enabled: true, autoExtract: false } });
    expect(features.autoExtract(noExtract)).toBe(false);
  });

  test("equipment requires inventory + useEquipment", () => {
    expect(features.equipment(DEFAULT_CONFIG)).toBe(false); // Default has useEquipment: false
    const withEquip = mergeConfig({
      inventory: { enabled: true, useEquipment: true },
    });
    expect(features.equipment(withEquip)).toBe(true);
  });

  test("combat requires dice + useCombat", () => {
    expect(features.combat(DEFAULT_CONFIG)).toBe(false);
    const withCombat = mergeConfig({
      dice: { enabled: true, useCombat: true },
    });
    expect(features.combat(withCombat)).toBe(true);
  });
});
