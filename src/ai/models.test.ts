import { describe, expect, test } from "bun:test";
import { parseModelSpec, InferenceError, supportsImageOutput, buildNsfwOptions } from "./models";

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

describe("buildNsfwOptions", () => {
  test("google relaxed returns safetySettings with OFF thresholds", () => {
    const result = buildNsfwOptions("google", true);
    expect(result).toBeDefined();
    expect(result!.google).toBeDefined();
    const settings = (result!.google as { safetySettings: unknown[] }).safetySettings;
    expect(Array.isArray(settings)).toBe(true);
    expect(settings.length).toBeGreaterThan(0);
    for (const s of settings) {
      expect((s as { threshold: string }).threshold).toBe("OFF");
    }
  });

  test("google not relaxed returns undefined", () => {
    expect(buildNsfwOptions("google", false)).toBeUndefined();
  });

  test("google-vertex relaxed returns vertex.safetySettings", () => {
    const result = buildNsfwOptions("google-vertex", true);
    expect(result).toBeDefined();
    expect(result!.vertex).toBeDefined();
    const settings = (result!.vertex as { safetySettings: unknown[] }).safetySettings;
    expect(Array.isArray(settings)).toBe(true);
    expect(settings.length).toBeGreaterThan(0);
  });

  test("anthropic relaxed returns undefined (provider not supported)", () => {
    expect(buildNsfwOptions("anthropic", true)).toBeUndefined();
  });

  test("openai relaxed returns undefined (provider not supported)", () => {
    expect(buildNsfwOptions("openai", true)).toBeUndefined();
  });

  test("unknown provider relaxed returns undefined", () => {
    expect(buildNsfwOptions("unknown-provider", true)).toBeUndefined();
  });
});
