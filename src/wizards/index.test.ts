import { describe, test, expect } from "bun:test";
import {
  getWizardFlow,
  getTotalSteps,
  isWizardComplete,
  interpolatePrompt,
  encodeWizardAction,
  decodeWizardAction,
  formatWizardProgress,
  WIZARD_FLOWS,
  type WizardSession,
  type WizardType,
} from ".";
import type { WorldConfig } from "../config/types";
import { DEFAULT_CONFIG } from "../config/defaults";

// --- getWizardFlow / buildItemFlow ---

describe("getWizardFlow", () => {
  test("returns character flow (static)", () => {
    const flow = getWizardFlow("character");
    expect(flow.length).toBeGreaterThanOrEqual(3);
    expect(flow[0].field).toBe("name");
    expect(flow[1].field).toBe("persona");
  });

  test("returns world flow (static)", () => {
    const flow = getWizardFlow("world");
    expect(flow.length).toBeGreaterThanOrEqual(3);
    expect(flow[0].field).toBe("name");
    expect(flow[1].field).toBe("description");
  });

  test("returns location flow (static)", () => {
    const flow = getWizardFlow("location");
    expect(flow.length).toBeGreaterThanOrEqual(2);
    expect(flow[0].field).toBe("name");
  });

  test("returns item base flow without config", () => {
    const flow = getWizardFlow("item");
    // Without config: Name, Description, Type, Effect (no equipment/TF/durability steps)
    const fields = flow.map((s) => s.field);
    expect(fields).toContain("name");
    expect(fields).toContain("description");
    expect(fields).toContain("itemType");
    expect(fields).toContain("effect");
    expect(fields).not.toContain("equipSlot");
    expect(fields).not.toContain("transformation");
    expect(fields).not.toContain("maxDurability");
  });

  test("item flow adds equipment steps when useEquipment is enabled", () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      inventory: {
        ...DEFAULT_CONFIG.inventory,
        enabled: true,
        useEquipment: true,
        equipmentSlots: ["mainhand", "head"],
      },
    };

    const flow = getWizardFlow("item", config);
    const fields = flow.map((s) => s.field);
    expect(fields).toContain("equipSlot");
    expect(fields).toContain("stats");
  });

  test("item flow adds applied effect step when useEffects is enabled", () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      characterState: {
        ...DEFAULT_CONFIG.characterState,
        useEffects: true,
      },
    };

    const flow = getWizardFlow("item", config);
    const fields = flow.map((s) => s.field);
    expect(fields).toContain("appliedEffect");
  });

  test("item flow adds TF steps when useForms is enabled", () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      characterState: {
        ...DEFAULT_CONFIG.characterState,
        useForms: true,
      },
    };

    const flow = getWizardFlow("item", config);
    const fields = flow.map((s) => s.field);
    expect(fields).toContain("requirements");
    expect(fields).toContain("transformation");
  });

  test("item flow adds durability step when useDurability is enabled", () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      inventory: {
        ...DEFAULT_CONFIG.inventory,
        useDurability: true,
      },
    };

    const flow = getWizardFlow("item", config);
    const fields = flow.map((s) => s.field);
    expect(fields).toContain("maxDurability");
  });

  test("item flow with all features enabled has maximum steps", () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      inventory: {
        ...DEFAULT_CONFIG.inventory,
        useEquipment: true,
        useDurability: true,
      },
      characterState: {
        ...DEFAULT_CONFIG.characterState,
        useEffects: true,
        useForms: true,
      },
    };

    const minimal = getWizardFlow("item");
    const full = getWizardFlow("item", config);
    expect(full.length).toBeGreaterThan(minimal.length);
  });
});

// --- WIZARD_FLOWS ---

describe("WIZARD_FLOWS", () => {
  test("has all four types", () => {
    expect(WIZARD_FLOWS).toHaveProperty("character");
    expect(WIZARD_FLOWS).toHaveProperty("world");
    expect(WIZARD_FLOWS).toHaveProperty("location");
    expect(WIZARD_FLOWS).toHaveProperty("item");
  });

  test("all flows have required first step", () => {
    for (const type of ["character", "world", "location", "item"] as WizardType[]) {
      const flow = WIZARD_FLOWS[type];
      expect(flow[0].required).toBe(true);
      expect(flow[0].field).toBe("name");
    }
  });
});

// --- getTotalSteps ---

describe("getTotalSteps", () => {
  test("matches flow length for static types", () => {
    expect(getTotalSteps("character")).toBe(getWizardFlow("character").length);
    expect(getTotalSteps("world")).toBe(getWizardFlow("world").length);
    expect(getTotalSteps("location")).toBe(getWizardFlow("location").length);
  });

  test("item steps increase with config features", () => {
    const base = getTotalSteps("item");
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      inventory: { ...DEFAULT_CONFIG.inventory, useEquipment: true, useDurability: true },
      characterState: { ...DEFAULT_CONFIG.characterState, useEffects: true, useForms: true },
    };
    const full = getTotalSteps("item", config);
    expect(full).toBeGreaterThan(base);
  });
});

