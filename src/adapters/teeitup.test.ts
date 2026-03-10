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

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "keller",
      time: "2026-03-11T17:50:00.000Z",
      price: 35,
      holes: 18,
      openSlots: 1,
      bookingUrl: "https://ramsey-county-golf.book.teeitup.com",
    });
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
});
