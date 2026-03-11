import { describe, expect, test } from "bun:test";
import { parseModelSpec, InferenceError, supportsImageOutput, buildSafetyOptions, buildThinkingOptions } from "./models";
import type { ContentFilter } from "../logic/expr";

describe("parseModelSpec", () => {
  test("parses provider:model format", () => {
    expect(parseModelSpec("google:gemini-2.0-flash")).toEqual({
      providerName: "google",
      modelName: "gemini-2.0-flash",
    });
  });

  test("parses anthropic provider", () => {
    expect(parseModelSpec("anthropic:claude-3.5-sonnet")).toEqual({
      providerName: "anthropic",
      modelName: "claude-3.5-sonnet",
    });
  });

  test("parses model name with colons (e.g. versioned models)", () => {
    expect(parseModelSpec("openai:gpt-4:latest")).toEqual({
      providerName: "openai",
      modelName: "gpt-4:latest",
    });
  });

  test("parses hyphenated provider name", () => {
    expect(parseModelSpec("google-vertex:gemini-pro")).toEqual({
      providerName: "google-vertex",
      modelName: "gemini-pro",
    });
  });

  test("throws for missing colon", () => {
    expect(() => parseModelSpec("justmodelname")).toThrow("Invalid model spec");
  });

  test("throws for empty string", () => {
    expect(() => parseModelSpec("")).toThrow("Invalid model spec");
  });

  test("throws for colon only", () => {
    expect(() => parseModelSpec(":")).toThrow("Invalid model spec");
  });

  test("throws for trailing colon with no model", () => {
    expect(() => parseModelSpec("google:")).toThrow("Invalid model spec");
  });
});

describe("InferenceError", () => {
  test("stores modelSpec and message", () => {
    const err = new InferenceError("Request failed", "google:gemini-2.0-flash");
    expect(err.message).toBe("Request failed");
    expect(err.modelSpec).toBe("google:gemini-2.0-flash");
    expect(err.name).toBe("InferenceError");
  });

  test("stores cause", () => {
    const cause = new Error("network timeout");
    const err = new InferenceError("Failed", "openai:gpt-4", cause);
    expect(err.cause).toBe(cause);
  });

  test("is instanceof Error", () => {
    const err = new InferenceError("Failed", "anthropic:claude-3");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InferenceError);
  });
});

describe("supportsImageOutput", () => {
  test("returns true for gemini-2.0-flash-image-generation", () => {
    expect(supportsImageOutput("gemini-2.0-flash-image-generation")).toBe(true);
  });

  test("returns true for gemini-2.5-flash-image", () => {
    expect(supportsImageOutput("gemini-2.5-flash-image")).toBe(true);
  });

  test("returns false for regular gemini model", () => {
    expect(supportsImageOutput("gemini-2.0-flash")).toBe(false);
  });

  test("returns false for unknown model", () => {
    expect(supportsImageOutput("gpt-4o")).toBe(false);
  });
});

describe("buildSafetyOptions", () => {
  const allOff: ContentFilter[] = [
    { category: "sexual",     threshold: "off" },
    { category: "hate",       threshold: "off" },
    { category: "harassment", threshold: "off" },
    { category: "dangerous",  threshold: "off" },
    { category: "civic",      threshold: "off" },
  ];

  test("empty filters returns undefined", () => {
    expect(buildSafetyOptions("google", [])).toBeUndefined();
  });

  test("google: all-off filters → safetySettings with OFF thresholds", () => {
    const result = buildSafetyOptions("google", allOff);
    expect(result).toBeDefined();
    expect(result!.google).toBeDefined();
    const settings = (result!.google as { safetySettings: unknown[] }).safetySettings;
    expect(Array.isArray(settings)).toBe(true);
    expect(settings.length).toBe(5);
    for (const s of settings) {
      expect((s as { threshold: string }).threshold).toBe("OFF");
    }
  });

  test("google: per-category threshold mapping", () => {
    const filters: ContentFilter[] = [
      { category: "sexual",     threshold: "none"   },
      { category: "hate",       threshold: "low"    },
      { category: "harassment", threshold: "medium" },
      { category: "dangerous",  threshold: "high"   },
    ];
    const result = buildSafetyOptions("google", filters);
    const settings = (result!.google as { safetySettings: { category: string; threshold: string }[] }).safetySettings;
    expect(settings.find(s => s.category === "HARM_CATEGORY_SEXUALLY_EXPLICIT")?.threshold).toBe("BLOCK_NONE");
    expect(settings.find(s => s.category === "HARM_CATEGORY_HATE_SPEECH")?.threshold).toBe("BLOCK_LOW_AND_ABOVE");
    expect(settings.find(s => s.category === "HARM_CATEGORY_HARASSMENT")?.threshold).toBe("BLOCK_MEDIUM_AND_ABOVE");
    expect(settings.find(s => s.category === "HARM_CATEGORY_DANGEROUS_CONTENT")?.threshold).toBe("BLOCK_ONLY_HIGH");
  });

  test("google-vertex: uses vertex key instead of google", () => {
    const result = buildSafetyOptions("google-vertex", allOff);
    expect(result).toBeDefined();
    expect(result!.vertex).toBeDefined();
    expect(result!.google).toBeUndefined();
    const settings = (result!.vertex as { safetySettings: unknown[] }).safetySettings;
    expect(Array.isArray(settings)).toBe(true);
    expect(settings.length).toBe(5);
  });

  test("anthropic returns undefined (not supported)", () => {
    expect(buildSafetyOptions("anthropic", allOff)).toBeUndefined();
  });

  test("openai returns undefined (not supported)", () => {
    expect(buildSafetyOptions("openai", allOff)).toBeUndefined();
  });

  test("unknown provider returns undefined", () => {
    expect(buildSafetyOptions("unknown-provider", allOff)).toBeUndefined();
  });
});

