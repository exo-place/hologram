import { describe, test, expect } from "bun:test";
import {
  formatMessagesForAI,
  injectTimestamps,
  type Message,
} from "./context";
import type { ContextConfig } from "../config/types";

// --- formatMessagesForAI ---

describe("formatMessagesForAI", () => {
  test("converts basic messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = formatMessagesForAI(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "Hello" });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi there" });
  });

  test("prepends name to content", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello", name: "Alice" },
    ];
    const result = formatMessagesForAI(messages);
    expect(result[0].content).toBe("Alice: Hello");
  });

  test("buffers system messages as timestamps", () => {
    const messages: Message[] = [
      { role: "user", content: "First message" },
      { role: "system", content: "[3 hours later]" },
      { role: "assistant", content: "Response" },
    ];
    const result = formatMessagesForAI(messages);
    expect(result).toHaveLength(2);
    // System timestamp prepended to assistant message
    expect(result[1].content).toBe("[3 hours later]\nResponse");
  });

  test("skips non-user/assistant/system roles", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      // @ts-expect-error Testing invalid role
      { role: "tool", content: "tool output" },
      { role: "assistant", content: "Reply" },
    ];
    const result = formatMessagesForAI(messages);
    expect(result).toHaveLength(2);
  });

  test("returns empty array for no messages", () => {
    expect(formatMessagesForAI([])).toHaveLength(0);
  });
});

// --- injectTimestamps ---

const makeConfig = (overrides?: Partial<ContextConfig>): ContextConfig => ({
  maxTokens: 8000,
  historyMessages: 20,
  ragResults: 10,
  includeWorldLore: true,
  includeWorldRules: true,
  dynamicPriority: false,
  showTimestamps: true,
  timestampFormat: "relative",
  timestampThreshold: 300, // 5 minutes
  ...overrides,
});

describe("injectTimestamps", () => {
  test("returns messages unchanged when showTimestamps is false", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello", timestamp: 1000000 },
      { role: "assistant", content: "Hi", timestamp: 2000000 },
    ];
    const config = makeConfig({ showTimestamps: false });
    const result = injectTimestamps(messages, config);
    expect(result).toEqual(messages);
  });

  test("injects relative timestamp between messages with large real-time gap", () => {
    const t1 = Date.now();
    const t2 = t1 + 600000; // 10 minutes later
    const messages: Message[] = [
      { role: "user", content: "First", timestamp: t1, gameTime: { day: 0, hour: 10, minute: 0 } },
      { role: "assistant", content: "Second", timestamp: t2, gameTime: { day: 0, hour: 13, minute: 0 } },
    ];
    const config = makeConfig({ timestampFormat: "relative" });
    const result = injectTimestamps(messages, config);

    // Should have 3 messages: first, timestamp system message, second
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("system");
    expect(result[1].content).toContain("hours later");
  });

  test("skips timestamp when gap is below threshold", () => {
    const t1 = Date.now();
    const t2 = t1 + 10000; // 10 seconds later
    const messages: Message[] = [
      { role: "user", content: "First", timestamp: t1, gameTime: { day: 0, hour: 10, minute: 0 } },
      { role: "assistant", content: "Second", timestamp: t2, gameTime: { day: 0, hour: 10, minute: 0 } },
    ];
    const config = makeConfig({ timestampThreshold: 300 });
    const result = injectTimestamps(messages, config);
    // No timestamp injected
    expect(result).toHaveLength(2);
  });

  test("injects absolute timestamp", () => {
    const t1 = Date.now();
    const t2 = t1 + 600000;
    const messages: Message[] = [
      { role: "user", content: "First", timestamp: t1, gameTime: { day: 0, hour: 10, minute: 0 } },
      { role: "assistant", content: "Second", timestamp: t2, gameTime: { day: 0, hour: 14, minute: 30 } },
    ];
    const config = makeConfig({ timestampFormat: "absolute" });
    const result = injectTimestamps(messages, config);

    expect(result).toHaveLength(3);
    expect(result[1].content).toContain("Day 1");
    expect(result[1].content).toContain("2:30 PM");
  });

  test("handles single message (no gap)", () => {
    const messages: Message[] = [
      { role: "user", content: "Only one", timestamp: Date.now() },
    ];
    const config = makeConfig();
    const result = injectTimestamps(messages, config);
    expect(result).toHaveLength(1);
  });

  test("handles game time jump even with small real-time gap", () => {
    const t1 = Date.now();
    const t2 = t1 + 1000; // 1 second real time
    const messages: Message[] = [
      { role: "user", content: "First", timestamp: t1, gameTime: { day: 0, hour: 10, minute: 0 } },
      { role: "assistant", content: "Second", timestamp: t2, gameTime: { day: 1, hour: 10, minute: 0 } },
    ];
    const config = makeConfig({ timestampFormat: "relative" });
    const result = injectTimestamps(messages, config);

    expect(result).toHaveLength(3);
    expect(result[1].content).toContain("day");
  });
});
