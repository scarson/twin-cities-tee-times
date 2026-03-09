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
  it("converts a Date to YYYY-MM-DD string", () => {
    // Use noon local to avoid UTC/local day mismatch
    const d = new Date(2026, 2, 15, 12, 0, 0); // March 15, noon local
    expect(toDateStr(d)).toBe("2026-03-15");
  });
});

describe("fromDateStr", () => {
  it("parses YYYY-MM-DD to a Date at local midnight", () => {
    const d = fromDateStr("2026-03-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed: March = 2
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});

describe("buildQuickDays", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 7 entries", () => {
    const days = buildQuickDays();
    expect(days).toHaveLength(7);
  });

  it("first entry is labeled 'Today'", () => {
    const days = buildQuickDays();
    expect(days[0].dayName).toBe("Today");
  });

  it("entries have sequential dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0)); // March 15

    const days = buildQuickDays();
    expect(days[0].value).toBe("2026-03-15");
    expect(days[1].value).toBe("2026-03-16");
    expect(days[6].value).toBe("2026-03-21");
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

describe("formatShortDate", () => {
  it("formats as short month + day", () => {
    const result = formatShortDate("2026-03-09");
    expect(result).toMatch(/Mar\s+9/);
  });
});
