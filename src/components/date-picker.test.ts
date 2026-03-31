// ABOUTME: Tests for date-picker helper functions.
// ABOUTME: Covers date string conversion, range generation, and formatting.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toDateStr,
  fromDateStr,
  buildQuickDays,
  datesInRange,
  formatShortDate,
} from "./date-picker";

describe("toDateStr", () => {
  it("converts a Date to YYYY-MM-DD in Central Time", () => {
    // Noon UTC: same calendar date in all timezones including CT
    const d = new Date("2026-03-15T12:00:00Z");
    expect(toDateStr(d)).toBe("2026-03-15");
  });
});

describe("fromDateStr", () => {
  it("parses YYYY-MM-DD to a Date at noon UTC", () => {
    const d = fromDateStr("2026-03-15");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2); // 0-indexed: March = 2
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(12);
  });
});

describe("buildQuickDays", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 14 entries", () => {
    const days = buildQuickDays();
    expect(days).toHaveLength(14);
  });

  it("first entry is labeled 'Today'", () => {
    const days = buildQuickDays();
    expect(days[0].dayName).toBe("Today");
  });

  it("entries have sequential dates", () => {
    vi.useFakeTimers();
    // 18:00 UTC = 1pm CDT (March is DST). CT date is still March 15.
    vi.setSystemTime(new Date("2026-03-15T18:00:00Z"));

    const days = buildQuickDays();
    expect(days[0].value).toBe("2026-03-15");
    expect(days[1].value).toBe("2026-03-16");
    expect(days[6].value).toBe("2026-03-21");
    expect(days[13].value).toBe("2026-03-28");
  });
});

describe("datesInRange", () => {
  it("returns inclusive range", () => {
    const result = datesInRange("2026-03-10", "2026-03-12");
    expect(result).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("returns single date when start equals end", () => {
    const result = datesInRange("2026-03-10", "2026-03-10");
    expect(result).toEqual(["2026-03-10"]);
  });

  it("returns empty array when start > end", () => {
    const result = datesInRange("2026-03-12", "2026-03-10");
    expect(result).toEqual([]);
  });

  it("handles month boundary", () => {
    const result = datesInRange("2026-03-30", "2026-04-02");
    expect(result).toEqual([
      "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
    ]);
  });
});

describe("toDateStr/fromDateStr roundtrip", () => {
  it("roundtrips toDateStr(fromDateStr(s)) for any date", () => {
    const dates = ["2026-01-01", "2026-03-08", "2026-06-15", "2026-11-01", "2026-12-31"];
    for (const d of dates) {
      expect(toDateStr(fromDateStr(d))).toBe(d);
    }
  });
});

describe("formatShortDate", () => {
  it("formats as short month + day", () => {
    const result = formatShortDate("2026-03-09");
    expect(result).toMatch(/Mar\s+9/);
  });
});
