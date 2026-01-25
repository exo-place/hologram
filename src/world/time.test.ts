import { describe, test, expect } from "bun:test";
import {
  advanceTime,
  formatTime,
  formatDate,
  getTimePeriod,
  getPeriodStartHour,
  getSeason,
  getSeasonWeather,
  skipToPeriod,
  parseDuration,
  parseTime,
  DEFAULT_CALENDAR,
  type CalendarConfig,
} from "./time";

// --- advanceTime ---

describe("advanceTime", () => {
  test("advances by minutes within an hour", () => {
    const result = advanceTime({ day: 0, hour: 10, minute: 15 }, { minutes: 30 });
    expect(result).toEqual({ day: 0, hour: 10, minute: 45 });
  });

  test("minutes overflow into hours", () => {
    const result = advanceTime({ day: 0, hour: 10, minute: 45 }, { minutes: 30 });
    expect(result).toEqual({ day: 0, hour: 11, minute: 15 });
  });

  test("advances by hours", () => {
    const result = advanceTime({ day: 0, hour: 10, minute: 0 }, { hours: 5 });
    expect(result).toEqual({ day: 0, hour: 15, minute: 0 });
  });

  test("hours overflow into days", () => {
    const result = advanceTime({ day: 0, hour: 22, minute: 0 }, { hours: 5 });
    expect(result).toEqual({ day: 1, hour: 3, minute: 0 });
  });

  test("advances by days", () => {
    const result = advanceTime({ day: 1, hour: 8, minute: 0 }, { days: 3 });
    expect(result).toEqual({ day: 4, hour: 8, minute: 0 });
  });

  test("combined advance (hours + minutes + days)", () => {
    const result = advanceTime(
      { day: 0, hour: 23, minute: 50 },
      { days: 1, hours: 2, minutes: 30 }
    );
    expect(result).toEqual({ day: 2, hour: 2, minute: 20 });
  });

  test("handles zero duration", () => {
    const result = advanceTime({ day: 5, hour: 12, minute: 30 }, {});
    expect(result).toEqual({ day: 5, hour: 12, minute: 30 });
  });

  test("respects custom hoursPerDay", () => {
    // 10-hour days
    const result = advanceTime({ day: 0, hour: 8, minute: 0 }, { hours: 5 }, 10);
    expect(result).toEqual({ day: 1, hour: 3, minute: 0 });
  });

  test("large advance across multiple days", () => {
    const result = advanceTime({ day: 0, hour: 0, minute: 0 }, { hours: 72 });
    expect(result).toEqual({ day: 3, hour: 0, minute: 0 });
  });
});

// --- formatTime ---

describe("formatTime", () => {
  test("formats 12-hour AM time", () => {
    expect(formatTime({ day: 0, hour: 9, minute: 30 })).toBe("9:30 AM");
  });

  test("formats 12-hour PM time", () => {
    expect(formatTime({ day: 0, hour: 14, minute: 5 })).toBe("2:05 PM");
  });

  test("formats midnight as 12 AM", () => {
    expect(formatTime({ day: 0, hour: 0, minute: 0 })).toBe("12:00 AM");
  });

  test("formats noon as 12 PM", () => {
    expect(formatTime({ day: 0, hour: 12, minute: 0 })).toBe("12:00 PM");
  });

  test("pads minutes", () => {
    expect(formatTime({ day: 0, hour: 3, minute: 5 })).toBe("3:05 AM");
  });

  test("24-hour format", () => {
    expect(formatTime({ day: 0, hour: 14, minute: 30 }, true)).toBe("14:30");
  });

  test("24-hour format pads hours", () => {
    expect(formatTime({ day: 0, hour: 3, minute: 5 }, true)).toBe("03:05");
  });
});

// --- getTimePeriod ---

describe("getTimePeriod", () => {
  test("dawn at hour 5", () => {
    expect(getTimePeriod(5).name).toBe("dawn");
  });

  test("morning at hour 8", () => {
    expect(getTimePeriod(8).name).toBe("morning");
  });

  test("noon at hour 12", () => {
    expect(getTimePeriod(12).name).toBe("noon");
  });

  test("afternoon at hour 15", () => {
    expect(getTimePeriod(15).name).toBe("afternoon");
  });

  test("evening at hour 18", () => {
    expect(getTimePeriod(18).name).toBe("evening");
  });

  test("dusk at hour 19", () => {
    expect(getTimePeriod(19).name).toBe("dusk");
  });

  test("night at hour 22", () => {
    expect(getTimePeriod(22).name).toBe("night");
  });

  test("midnight at hour 0", () => {
    expect(getTimePeriod(0).name).toBe("midnight");
  });

  test("returns light level", () => {
    expect(getTimePeriod(8).lightLevel).toBe("bright");
    expect(getTimePeriod(22).lightLevel).toBe("dark");
    expect(getTimePeriod(5).lightLevel).toBe("dim");
  });

  test("works with custom periods", () => {
    const custom = [
      { name: "work", startHour: 9 },
      { name: "sleep", startHour: 0 },
    ];
    expect(getTimePeriod(10, custom).name).toBe("work");
    expect(getTimePeriod(3, custom).name).toBe("sleep");
  });
});

// --- getPeriodStartHour ---

describe("getPeriodStartHour", () => {
  test("returns start hour for known period", () => {
    expect(getPeriodStartHour("morning")).toBe(7);
    expect(getPeriodStartHour("night")).toBe(21);
  });

  test("case insensitive", () => {
    expect(getPeriodStartHour("Morning")).toBe(7);
    expect(getPeriodStartHour("NIGHT")).toBe(21);
  });

  test("returns null for unknown period", () => {
    expect(getPeriodStartHour("brunch")).toBeNull();
  });
});