describe("buildThinkingOptions", () => {
  // --- Google (gemini-2.5) uses thinkingBudget ---
  test("google gemini-2.5: minimal → budget 0", () => {
    const result = buildThinkingOptions("google", "gemini-2.5-flash", "minimal");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  test("google gemini-2.5: low → budget 1024", () => {
    const result = buildThinkingOptions("google", "gemini-2.5-pro", "low");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingBudget: 1024 } });
  });

  test("google gemini-2.5: medium → budget 8192", () => {
    const result = buildThinkingOptions("google", "gemini-2.5-flash", "medium");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingBudget: 8192 } });
  });

  test("google gemini-2.5: high → budget 24576", () => {
    const result = buildThinkingOptions("google", "gemini-2.5-pro", "high");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingBudget: 24576 } });
  });

  // --- Google (gemini-3+) uses thinkingLevel string ---
  test("google gemini-3 flash: minimal → thinkingLevel minimal", () => {
    const result = buildThinkingOptions("google", "gemini-3-flash-preview", "minimal");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingLevel: "minimal" } });
  });

  test("google gemini-3 flash: null level → thinkingLevel minimal", () => {
    const result = buildThinkingOptions("google", "gemini-3-flash-preview", null);
    expect(result?.google).toEqual({ thinkingConfig: { thinkingLevel: "minimal" } });
  });

  test("google gemini-3.1 pro: minimal → falls back to low", () => {
    const result = buildThinkingOptions("google", "gemini-3.1-pro-preview", "minimal");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingLevel: "low" } });
  });

  test("google gemini-3.1 pro: null level → falls back to low", () => {
    const result = buildThinkingOptions("google", "gemini-3.1-pro-preview", null);
    expect(result?.google).toEqual({ thinkingConfig: { thinkingLevel: "low" } });
  });

  test("google gemini-3: high → thinkingLevel high", () => {
    const result = buildThinkingOptions("google", "gemini-3-flash-preview", "high");
    expect(result?.google).toEqual({ thinkingConfig: { thinkingLevel: "high" } });
  });

  // --- google-vertex uses vertex key ---
  test("google-vertex: uses vertex key", () => {
    const result = buildThinkingOptions("google-vertex", "gemini-2.5-flash", "low");
    expect(result?.vertex).toEqual({ thinkingConfig: { thinkingBudget: 1024 } });
    expect(result?.google).toBeUndefined();
  });

  test("google-vertex gemini-3: uses vertex key with thinkingLevel", () => {
    const result = buildThinkingOptions("google-vertex", "gemini-3-pro", "medium");
    expect(result?.vertex).toEqual({ thinkingConfig: { thinkingLevel: "medium" } });
  });

  // --- Anthropic ---
  test("anthropic: minimal → undefined (don't enable thinking)", () => {
    expect(buildThinkingOptions("anthropic", "claude-3.5-sonnet", "minimal")).toBeUndefined();
  });

  test("anthropic: null → undefined", () => {
    expect(buildThinkingOptions("anthropic", "claude-3.5-sonnet", null)).toBeUndefined();
  });

  test("anthropic: low → budgetTokens 2048", () => {
    const result = buildThinkingOptions("anthropic", "claude-3.5-sonnet", "low");
    expect(result?.anthropic).toEqual({ thinking: { type: "enabled", budgetTokens: 2048 } });
  });

  test("anthropic: medium → budgetTokens 10000", () => {
    const result = buildThinkingOptions("anthropic", "claude-3.5-sonnet", "medium");
    expect(result?.anthropic).toEqual({ thinking: { type: "enabled", budgetTokens: 10_000 } });
  });

  test("anthropic: high → budgetTokens 32000", () => {
    const result = buildThinkingOptions("anthropic", "claude-3.7-sonnet", "high");
    expect(result?.anthropic).toEqual({ thinking: { type: "enabled", budgetTokens: 32_000 } });
  });

  // --- OpenAI ---
  test("openai: minimal → undefined (don't enable reasoning)", () => {
    expect(buildThinkingOptions("openai", "o3-mini", "minimal")).toBeUndefined();
  });

  test("openai: null → undefined", () => {
    expect(buildThinkingOptions("openai", "o3-mini", null)).toBeUndefined();
  });

  test("openai: low → reasoningEffort low", () => {
    const result = buildThinkingOptions("openai", "o3-mini", "low");
    expect(result?.openai).toEqual({ reasoningEffort: "low" });
  });

  test("openai: medium → reasoningEffort medium", () => {
    const result = buildThinkingOptions("openai", "o3-mini", "medium");
    expect(result?.openai).toEqual({ reasoningEffort: "medium" });
  });

  test("openai: high → reasoningEffort high", () => {
    const result = buildThinkingOptions("openai", "o3", "high");
    expect(result?.openai).toEqual({ reasoningEffort: "high" });
  });

  // --- Unknown provider ---
  test("unknown provider → undefined", () => {
    expect(buildThinkingOptions("mistral", "mistral-large", "high")).toBeUndefined();
    expect(buildThinkingOptions("groq", "llama-3.3-70b", "medium")).toBeUndefined();
  });
});
