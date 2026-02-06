import { describe, expect, test } from "bun:test";
import { findFirstDelimiter } from "./streaming";

describe("findFirstDelimiter", () => {
  test("finds single delimiter", () => {
    expect(findFirstDelimiter("hello\nworld", ["\n"])).toEqual({ index: 5, length: 1 });
  });

  test("finds earliest delimiter among multiple", () => {
    expect(findFirstDelimiter("a|b\nc", ["\n", "|"])).toEqual({ index: 1, length: 1 });
  });

  test("returns -1 when no delimiter found", () => {
    expect(findFirstDelimiter("hello world", ["\n", "|"])).toEqual({ index: -1, length: 0 });
  });

  test("handles empty delimiters array", () => {
    expect(findFirstDelimiter("hello", [])).toEqual({ index: -1, length: 0 });
  });

  test("handles multi-character delimiter", () => {
    expect(findFirstDelimiter("hello---world", ["---"])).toEqual({ index: 5, length: 3 });
  });

  test("finds earliest when multiple delimiters present", () => {
    expect(findFirstDelimiter("a---b\nc", ["---", "\n"])).toEqual({ index: 1, length: 3 });
  });

  test("handles delimiter at start of string", () => {
    expect(findFirstDelimiter("\nhello", ["\n"])).toEqual({ index: 0, length: 1 });
  });

  test("handles delimiter at end of string", () => {
    expect(findFirstDelimiter("hello\n", ["\n"])).toEqual({ index: 5, length: 1 });
  });

  test("handles empty buffer", () => {
    expect(findFirstDelimiter("", ["\n"])).toEqual({ index: -1, length: 0 });
  });

  test("picks shortest-position delimiter when both at same index", () => {
    // "abc" starts at 0 for "a" and 0 for "ab" — both at index 0, first match wins
    const result = findFirstDelimiter("abc", ["ab", "a"]);
    // Both match at index 0, but loop order means "ab" is checked first
    expect(result.index).toBe(0);
  });
});
