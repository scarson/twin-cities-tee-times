// ABOUTME: Tests for the Teesnap platform adapter.
// ABOUTME: Covers availability calculation, price mapping, held sections, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeensnapAdapter } from "./teesnap";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/teesnap-tee-times.json";

const mockConfig: CourseConfig = {
  id: "stoneridge",
  name: "StoneRidge",
  platform: "teesnap",
  platformConfig: {
    subdomain: "stoneridgegc",
    courseId: "1320",
  },
  bookingUrl: "https://stoneridgegc.teesnap.net",
};

describe("TeensnapAdapter", () => {
  const adapter = new TeensnapAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("teesnap");
  });

  it("parses tee times and calculates availability", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "stoneridge",
      time: "2026-04-15T08:00:00",
      price: 50,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://stoneridgegc.teesnap.net",
    });
  });

  it("calculates open slots from booking golfer counts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].openSlots).toBe(4);
    expect(results[1].openSlots).toBe(2);
  });

  it("filters out fully booked slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:18:00");
  });

  it("filters out held sections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:27:00");
  });

  it("uses 18-hole promotional price (not rack rate) when available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].price).toBe(50);
    expect(results[0].holes).toBe(18);
  });

  it("falls back to 9-hole price when no 18-hole price exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const nineHoleSlot = results.find((r) => r.time === "2026-04-15T08:36:00");
    expect(nineHoleSlot?.price).toBe(25);
    expect(nineHoleSlot?.holes).toBe(9);
  });

  // PITFALL WARNING (testing-pitfalls.md §1.1): date_not_allowed is the ONLY case where
  // returning [] is correct. All actual errors must THROW.
  it("returns empty array for date_not_allowed (closed course)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: "date_not_allowed" }), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-01-15");
    expect(results).toEqual([]);
  });

  it("returns empty array when teeTimes.teeTimes is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  // PITFALL (testing-pitfalls.md §6.4): Unexpected response shape must throw, not return [].
  it("throws when response is missing teeTimes property entirely", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow();
  });

  it("builds correct API URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://stoneridgegc.teesnap.net/customer-api/teetimes-day?course=1320&date=2026-04-15&players=1&holes=18&addons=off"
    );
  });

  it("sends browser-like User-Agent header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
  });

  // PITFALL (testing-pitfalls.md §1.1): HTTP errors must THROW, never return [].
  it("throws on HTTP error (does NOT return empty array)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("HTTP 500");
  });

  it("throws on HTTP 403 (CDN bot block)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("HTTP 403");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("network failure")
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("network failure");
  });

  // PITFALL (testing-pitfalls.md §6.2): Malformed response must throw, not return [].
  it("throws on malformed JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not json", { status: 200 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow();
  });

  // PITFALL (testing-pitfalls.md §3.1): Missing config must throw, not silently fail.
  it("throws when subdomain is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { courseId: "1320" },
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("subdomain");
  });

  it("throws when courseId is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { subdomain: "stoneridgegc" },
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("courseId");
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