// --- isWizardComplete ---

describe("isWizardComplete", () => {
  const makeSession = (type: WizardType, data: Record<string, unknown>): WizardSession => ({
    id: "test",
    type,
    userId: "u1",
    channelId: "c1",
    worldId: null,
    step: 0,
    data,
    aiSuggestions: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  });

  test("character: incomplete without name", () => {
    expect(isWizardComplete(makeSession("character", {}))).toBe(false);
  });

  test("character: incomplete with name but no persona", () => {
    expect(isWizardComplete(makeSession("character", { name: "Alice" }))).toBe(false);
  });

  test("character: complete with name and persona", () => {
    expect(isWizardComplete(makeSession("character", { name: "Alice", persona: "Brave" }))).toBe(true);
  });

  test("world: complete with name and description", () => {
    expect(isWizardComplete(makeSession("world", { name: "Realm", description: "Dark" }))).toBe(true);
  });

  test("item: complete with name and description (no config)", () => {
    expect(isWizardComplete(makeSession("item", { name: "Sword", description: "Sharp" }))).toBe(true);
  });

  test("item: optional fields don't block completion", () => {
    expect(
      isWizardComplete(makeSession("item", { name: "Sword", description: "Sharp", effect: "Cuts" }))
    ).toBe(true);
  });
});

// --- interpolatePrompt ---

describe("interpolatePrompt", () => {
  test("replaces placeholders with data", () => {
    const result = interpolatePrompt("Hello {name}, you are a {role}", {
      name: "Alice",
      role: "warrior",
    });
    expect(result).toBe("Hello Alice, you are a warrior");
  });

  test("keeps placeholder if key not in data", () => {
    const result = interpolatePrompt("Hello {name}, age {age}", { name: "Bob" });
    expect(result).toBe("Hello Bob, age {age}");
  });

  test("handles empty data", () => {
    const result = interpolatePrompt("{x} and {y}", {});
    expect(result).toBe("{x} and {y}");
  });

  test("handles no placeholders", () => {
    const result = interpolatePrompt("plain text", { name: "Alice" });
    expect(result).toBe("plain text");
  });

  test("converts non-string values to strings", () => {
    const result = interpolatePrompt("Count: {n}, flag: {b}", { n: 42, b: true });
    expect(result).toBe("Count: 42, flag: true");
  });
});

// --- encodeWizardAction / decodeWizardAction ---

describe("encodeWizardAction", () => {
  test("produces correct format", () => {
    expect(encodeWizardAction("sess_123", "next")).toBe("wizard:sess_123:next");
  });

  test("handles action with colons", () => {
    expect(encodeWizardAction("s1", "set:value")).toBe("wizard:s1:set:value");
  });
});

describe("decodeWizardAction", () => {
  test("decodes valid action", () => {
    const result = decodeWizardAction("wizard:sess_123:next");
    expect(result).toEqual({ sessionId: "sess_123", action: "next" });
  });

  test("handles action with colons", () => {
    const result = decodeWizardAction("wizard:s1:set:value");
    expect(result).toEqual({ sessionId: "s1", action: "set:value" });
  });

  test("returns null for non-wizard prefix", () => {
    expect(decodeWizardAction("config:abc:next")).toBeNull();
  });

  test("returns null for too few parts", () => {
    expect(decodeWizardAction("wizard:abc")).toBeNull();
  });
});

// --- formatWizardProgress ---

describe("formatWizardProgress", () => {
  const makeSession = (
    type: WizardType,
    step: number,
    data: Record<string, unknown>
  ): WizardSession => ({
    id: "test",
    type,
    userId: "u1",
    channelId: "c1",
    worldId: null,
    step,
    data,
    aiSuggestions: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  });

  test("shows step progress", () => {
    const result = formatWizardProgress(makeSession("character", 1, { name: "Alice" }));
    expect(result).toContain("Step 2/");
    expect(result).toContain("Character Builder");
  });

  test("shows completed steps with values", () => {
    const result = formatWizardProgress(makeSession("character", 1, { name: "Alice" }));
    expect(result).toContain("Alice");
  });

  test("marks required unfilled steps", () => {
    const result = formatWizardProgress(makeSession("character", 0, {}));
    expect(result).toContain("*(required)*");
  });

  test("marks optional unfilled steps", () => {
    const result = formatWizardProgress(makeSession("character", 2, { name: "A", persona: "B" }));
    expect(result).toContain("*(optional)*");
  });

  test("truncates long values", () => {
    const longValue = "A".repeat(100);
    const result = formatWizardProgress(
      makeSession("character", 1, { name: longValue })
    );
    expect(result).toContain("...");
  });
});
