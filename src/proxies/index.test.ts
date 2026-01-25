import { describe, test, expect } from "bun:test";
import { formatProxyTrigger, formatProxyForContext, type UserProxy } from ".";

const makeProxy = (overrides?: Partial<UserProxy>): UserProxy => ({
  id: 1,
  userId: "123",
  worldId: null,
  name: "Alice",
  prefix: null,
  suffix: null,
  bracketOpen: null,
  bracketClose: null,
  avatar: null,
  persona: null,
  data: null,
  createdAt: Date.now(),
  ...overrides,
});

// --- formatProxyTrigger ---

describe("formatProxyTrigger", () => {
  test("formats prefix trigger", () => {
    const proxy = makeProxy({ prefix: "a:" });
    const result = formatProxyTrigger(proxy);
    expect(result).toContain("Prefix:");
    expect(result).toContain("a:text");
  });

  test("formats suffix trigger", () => {
    const proxy = makeProxy({ suffix: "-a" });
    const result = formatProxyTrigger(proxy);
    expect(result).toContain("Suffix:");
    expect(result).toContain("text-a");
  });

  test("formats bracket trigger", () => {
    const proxy = makeProxy({ bracketOpen: "[", bracketClose: "]" });
    const result = formatProxyTrigger(proxy);
    expect(result).toContain("Brackets:");
    expect(result).toContain("[text]");
  });

  test("formats multiple triggers", () => {
    const proxy = makeProxy({ prefix: "a:", bracketOpen: "[", bracketClose: "]" });
    const result = formatProxyTrigger(proxy);
    expect(result).toContain("Prefix:");
    expect(result).toContain("Brackets:");
    expect(result).toContain(" | ");
  });

  test("shows no trigger message when none set", () => {
    const proxy = makeProxy();
    const result = formatProxyTrigger(proxy);
    expect(result).toBe("No trigger set");
  });
});

// --- formatProxyForContext ---

describe("formatProxyForContext", () => {
  test("includes proxy name", () => {
    const proxy = makeProxy({ name: "Princess Aurora" });
    const result = formatProxyForContext(proxy);
    expect(result).toContain("Princess Aurora");
  });

  test("includes persona when present", () => {
    const proxy = makeProxy({
      name: "Alice",
      persona: "A curious young woman who falls down rabbit holes.",
    });
    const result = formatProxyForContext(proxy);
    expect(result).toContain("curious young woman");
  });

  test("works without persona", () => {
    const proxy = makeProxy({ name: "Bob" });
    const result = formatProxyForContext(proxy);
    expect(result).toContain("Bob");
    expect(result).toContain("## User");
  });
});
