import { describe, test, expect } from "bun:test";
import { evaluateConditions, type EventConditions } from "./conditions";
import type { Scene } from "../scene";

// Minimal Scene mock - only fields used by evaluateConditions
function createMockScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 1,
    worldId: 1,
    channelId: "123",
    locationId: null,
    time: {
      day: 1,
      hour: 12,
      minute: 0,
    },
    weather: null,
    ambience: null,
    status: "active",
    config: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    endedAt: null,
    ...overrides,
  };
}

const mockConfig = {
  time: {
    periods: [
      { name: "night", startHour: 0 },
      { name: "dawn", startHour: 5 },
      { name: "morning", startHour: 7 },
      { name: "midday", startHour: 11 },
      { name: "afternoon", startHour: 14 },
      { name: "evening", startHour: 18 },
      { name: "dusk", startHour: 20 },
      { name: "night", startHour: 22 },
    ],
  },
};

const mockCalendar = {
  hoursPerDay: 24,
  daysPerWeek: 7,
  weeksPerMonth: 4, // 28 days per month
  monthsPerYear: 12,
  seasons: [
    { name: "Winter", startMonth: 12, weather: [] },
    { name: "Spring", startMonth: 3, weather: [] },
    { name: "Summer", startMonth: 6, weather: [] },
    { name: "Autumn", startMonth: 9, weather: [] },
  ],
};

describe("evaluateConditions", () => {
  describe("timeOfDay conditions", () => {
    test("matches when current period is in allowed list", () => {
      const scene = createMockScene({ time: { day: 1, hour: 12, minute: 0 } });
      const conditions: EventConditions = { timeOfDay: ["midday", "afternoon"] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });

    test("fails when current period is not in allowed list", () => {
      const scene = createMockScene({ time: { day: 1, hour: 12, minute: 0 } });
      const conditions: EventConditions = { timeOfDay: ["night", "dawn"] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(false);
    });

    test("passes when timeOfDay is empty array", () => {
      const scene = createMockScene({ time: { day: 1, hour: 3, minute: 0 } });
      const conditions: EventConditions = { timeOfDay: [] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });

    test("passes when timeOfDay is not specified", () => {
      const scene = createMockScene();
      const conditions: EventConditions = {};

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });
  });

  describe("season conditions", () => {
    test("matches when current season is in allowed list", () => {
      // Day 140 → month 6 (June) → Summer
      const scene = createMockScene({ time: { day: 140, hour: 12, minute: 0 } });
      const conditions: EventConditions = { season: ["summer", "autumn"] };

      expect(evaluateConditions(conditions, scene, mockConfig, mockCalendar)).toBe(true);
    });

    test("fails when current season is not in allowed list", () => {
      // Day 140 → month 6 (June) → Summer
      const scene = createMockScene({ time: { day: 140, hour: 12, minute: 0 } });
      const conditions: EventConditions = { season: ["winter", "spring"] };

      expect(evaluateConditions(conditions, scene, mockConfig, mockCalendar)).toBe(false);
    });

    test("passes when no calendar is provided (season check skipped)", () => {
      const scene = createMockScene({ time: { day: 100, hour: 12, minute: 0 } });
      const conditions: EventConditions = { season: ["winter"] };

      // Without calendar, season check should be skipped
      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });

    test("handles case-insensitive season matching", () => {
      // Day 56 → month 3 (March) → Spring
      const scene = createMockScene({ time: { day: 56, hour: 12, minute: 0 } });
      const conditions: EventConditions = { season: ["spring"] }; // lowercase

      expect(evaluateConditions(conditions, scene, mockConfig, mockCalendar)).toBe(true);
    });
  });

  describe("location conditions", () => {
    test("matches when scene location is in allowed list", () => {
      const scene = createMockScene({ locationId: 5 });
      const conditions: EventConditions = { location: [3, 5, 7] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });

    test("fails when scene location is not in allowed list", () => {
      const scene = createMockScene({ locationId: 5 });
      const conditions: EventConditions = { location: [1, 2, 3] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(false);
    });

    test("fails when scene has no location", () => {
      const scene = createMockScene({ locationId: null });
      const conditions: EventConditions = { location: [1, 2, 3] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(false);
    });

    test("passes when location list is empty", () => {
      const scene = createMockScene({ locationId: 5 });
      const conditions: EventConditions = { location: [] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });
  });

  describe("weather conditions", () => {
    test("matches when scene weather is in allowed list", () => {
      const scene = createMockScene({ weather: "Rain" });
      const conditions: EventConditions = { weather: ["rain", "storm"] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });

    test("fails when scene weather is not in allowed list", () => {
      const scene = createMockScene({ weather: "Sunny" });
      const conditions: EventConditions = { weather: ["rain", "storm"] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(false);
    });

    test("fails when scene has no weather", () => {
      const scene = createMockScene({ weather: null });
      const conditions: EventConditions = { weather: ["rain"] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(false);
    });

    test("handles case-insensitive weather matching", () => {
      const scene = createMockScene({ weather: "HEAVY RAIN" });
      const conditions: EventConditions = { weather: ["heavy rain", "storm"] };

      expect(evaluateConditions(conditions, scene, mockConfig)).toBe(true);
    });
  });

  describe("combined conditions", () => {
    test("all conditions must pass (AND logic)", () => {
      // Day 140 → month 6 (June) → Summer
      const scene = createMockScene({
        time: { day: 140, hour: 12, minute: 0 }, // Summer, midday
        locationId: 5,
        weather: "Clear",
      });

      const conditions: EventConditions = {
        timeOfDay: ["midday"],
        season: ["summer"],
        location: [5],
        weather: ["clear"],
      };

      expect(evaluateConditions(conditions, scene, mockConfig, mockCalendar)).toBe(true);
    });

    test("fails if any condition fails", () => {
      // Day 140 → month 6 (June) → Summer
      const scene = createMockScene({
        time: { day: 140, hour: 12, minute: 0 }, // Summer, midday
        locationId: 5,
        weather: "Clear",
      });

      const conditions: EventConditions = {
        timeOfDay: ["midday"],
        season: ["summer"],
        location: [99], // wrong location
        weather: ["clear"],
      };

      expect(evaluateConditions(conditions, scene, mockConfig, mockCalendar)).toBe(false);
    });
  });
});
