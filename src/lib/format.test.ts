// ABOUTME: Tests for shared time/date formatting utilities.
// ABOUTME: Covers formatTime, formatAge, and staleAge with boundary conditions.

import { describe, it, expect, vi, afterEach } from "vitest";
import { formatTime, formatAge, staleAge, todayCT } from "./format";

describe("formatTime", () => {
  it("formats morning time", () => {
    expect(formatTime("09:30")).toBe("9:30 AM");
  });

  it("formats afternoon time", () => {
    expect(formatTime("14:00")).toBe("2:00 PM");
  });

  it("formats noon as 12 PM", () => {
    expect(formatTime("12:00")).toBe("12:00 PM");
  });

  it("formats midnight as 12 AM", () => {
    expect(formatTime("00:00")).toBe("12:00 AM");
  });

  it("formats 1 PM", () => {
    expect(formatTime("13:00")).toBe("1:00 PM");
  });

  it("formats 11:59 AM", () => {
    expect(formatTime("11:59")).toBe("11:59 AM");
  });
});

describe("formatAge", () => {
  it("returns 'just now' for < 1 minute", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatAge(recent)).toBe("just now");
  });

  it("returns minutes for < 1 hour", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatAge(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours for < 24 hours", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatAge(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days for >= 24 hours", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
    expect(formatAge(twoDaysAgo)).toBe("2d ago");
  });

  it("boundary: 59 minutes returns minutes", () => {
    const ts = new Date(Date.now() - 59 * 60_000).toISOString();
    expect(formatAge(ts)).toBe("59m ago");
  });

  it("boundary: 60 minutes returns 1h", () => {
    const ts = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(formatAge(ts)).toBe("1h ago");
  });

  it("boundary: 23 hours returns hours", () => {
    const ts = new Date(Date.now() - 23 * 3_600_000).toISOString();
    expect(formatAge(ts)).toBe("23h ago");
  });

  it("boundary: 24 hours returns 1d", () => {
    const ts = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(formatAge(ts)).toBe("1d ago");
  });
});

describe("staleAge", () => {
  it("returns hours for < 24h", () => {
    const ts = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("2h old");
  });

  it("returns days for >= 24h", () => {
    const ts = new Date(Date.now() - 72 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("3d old");
  });

  it("returns 1h for data just past stale threshold (76 min)", () => {
    const ts = new Date(Date.now() - 76 * 60_000).toISOString();
    expect(staleAge(ts)).toBe("1h old");
  });

  it("boundary: 23h returns hours", () => {
    const ts = new Date(Date.now() - 23 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("23h old");
  });

  it("boundary: 24h returns 1d", () => {
    const ts = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("1d old");
  });
});

describe("todayCT", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a YYYY-MM-DD string", () => {
    const result = todayCT();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns Central Time date, not UTC, near midnight", () => {
    vi.useFakeTimers();
    // 4:30 UTC on July 15 = 11:30pm CDT on July 14 (CDT = UTC-5)
    vi.setSystemTime(new Date("2026-07-15T04:30:00Z"));
    expect(todayCT()).toBe("2026-07-14");
  });
});
