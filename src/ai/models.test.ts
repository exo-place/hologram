import { describe, expect, test } from "bun:test";
import { parseModelSpec, InferenceError } from "./models";

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
