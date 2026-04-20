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

  it("parses tee times and emits one record per roundType price variant", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Fixture: 08:00 and 08:09 each have both NINE_HOLE ($30) and EIGHTEEN_HOLE
    // ($50) prices → 2 records each. 08:36 has only NINE_HOLE ($25) → 1 record.
    // 08:18 is fully booked, 08:27 is held. Total: 5 records.
    expect(results).toHaveLength(5);

    const at0800_18 = results.find(
      (r) => r.time === "2026-04-15T08:00:00" && r.holes === 18
    )!;
    const at0800_9 = results.find(
      (r) => r.time === "2026-04-15T08:00:00" && r.holes === 9
    )!;
    expect(at0800_18).toEqual({
      courseId: "stoneridge",
      time: "2026-04-15T08:00:00",
      price: 50,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://stoneridgegc.teesnap.net",
    });
    expect(at0800_9).toEqual({
      courseId: "stoneridge",
      time: "2026-04-15T08:00:00",
      price: 30,
      holes: 9,
      openSlots: 4,
      bookingUrl: "https://stoneridgegc.teesnap.net",
    });
  });

  it("calculates open slots from booking golfer counts (same across both variants)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Both variants at a given time share the same openSlots (per-slot, not per-price).
    const at0800 = results.filter((r) => r.time === "2026-04-15T08:00:00");
    const at0809 = results.filter((r) => r.time === "2026-04-15T08:09:00");
    expect(at0800.every((r) => r.openSlots === 4)).toBe(true);
    expect(at0809.every((r) => r.openSlots === 2)).toBe(true);
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

  it("handles sections with null bookings array", async () => {
    const nullBookingsFixture = {
      teeTimes: {
        bookings: [],
        teeTimes: [
          {
            teeTime: "2026-04-15T09:00:00",
            prices: [
              { roundType: "EIGHTEEN_HOLE", rackRatePrice: "55.00", price: "50.00" },
            ],
            teeOffSections: [
              { teeOff: "FRONT_NINE", bookings: null, isHeld: false },
            ],
          },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(nullBookingsFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(1);
    expect(results[0].openSlots).toBe(4);
  });

  it("uses 18-hole promotional price (not rack rate)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const at0800_18 = results.find(
      (r) => r.time === "2026-04-15T08:00:00" && r.holes === 18
    )!;
    // rackRatePrice is 55, promotional price is 50 — we prefer the latter.
    expect(at0800_18.price).toBe(50);
  });

  it("emits only a 9-hole record when only NINE_HOLE price exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const at0836 = results.filter((r) => r.time === "2026-04-15T08:36:00");
    expect(at0836).toHaveLength(1);
    expect(at0836[0].price).toBe(25);
    expect(at0836[0].holes).toBe(9);
  });

  it("emits both variants when both NINE_HOLE and EIGHTEEN_HOLE prices exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const at0800 = results.filter((r) => r.time === "2026-04-15T08:00:00");
    expect(at0800).toHaveLength(2);
    expect(at0800.map((r) => r.holes).sort((a, b) => a - b)).toEqual([9, 18]);
  });

  it("skips slots with empty prices array (per decision D-1)", async () => {
    const emptyPricesFixture = {
      teeTimes: {
        bookings: [],
        teeTimes: [
          {
            teeTime: "2026-04-15T10:00:00",
            prices: [],
            teeOffSections: [{ teeOff: "FRONT_NINE", bookings: [], isHeld: false }],
          },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(emptyPricesFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(0);
  });

  it("skips unknown roundType values without crashing", async () => {
    const unknownRoundTypeFixture = {
      teeTimes: {
        bookings: [],
        teeTimes: [
          {
            teeTime: "2026-04-15T10:00:00",
            prices: [
              { roundType: "TWENTY_SEVEN_HOLE", rackRatePrice: "80.00", price: "80.00" },
              { roundType: "EIGHTEEN_HOLE", rackRatePrice: "55.00", price: "50.00" },
            ],
            teeOffSections: [{ teeOff: "FRONT_NINE", bookings: [], isHeld: false }],
          },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(unknownRoundTypeFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
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

  it("sends browser-like headers including Referer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
    expect(headers.Accept).toBe("application/json, text/plain, */*");
    expect(headers["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(headers.Referer).toBe("https://stoneridgegc.teesnap.net/");
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
