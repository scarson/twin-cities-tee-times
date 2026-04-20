// ABOUTME: Tests for the TeeItUp adapter.
// ABOUTME: Covers API URL construction, response parsing, rate selection, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeeItUpAdapter } from "./teeitup";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/teeitup-tee-times.json";

const mockConfig: CourseConfig = {
  id: "keller",
  name: "Keller Golf Course",
  platform: "teeitup",
  platformConfig: {
    alias: "ramsey-county-golf",
    apiBase: "https://phx-api-be-east-1b.kenna.io",
    facilityId: "17055",
  },
  bookingUrl: "https://ramsey-county-golf.book.teeitup.com",
};

describe("TeeItUpAdapter", () => {
  const adapter = new TeeItUpAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("teeitup");
  });

  it("converts UTC tee times to local timezone (default Central)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    expect(results).toHaveLength(3);
    // Fixture dates are March 11 2026 — CDT (UTC-5) is in effect (DST starts March 8)
    // 17:50 UTC → 12:50 CDT
    expect(results[0]).toEqual({
      courseId: "keller",
      time: "2026-03-11T12:50:00",
      price: 35,
      holes: 18,
      openSlots: 1,
      bookingUrl: "https://ramsey-county-golf.book.teeitup.com",
    });
    // 23:40 UTC → 18:40 CDT
    expect(results[1].time).toBe("2026-03-11T18:40:00");
    // 00:00 UTC Mar 12 → 19:00 CDT Mar 11 (date boundary crossing)
    expect(results[2].time).toBe("2026-03-11T19:00:00");
  });

  it("uses promo price when promotion exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    // Second tee time has promotion: greenFeeWalking 3000 cents = $30
    expect(results[1].price).toBe(30);
    // Third tee time has promotion: greenFeeWalking 2400 cents = $24
    expect(results[2].price).toBe(24);
  });

  it("derives open slots from maxPlayers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    // First: maxPlayers=1 (1 open slot, 3 already booked)
    expect(results[0].openSlots).toBe(1);
    // Second: maxPlayers=4 (4 open slots, none booked)
    expect(results[1].openSlots).toBe(4);
  });

  it("builds the correct API URL and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ teetimes: [] }]), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=2026-04-15&facilityIds=17055"
    );
    const headers = options?.headers as Record<string, string>;
    expect(headers["x-be-alias"]).toBe("ramsey-county-golf");
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-11")
    ).rejects.toThrow("HTTP 500");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-11")
    ).rejects.toThrow("timeout");
  });

  it("throws when alias is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { apiBase: "https://x.kenna.io", facilityId: "1" },
    };

    await expect(adapter.fetchTeeTimes(bad, "2026-03-11")).rejects.toThrow(
      "Missing alias"
    );
  });

  it("throws when apiBase is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { alias: "test", facilityId: "1" },
    };

    await expect(adapter.fetchTeeTimes(bad, "2026-03-11")).rejects.toThrow(
      "Missing apiBase"
    );
  });

  it("throws when facilityId is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { alias: "test", apiBase: "https://x.kenna.io" },
    };

    await expect(adapter.fetchTeeTimes(bad, "2026-03-11")).rejects.toThrow(
      "Missing facilityId"
    );
  });

  it("handles empty teetimes array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ teetimes: [] }]), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(result).toEqual([]);
  });

  it("handles empty response array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(result).toEqual([]);
  });

  it("skips tee times with empty rates", async () => {
    const noRates = [
      {
        teetimes: [
          { ...fixture[0].teetimes[0], rates: [] },
          fixture[0].teetimes[1],
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(noRates), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(1);
  });

  it("skips tee times with zero maxPlayers", async () => {
    const fullyBooked = [
      {
        teetimes: [
          { ...fixture[0].teetimes[0], maxPlayers: 0 },
          fixture[0].teetimes[1],
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fullyBooked), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(1);
  });

  it("uses per-course timezone when specified", async () => {
    const pacificConfig: CourseConfig = {
      ...mockConfig,
      id: "sd-lomas",
      platformConfig: {
        ...mockConfig.platformConfig,
        timezone: "America/Los_Angeles",
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(pacificConfig, "2026-03-11");

    // PDT (UTC-7) in effect — 17:50 UTC → 10:50 PDT
    expect(results[0].time).toBe("2026-03-11T10:50:00");
    // 23:40 UTC → 16:40 PDT
    expect(results[1].time).toBe("2026-03-11T16:40:00");
    // 00:00 UTC Mar 12 → 17:00 PDT Mar 11
    expect(results[2].time).toBe("2026-03-11T17:00:00");
  });

  it("passes through non-UTC timestamps unchanged", async () => {
    const localTimeFixture = [{
      teetimes: [{
        ...fixture[0].teetimes[0],
        teetime: "2026-03-11T12:50:00",
      }],
    }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(localTimeFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    expect(results[0].time).toBe("2026-03-11T12:50:00");
  });

  it("skips trade rates and uses first non-trade rate", async () => {
    const withTrade = [
      {
        teetimes: [
          {
            ...fixture[0].teetimes[0],
            rates: [
              { ...fixture[0].teetimes[0].rates[0], trade: true, greenFeeWalking: 9999 },
              { ...fixture[0].teetimes[0].rates[0], trade: false, greenFeeWalking: 3500 },
            ],
          },
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(withTrade), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results[0].price).toBe(35);
  });

  it("emits one record per hole variant when rates array has multiple hole counts", async () => {
    // Multi-hole slot: one rate for 18 holes, one rate for 9 holes. Both
    // non-trade so the non-trade preference doesn't interfere.
    const multiHole = [
      {
        teetimes: [
          {
            ...fixture[0].teetimes[0],
            rates: [
              { ...fixture[0].teetimes[0].rates[0], holes: 18, trade: false, greenFeeWalking: 5500 },
              { ...fixture[0].teetimes[0].rates[0], holes: 9, trade: false, greenFeeWalking: 3000 },
            ],
          },
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(multiHole), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.holes).sort((a, b) => a - b)).toEqual([9, 18]);
    const v18 = results.find((r) => r.holes === 18)!;
    const v9 = results.find((r) => r.holes === 9)!;
    expect(v18.price).toBe(55);
    expect(v9.price).toBe(30);
  });

  it("preserves non-trade preference within each hole group", async () => {
    // Two 18-hole rates (one trade, one not) and one 9-hole rate. The 18-hole
    // group should select the non-trade rate.
    const multiHoleWithTrade = [
      {
        teetimes: [
          {
            ...fixture[0].teetimes[0],
            rates: [
              { ...fixture[0].teetimes[0].rates[0], holes: 18, trade: true, greenFeeWalking: 9999 },
              { ...fixture[0].teetimes[0].rates[0], holes: 18, trade: false, greenFeeWalking: 5500 },
              { ...fixture[0].teetimes[0].rates[0], holes: 9, trade: false, greenFeeWalking: 3000 },
            ],
          },
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(multiHoleWithTrade), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(2);
    const v18 = results.find((r) => r.holes === 18)!;
    expect(v18.price).toBe(55); // non-trade 5500 cents, not trade 9999
  });

  it("emits a single record when all rates share the same holes value (regression)", async () => {
    // Existing behavior: fixture has single-hole-count rates arrays; after fix,
    // each slot still emits exactly one record when all rates are same-holes.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.holes === 18)).toBe(true);
  });
});
