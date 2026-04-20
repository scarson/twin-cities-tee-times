// ABOUTME: Tests for the TeeWire adapter.
// ABOUTME: Covers API URL construction, response parsing, walking rate selection, and errors.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxyFetch } from "@/lib/proxy-fetch";

vi.mock("@/lib/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));

import { TeeWireAdapter } from "./teewire";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/teewire-tee-times.json";

const mockConfig: CourseConfig = {
  id: "inver-wood-18",
  name: "Inver Wood (18 Hole)",
  platform: "teewire",
  platformConfig: {
    tenant: "inverwood",
    calendarId: "3",
  },
  bookingUrl: "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list",
};

describe("TeeWireAdapter", () => {
  const adapter = new TeeWireAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(proxyFetch).mockReset();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("teewire");
  });

  it("parses tee times with multi-hole rate expansion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Fixture: slot 1 (09:00) has both 9-hole and 18-hole Walking+Riding rates,
    // slot 2 (09:10) has only 18-hole rates, slot 3 (14:30) has only 9-hole.
    // Expected: slot 1 expands to 2 records, slots 2 and 3 emit 1 each. Total = 4.
    expect(results).toHaveLength(4);

    const slot1_18 = results.find(
      (r) => r.time === "2026-04-15T09:00:00" && r.holes === 18
    )!;
    expect(slot1_18).toEqual({
      courseId: "inver-wood-18",
      time: "2026-04-15T09:00:00",
      price: 51,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list",
    });
  });

  it("prefers Walking rate within each hole-count group", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Slot 1 has both Walking and Riding per hole count. We should get Walking prices only.
    const slot1_18 = results.find(
      (r) => r.time === "2026-04-15T09:00:00" && r.holes === 18
    )!;
    const slot1_9 = results.find(
      (r) => r.time === "2026-04-15T09:00:00" && r.holes === 9
    )!;
    expect(slot1_18.price).toBe(51); // 18 Walking ($51), not 18 Riding ($77)
    expect(slot1_9.price).toBe(28); // 9 Walking ($28), not 9 Riding ($44)
  });

  it("expands slot with rates for both 9 and 18 holes into two records", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const slot1 = results.filter((r) => r.time === "2026-04-15T09:00:00");
    expect(slot1).toHaveLength(2);
    expect(slot1.map((r) => r.holes).sort((a, b) => a - b)).toEqual([9, 18]);
  });

  it("emits a single record when a slot has rates for only one hole count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const slot2 = results.filter((r) => r.time === "2026-04-15T09:10:00");
    const slot3 = results.filter((r) => r.time === "2026-04-15T14:30:00");
    expect(slot2).toHaveLength(1);
    expect(slot2[0].holes).toBe(18);
    expect(slot3).toHaveLength(1);
    expect(slot3[0].holes).toBe(9);
  });

  it("builds the correct API URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { tee_times: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("teewire.app/inverwood");
    expect(url).toContain("calendar_id=3");
    expect(url).toContain("date=2026-04-15");
    expect(url).toContain("action=tee-times");
  });

  it("sets User-Agent header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { tee_times: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.headers).toBeDefined();
    const headers = new Headers(fetchOptions.headers);
    expect(headers.get("User-Agent")).toBe("TwinCitiesTeeTimes/1.0");
  });

  it("throws on HTTP 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("HTTP 500");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network fail"));

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("network fail");
  });

  it("throws when tenant is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { calendarId: "3" },
    };

    await expect(adapter.fetchTeeTimes(badConfig, "2026-04-15")).rejects.toThrow("tenant");
  });

  it("throws when calendarId is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { tenant: "inverwood" },
    };

    await expect(adapter.fetchTeeTimes(badConfig, "2026-04-15")).rejects.toThrow("calendarId");
  });

  it("returns empty array for empty tee_times", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { tee_times: [] } }), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("parses price from formatted string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const slot1_18 = results.find(
      (r) => r.time === "2026-04-15T09:00:00" && r.holes === 18
    )!;
    const slot1_9 = results.find(
      (r) => r.time === "2026-04-15T09:00:00" && r.holes === 9
    )!;
    expect(slot1_18.price).toBe(51); // "$51.00" → 51
    expect(slot1_9.price).toBe(28); // "$28.00" → 28
  });

  it("throws on success: false response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "bad request" }), { status: 200 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow();
  });

  it("filters out slots with zero available spots", async () => {
    const fixtureWithZeroSpots = {
      ...fixture,
      data: {
        ...fixture.data,
        tee_times: [
          ...fixture.data.tee_times,
          {
            slot_id: 4,
            time: "15:00:00",
            date: "2026-04-15",
            timestamp: 1776283200,
            time_us_format: "3:00pm",
            availability: { available_spots: 0, max_spots: 4, reserved_spots: 4, blocked_spots: 0, held_spots: 0 },
            pricing: {
              rates: [
                { rate_id: 33, rate_title: "18 Holes Walking", holes: 18, price: "$51.00", description: "18 Holes Walking" }
              ]
            },
            course_info: { slot_length: 10 },
            golfer_type_flags: { free_golfer: false, free_cart_fee: false },
            override_type: "seasonal_wave",
            available_holes: [18],
            cross_nine_blocked: false,
            cross_nine_detail: null
          }
        ]
      }
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixtureWithZeroSpots), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(4); // slot 1 expands to 2, slots 2 & 3 emit 1 each; added 4th slot filtered
  });

  it("uses null price for each variant when no walking rate exists (Riding-only)", async () => {
    const noWalkingFixture = {
      success: true,
      data: {
        tee_times: [
          {
            slot_id: 1,
            time: "10:00:00",
            date: "2026-04-15",
            timestamp: 1776265200,
            time_us_format: "10:00am",
            availability: { available_spots: 3, max_spots: 4, reserved_spots: 1, blocked_spots: 0, held_spots: 0 },
            pricing: {
              rates: [
                { rate_id: 35, rate_title: "18 Holes Riding", holes: 18, price: "$77.00", description: "18 Holes Riding" },
                { rate_id: 37, rate_title: "9 Holes Riding", holes: 9, price: "$44.00", description: "9 Holes Riding" }
              ]
            },
            course_info: { slot_length: 10 },
            golfer_type_flags: { free_golfer: false, free_cart_fee: false },
            override_type: "seasonal_wave",
            available_holes: [9, 18],
            cross_nine_blocked: false,
            cross_nine_detail: null
          }
        ]
      }
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(noWalkingFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    // With no Walking rate in either hole group, each variant has price=null.
    // Groups are still emitted so users can still see the slot exists.
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.holes).sort((a, b) => a - b)).toEqual([9, 18]);
    expect(results.every((r) => r.price === null)).toBe(true);
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { tee_times: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  describe("proxy mode", () => {
    const proxyEnv = {
      DB: {} as any,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      JWT_SECRET: "",
      FETCH_PROXY_URL: "https://proxy.lambda-url.us-west-2.on.aws/",
      AWS_ACCESS_KEY_ID: "AKID",
      AWS_SECRET_ACCESS_KEY: "SECRET",
    } satisfies CloudflareEnv;

    it("routes requests through proxyFetch when proxy env is set", async () => {
      vi.spyOn(globalThis, "fetch");
      vi.mocked(proxyFetch).mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify(fixture),
      });

      const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15", proxyEnv);

      expect(proxyFetch).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();

      const call = vi.mocked(proxyFetch).mock.calls[0][0];
      expect(call.url).toContain("teewire.app/inverwood");
      expect(call.url).toContain("calendar_id=3");
      expect(call.headers).toHaveProperty("User-Agent", "TwinCitiesTeeTimes/1.0");
      expect(results).toHaveLength(4);
    });

    it("falls back to direct fetch without proxy env", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(fixture), { status: 200 })
      );

      const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

      expect(proxyFetch).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(4);
    });
  });
});