// --- skipToPeriod ---

describe("skipToPeriod", () => {
  test("skips to later period same day", () => {
    const result = skipToPeriod({ day: 1, hour: 5, minute: 30 }, "morning");
    expect(result).toEqual({ day: 1, hour: 7, minute: 0 });
  });

  test("skips to next day if period passed", () => {
    const result = skipToPeriod({ day: 1, hour: 15, minute: 0 }, "morning");
    expect(result).toEqual({ day: 2, hour: 7, minute: 0 });
  });

  test("skips to next day if at same hour", () => {
    const result = skipToPeriod({ day: 1, hour: 7, minute: 0 }, "morning");
    expect(result).toEqual({ day: 2, hour: 7, minute: 0 });
  });

  test("returns unchanged time for unknown period", () => {
    const input = { day: 1, hour: 10, minute: 30 };
    const result = skipToPeriod(input, "brunch");
    expect(result).toEqual(input);
  });
});

// --- formatDate ---

describe("formatDate", () => {
  test("formats day 0 with defaults", () => {
    const result = formatDate({ day: 0, hour: 0, minute: 0 });
    expect(result).toContain("January");
    expect(result).toContain("Year 1");
  });

  test("includes day of week when dayNames configured", () => {
    const result = formatDate({ day: 0, hour: 0, minute: 0 });
    expect(result).toContain("Sunday");
  });

  test("calculates month correctly", () => {
    // Default: 7 days/week * 4 weeks/month = 28 days/month
    const result = formatDate({ day: 28, hour: 0, minute: 0 });
    expect(result).toContain("February");
  });

  test("wraps year correctly", () => {
    // 28 days/month * 12 months = 336 days/year
    const result = formatDate({ day: 336, hour: 0, minute: 0 });
    expect(result).toContain("Year 2");
  });

  test("applies year offset", () => {
    const cal: CalendarConfig = { ...DEFAULT_CALENDAR, yearOffset: 2846 };
    const result = formatDate({ day: 0, hour: 0, minute: 0 }, cal);
    expect(result).toContain("2847");
  });

  test("includes era suffix", () => {
    const cal: CalendarConfig = { ...DEFAULT_CALENDAR, era: "AE" };
    const result = formatDate({ day: 0, hour: 0, minute: 0 }, cal);
    expect(result).toContain("AE");
  });
});

// --- getSeason ---

describe("getSeason", () => {
  test("returns Winter for month 1 (Jan)", () => {
    // Day 0 → month index 0 → month 1 (January) → Winter starts at 12 but wraps
    expect(getSeason(0)).toBe("Winter");
  });

  test("returns Spring for month 3 (March)", () => {
    // Day 56 → month index 2 → month 3 (March)
    expect(getSeason(56)).toBe("Spring");
  });

  test("returns Summer for month 6 (June)", () => {
    // Day 140 → month index 5 → month 6
    expect(getSeason(140)).toBe("Summer");
  });

  test("returns Autumn for month 9 (September)", () => {
    // Day 224 → month index 8 → month 9
    expect(getSeason(224)).toBe("Autumn");
  });

  test("returns null if no seasons configured", () => {
    expect(getSeason(0, { hoursPerDay: 24 })).toBeNull();
  });
});

// --- getSeasonWeather ---

describe("getSeasonWeather", () => {
  test("returns weather options for winter", () => {
    const weather = getSeasonWeather(0);
    expect(weather).toContain("snow");
    expect(weather).toContain("cold");
  });

  test("returns empty array when no seasons", () => {
    expect(getSeasonWeather(0, { hoursPerDay: 24 })).toEqual([]);
  });
});

// --- parseDuration ---

describe("parseDuration", () => {
  test("parses hours", () => {
    expect(parseDuration("2 hours")).toEqual({ hours: 2 });
    expect(parseDuration("5hr")).toEqual({ hours: 5 });
    expect(parseDuration("1h")).toEqual({ hours: 1 });
  });

  test("parses minutes", () => {
    expect(parseDuration("30 minutes")).toEqual({ minutes: 30 });
    expect(parseDuration("15min")).toEqual({ minutes: 15 });
    expect(parseDuration("45m")).toEqual({ minutes: 45 });
  });

  test("parses days", () => {
    expect(parseDuration("3 days")).toEqual({ days: 3 });
    expect(parseDuration("1d")).toEqual({ days: 1 });
  });

  test("parses combined durations", () => {
    const result = parseDuration("2 hours 30 minutes");
    expect(result).toEqual({ hours: 2, minutes: 30 });
  });

  test("parses plain number as hours", () => {
    expect(parseDuration("5")).toEqual({ hours: 5 });
  });

  test("returns null for invalid input", () => {
    expect(parseDuration("hello")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

// --- parseTime ---

describe("parseTime", () => {
  test("parses 24-hour format", () => {
    expect(parseTime("14:30")).toEqual({ hour: 14, minute: 30 });
    expect(parseTime("0:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseTime("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  test("parses 12-hour format with AM/PM", () => {
    expect(parseTime("2pm")).toEqual({ hour: 14, minute: 0 });
    expect(parseTime("2:30pm")).toEqual({ hour: 14, minute: 30 });
    expect(parseTime("12am")).toEqual({ hour: 0, minute: 0 });
    expect(parseTime("12pm")).toEqual({ hour: 12, minute: 0 });
    expect(parseTime("2:30 AM")).toEqual({ hour: 2, minute: 30 });
  });

  test("rejects invalid times", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
    expect(parseTime("hello")).toBeNull();
  });
});
