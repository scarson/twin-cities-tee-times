// ABOUTME: Tests for the TeeWire adapter.
// ABOUTME: Covers API URL construction, response parsing, walking rate selection, and errors.
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("teewire");
  });

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "inver-wood-18",
      time: "2026-04-15T09:00:00",
      price: 51,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list",
    });
  });

  it("selects walking rate price", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Walking rate is $51, not the riding rate $77
    expect(results[0].price).toBe(51);
  });

  it("determines holes from walking rate", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Slot 1: 18 Holes Walking → 18
    expect(results[0].holes).toBe(18);
    // Slot 3: 9 Holes Walking → 9
    expect(results[2].holes).toBe(9);
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

    // "$51.00" → 51
    expect(results[0].price).toBe(51);
    // "$28.00" → 28
    expect(results[2].price).toBe(28);
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
    expect(results).toHaveLength(3); // 4 slots but one has 0 spots
  });

  it("uses null price and first rate holes when no walking rate found", async () => {
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
    expect(results[0].price).toBeNull();
    expect(results[0].holes).toBe(18); // first rate's holes
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { tee_times: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
