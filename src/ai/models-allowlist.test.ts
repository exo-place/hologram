import { describe, expect, test } from "bun:test";
import { isModelAllowed } from "./models";

const ALLOWLIST = ["google:*", "anthropic:claude-3.5-sonnet", "openai:gpt-4o"];

describe("isModelAllowed (with allowlist)", () => {
  test("no allowlist (null) → always returns true", () => {
    expect(isModelAllowed("mistral:mistral-large", null)).toBe(true);
    expect(isModelAllowed("anything:goes", null)).toBe(true);
  });

  test("returns true for exact match", () => {
    expect(isModelAllowed("anthropic:claude-3.5-sonnet", ALLOWLIST)).toBe(true);
    expect(isModelAllowed("openai:gpt-4o", ALLOWLIST)).toBe(true);
  });

  test("returns true for wildcard provider match", () => {
    expect(isModelAllowed("google:gemini-2.0-flash", ALLOWLIST)).toBe(true);
    expect(isModelAllowed("google:gemini-3-flash-preview", ALLOWLIST)).toBe(true);
    expect(isModelAllowed("google:any-model-name", ALLOWLIST)).toBe(true);
  });

  test("returns false for disallowed provider", () => {
    expect(isModelAllowed("mistral:mistral-large", ALLOWLIST)).toBe(false);
    expect(isModelAllowed("groq:llama-3.3-70b", ALLOWLIST)).toBe(false);
  });

  test("returns false for disallowed model in allowed provider (no wildcard)", () => {
    // anthropic is only allowed for claude-3.5-sonnet exactly (no wildcard)
    expect(isModelAllowed("anthropic:claude-3-opus", ALLOWLIST)).toBe(false);
    expect(isModelAllowed("anthropic:claude-3.7-sonnet", ALLOWLIST)).toBe(false);
  });

  test("returns false for openai model not in allowlist", () => {
    // openai is only allowed for gpt-4o exactly
    expect(isModelAllowed("openai:gpt-3.5-turbo", ALLOWLIST)).toBe(false);
    expect(isModelAllowed("openai:gpt-4-turbo", ALLOWLIST)).toBe(false);
  });

  test("provider wildcard does not match other providers with similar prefix", () => {
    const list = ["google:*"];
    expect(isModelAllowed("google-vertex:gemini-pro", list)).toBe(false);
  });

  test("empty allowlist → always false", () => {
    expect(isModelAllowed("google:gemini-2.0-flash", [])).toBe(false);
    expect(isModelAllowed("anthropic:claude-3.5-sonnet", [])).toBe(false);
  });
});
