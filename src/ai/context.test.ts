import { describe, test, expect } from "bun:test";
import { formatMessagesForAI, type Message } from "./context";

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
