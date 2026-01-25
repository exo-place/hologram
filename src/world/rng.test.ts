import { describe, test, expect } from "bun:test";
import { SeededRNG } from "./rng";

describe("SeededRNG", () => {
  test("deterministic with same seed", () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);

    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("different seeds produce different sequences", () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(99);

    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());

    // Extremely unlikely to be equal
    expect(seqA).not.toEqual(seqB);
  });

  test("next() returns values in [0, 1)", () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("getSeed() returns initial seed", () => {
    const rng = new SeededRNG(42);
    expect(rng.getSeed()).toBe(42);
    rng.next();
    expect(rng.getSeed()).toBe(42);
  });

  test("getState() / setState() preserve sequence", () => {
    const rng = new SeededRNG(42);
    rng.next();
    rng.next();
    const state = rng.getState();

    const val1 = rng.next();
    const val2 = rng.next();

    rng.setState(state);
    expect(rng.next()).toBe(val1);
    expect(rng.next()).toBe(val2);
  });

  test("reset() restarts from initial seed", () => {
    const rng = new SeededRNG(42);
    const first = rng.next();
    rng.next();
    rng.next();

    rng.reset();
    expect(rng.next()).toBe(first);
  });

  test("int() returns values in [min, max] inclusive", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 500; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test("int() covers full range", () => {
    const rng = new SeededRNG(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(rng.int(1, 6));
    }
    expect(seen.size).toBe(6);
  });

  test("float() returns values in [min, max)", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 500; i++) {
      const v = rng.float(2.0, 5.0);
      expect(v).toBeGreaterThanOrEqual(2.0);
      expect(v).toBeLessThan(5.0);
    }
  });

  test("bool() defaults to ~50%", () => {
    const rng = new SeededRNG(42);
    let trues = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      if (rng.bool()) trues++;
    }
    // Should be roughly 500 ± 100
    expect(trues).toBeGreaterThan(350);
    expect(trues).toBeLessThan(650);
  });

  test("bool() with probability 0 always false", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.bool(0)).toBe(false);
    }
  });

  test("bool() with probability 1 always true", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(rng.bool(1)).toBe(true);
    }
  });

  test("pick() returns element from array", () => {
    const rng = new SeededRNG(42);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(rng.pick(items)!);
    }
  });

  test("pick() returns undefined for empty array", () => {
    const rng = new SeededRNG(42);
    expect(rng.pick([])).toBeUndefined();
  });

  test("pick() covers all elements", () => {
    const rng = new SeededRNG(42);
    const items = ["x", "y", "z"];
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(rng.pick(items)!);
    }
    expect(seen.size).toBe(3);
  });

  test("shuffle() returns same elements", () => {
    const rng = new SeededRNG(42);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle([...arr]);
    expect(shuffled.sort()).toEqual(arr);
  });

  test("shuffle() is deterministic", () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);

    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8];

    a.shuffle(arr1);
    b.shuffle(arr2);
    expect(arr1).toEqual(arr2);
  });

  test("shuffle() actually changes order", () => {
    const rng = new SeededRNG(42);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    rng.shuffle(arr);
    // Extremely unlikely to stay identical
    expect(arr).not.toEqual(original);
  });
});

describe("SeededRNG.roll()", () => {
  test("parses basic notation", () => {
    const rng = new SeededRNG(42);
    const result = rng.roll("2d6+3");
    expect(result.rolls).toHaveLength(2);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(result.rolls[0] + result.rolls[1] + 3);
  });

  test("handles negative modifier", () => {
    const rng = new SeededRNG(42);
    const result = rng.roll("1d20-2");
    expect(result.modifier).toBe(-2);
    expect(result.total).toBe(result.rolls[0] - 2);
  });

  test("handles no modifier", () => {
    const rng = new SeededRNG(42);
    const result = rng.roll("3d8");
    expect(result.rolls).toHaveLength(3);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(result.rolls.reduce((a, b) => a + b, 0));
  });

  test("dice values are in range [1, sides]", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 100; i++) {
      const result = rng.roll("1d6");
      expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
      expect(result.rolls[0]).toBeLessThanOrEqual(6);
    }
  });

  test("roll is deterministic", () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    expect(a.roll("4d6+2")).toEqual(b.roll("4d6+2"));
  });

  test("throws on invalid notation", () => {
    const rng = new SeededRNG(42);
    expect(() => rng.roll("invalid")).toThrow("Invalid dice notation");
    expect(() => rng.roll("d6")).toThrow("Invalid dice notation");
    expect(() => rng.roll("2d")).toThrow("Invalid dice notation");
  });
});
