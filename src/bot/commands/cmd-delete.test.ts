import { describe, it, expect } from "bun:test";
import { parseRange } from "./cmd-delete";

describe("parseRange", () => {
  it("parses single index", () => {
    expect(parseRange("1")).toEqual([1, 1]);
    expect(parseRange("5")).toEqual([5, 5]);
  });

  it("parses N-M range", () => {
    expect(parseRange("1-4")).toEqual([1, 4]);
    expect(parseRange("2-10")).toEqual([2, 10]);
  });

  it("allows range of exactly 1", () => {
    expect(parseRange("3-3")).toEqual([3, 3]);
  });

  it("allows max range of 20", () => {
    expect(parseRange("1-20")).toEqual([1, 20]);
  });

  it("rejects range > 20", () => {
    expect(parseRange("1-21")).toBeNull();
    expect(parseRange("1-100")).toBeNull();
  });

  it("rejects inverted range (N > M)", () => {
    expect(parseRange("5-2")).toBeNull();
  });

  it("rejects zero index", () => {
    expect(parseRange("0")).toBeNull();
    expect(parseRange("0-3")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseRange("abc")).toBeNull();
    expect(parseRange("1-b")).toBeNull();
    expect(parseRange("")).toBeNull();
  });

  it("strips leading/trailing whitespace", () => {
    expect(parseRange("  1-4  ")).toEqual([1, 4]);
  });

  it("rejects negative numbers", () => {
    expect(parseRange("-1")).toBeNull();
  });
});
