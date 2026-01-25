import { describe, test, expect } from "bun:test";
import { formatPersonaForContext, type UserPersona } from ".";

const makePersona = (overrides?: Partial<UserPersona>): UserPersona => ({
  id: 1,
  userId: "123",
  worldId: null,
  name: "Alice",
  persona: null,
  avatar: null,
  data: null,
  createdAt: Date.now(),
  ...overrides,
});

// --- formatPersonaForContext ---

describe("formatPersonaForContext", () => {
  test("includes name header", () => {
    const result = formatPersonaForContext(makePersona({ name: "Princess Aurora" }));
    expect(result).toContain("## User: Princess Aurora");
  });

  test("includes persona when present", () => {
    const result = formatPersonaForContext(
      makePersona({
        name: "Alice",
        persona: "A curious young woman with blonde hair.",
      })
    );
    expect(result).toContain("## User: Alice");
    expect(result).toContain("A curious young woman with blonde hair.");
  });

  test("works without persona", () => {
    const result = formatPersonaForContext(makePersona({ name: "Bob", persona: null }));
    expect(result).toContain("## User: Bob");
    // Should just be the header line
    expect(result).toBe("## User: Bob");
  });
});
