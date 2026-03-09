// ABOUTME: Tests for tee-time-list staleness detection.
// ABOUTME: Verifies the 75-minute threshold for marking tee times as stale.

import { describe, it, expect, vi, afterEach } from "vitest";
import { isStale, STALE_THRESHOLD_MS } from "./tee-time-list";

describe("isStale", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false for data fetched just now", () => {
    expect(isStale(new Date().toISOString())).toBe(false);
  });

  it("returns false for data fetched 74 minutes ago", () => {
    const fetchedAt = new Date(Date.now() - 74 * 60 * 1000).toISOString();
    expect(isStale(fetchedAt)).toBe(false);
  });

  it("returns true for data fetched 76 minutes ago", () => {
    const fetchedAt = new Date(Date.now() - 76 * 60 * 1000).toISOString();
    expect(isStale(fetchedAt)).toBe(true);
  });

  it("returns true for data fetched 3 hours ago", () => {
    const fetchedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(isStale(fetchedAt)).toBe(true);
  });

  it("has a threshold of 75 minutes", () => {
    expect(STALE_THRESHOLD_MS).toBe(75 * 60 * 1000);
  });
});
