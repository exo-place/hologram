import { describe, test, expect } from "bun:test";
import {
  roll,
  rollMultiple,
  validateExpression,
  formatRollForDisplay,
} from ".";

// --- validateExpression ---

describe("validateExpression", () => {
  test("accepts basic dice expressions", () => {
    expect(validateExpression("d20").valid).toBe(true);
    expect(validateExpression("2d6").valid).toBe(true);
    expect(validateExpression("3d8+5").valid).toBe(true);
  });

  test("accepts keep/drop modifiers", () => {
    expect(validateExpression("4d6kh3").valid).toBe(true);
    expect(validateExpression("4d6dl1").valid).toBe(true);
    expect(validateExpression("2d20kh1").valid).toBe(true);
  });

  test("accepts complex expressions", () => {
    expect(validateExpression("2d6+1d4+3").valid).toBe(true);
    expect(validateExpression("(2d6+3)*2").valid).toBe(true);
    expect(validateExpression("d20+@strength").valid).toBe(true);
  });

  test("accepts exploding dice", () => {
    expect(validateExpression("d6!").valid).toBe(true);
  });

  test("accepts success counting", () => {
    expect(validateExpression("8d6>=5").valid).toBe(true);
  });

  test("rejects empty expression", () => {
    const result = validateExpression("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Empty expression");
  });

  test("rejects too many dice", () => {
    const result = validateExpression("101d6");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Too many dice");
  });

  test("rejects too many sides", () => {
    const result = validateExpression("1d1001");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Too many sides");
  });

  test("rejects unbalanced parentheses", () => {
    expect(validateExpression("(2d6+3").valid).toBe(false);
    expect(validateExpression("2d6+3)").valid).toBe(false);
  });

  test("rejects non-dice expressions", () => {
    const result = validateExpression("+-*/");
    expect(result.valid).toBe(false);
  });
});

// --- roll ---

describe("roll", () => {
  test("returns correct structure", () => {
    const result = roll("2d6+3");
    expect(result.expression).toBe("2d6+3");
    expect(typeof result.total).toBe("number");
    expect(result.rolls.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.details).toBe("string");
  });

  test("d20 result is between 1 and 20 (plus modifier)", () => {
    for (let i = 0; i < 20; i++) {
      const result = roll("d20+5");
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(25);
    }
  });

  test("2d6 result is between 2 and 12", () => {
    for (let i = 0; i < 20; i++) {
      const result = roll("2d6");
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeLessThanOrEqual(12);
    }
  });

  test("keep highest reduces effective dice", () => {
    for (let i = 0; i < 20; i++) {
      const result = roll("4d6kh3");
      expect(result.rolls[0].results).toHaveLength(4);
      expect(result.rolls[0].kept).toHaveLength(3);
      // Total should be sum of 3 kept
      expect(result.total).toBe(result.rolls[0].kept.reduce((a, b) => a + b, 0));
    }
  });

  test("variable substitution works", () => {
    const result = roll("d20+@strength", { strength: 5 });
    // Total should be d20 result + 5
    expect(result.total).toBeGreaterThanOrEqual(6);
    expect(result.total).toBeLessThanOrEqual(25);
    expect(result.details).toContain("@strength=5");
  });

  test("detects natural 20", () => {
    // Roll enough times to get a nat 20 (probabilistic)
    let foundCrit = false;
    for (let i = 0; i < 200; i++) {
      const result = roll("d20");
      if (result.critical === "success") {
        foundCrit = true;
        expect(result.rolls[0].results[0]).toBe(20);
        break;
      }
    }
    // With 200 tries, probability of no nat 20 is (19/20)^200 ≈ 0.00003
    expect(foundCrit).toBe(true);
  });

  test("detects natural 1", () => {
    let foundCrit = false;
    for (let i = 0; i < 200; i++) {
      const result = roll("d20");
      if (result.critical === "failure") {
        foundCrit = true;
        expect(result.rolls[0].results[0]).toBe(1);
        break;
      }
    }
    expect(foundCrit).toBe(true);
  });

  test("handles simple number expression", () => {
    const result = roll("5");
    expect(result.total).toBe(5);
  });

  test("handles math operations", () => {
    const result = roll("10-3");
    expect(result.total).toBe(7);
  });

  test("handles parentheses", () => {
    const result = roll("(2+3)*2");
    expect(result.total).toBe(10);
  });

  test("supports negative modifiers", () => {
    const result = roll("d20-2");
    expect(result.total).toBeGreaterThanOrEqual(-1);
    expect(result.total).toBeLessThanOrEqual(18);
  });

  test("success counting returns count", () => {
    for (let i = 0; i < 10; i++) {
      const result = roll("10d6>=5");
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(10);
    }
  });
});

// --- rollMultiple ---

describe("rollMultiple", () => {
  test("returns correct number of results", () => {
    const results = rollMultiple("d20", 5);
    expect(results).toHaveLength(5);
  });

  test("each result is independent", () => {
    const results = rollMultiple("d20", 100);
    // With 100 d20 rolls, it's extremely unlikely all are the same
    const unique = new Set(results.map((r) => r.total));
    expect(unique.size).toBeGreaterThan(1);
  });
});

// --- formatRollForDisplay ---

describe("formatRollForDisplay", () => {
  test("formats basic roll", () => {
    const result = roll("2d6+3");
    const display = formatRollForDisplay(result);
    expect(display).toContain("`2d6+3`");
    expect(display).toContain("→");
  });

  test("includes label when provided", () => {
    const result = roll("d20");
    const display = formatRollForDisplay(result, "Attack Roll");
    expect(display).toContain("**Attack Roll**");
  });

  test("shows critical success message", () => {
    // Create a fake result with critical success
    const fakeResult = {
      expression: "d20",
      rolls: [{ count: 1, sides: 20, results: [20], kept: [20], subtotal: 20 }],
      total: 20,
      details: "d20 [20] = **20**",
      critical: "success" as const,
    };
    const display = formatRollForDisplay(fakeResult);
    expect(display).toContain("Critical Success");
  });

  test("shows critical failure message", () => {
    const fakeResult = {
      expression: "d20",
      rolls: [{ count: 1, sides: 20, results: [1], kept: [1], subtotal: 1 }],
      total: 1,
      details: "d20 [1] = **1**",
      critical: "failure" as const,
    };
    const display = formatRollForDisplay(fakeResult);
    expect(display).toContain("Critical Failure");
  });
});
