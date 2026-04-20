// ABOUTME: Tests for the Chronogolf adapter.
// ABOUTME: Covers API URL construction, response parsing, error handling, and missing config.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChronogolfAdapter } from "./chronogolf";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/chronogolf-tee-times.json";

const mockConfig: CourseConfig = {
  id: "baker-national-championship",
  name: "Baker National Championship",
  platform: "chronogolf",
  platformConfig: {
    clubSlug: "baker-national-golf-club",
    courseId: "e9d8899b-a26b-44fa-a6f6-ebaec3db1656",
  },
  bookingUrl: "https://www.chronogolf.com/club/baker-national-golf-club#teetimes",
};

describe("ChronogolfAdapter", () => {
  const adapter = new ChronogolfAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("chronogolf");
  });

  it("parses tee times from API response with multi-hole expansion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    // Fixture has 4 records, all with course.bookable_holes: [9, 18].
    // Each expands to 2 variants (holes=9 and holes=18), so 8 total.
    expect(results).toHaveLength(8);

    // First record (Baker Championship, 9:15, default bookable_holes=18) expands
    // to a holes=9 record (price=null) and a holes=18 record (price=51).
    const first9 = results.find((r) => r.time === "2026-03-28T09:15:00" && r.holes === 9)!;
    const first18 = results.find((r) => r.time === "2026-03-28T09:15:00" && r.holes === 18)!;
    expect(first9).toEqual({
      courseId: "baker-national-championship",
      time: "2026-03-28T09:15:00",
      price: null,
      holes: 9,
      openSlots: 4,
      bookingUrl: "https://www.chronogolf.com/club/baker-national-golf-club#teetimes",
    });
    expect(first18).toEqual({
      courseId: "baker-national-championship",
      time: "2026-03-28T09:15:00",
      price: 51,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://www.chronogolf.com/club/baker-national-golf-club#teetimes",
    });
  });

  it("uses default_price.bookable_holes to determine which variant gets the known price", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    // Evergreen record (start_time 9:10) has default_price.bookable_holes: 9.
    // The 9-hole variant should carry the known price ($21); the 18-hole variant
    // is expanded with price=null.
    const evergreen9 = results.find((r) => r.time === "2026-03-28T09:10:00" && r.holes === 9)!;
    const evergreen18 = results.find((r) => r.time === "2026-03-28T09:10:00" && r.holes === 18)!;
    expect(evergreen9.price).toBe(21);
    expect(evergreen18.price).toBeNull();
  });

  it("builds the correct API URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "open", teetimes: [] }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("chronogolf.com/marketplace/v2/teetimes");
    expect(url).toContain("start_date=2026-03-28");
    expect(url).toContain("course_ids=e9d8899b-a26b-44fa-a6f6-ebaec3db1656");
    expect(url).toContain("start_time=00%3A00");
    expect(url).toContain("page=1");
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-03-28")).rejects.toThrow("HTTP 500");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fetch failed"));

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-03-28")).rejects.toThrow("fetch failed");
  });

  it("throws when courseId is missing", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { clubSlug: "baker-national-golf-club" },
    };

    await expect(adapter.fetchTeeTimes(incompleteConfig, "2026-03-28")).rejects.toThrow("courseId");
  });

  it("returns empty array when no tee times available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "open", teetimes: [] }), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");
    expect(results).toEqual([]);
  });

  it("converts start_time to ISO local time", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    // With multi-hole expansion, each original record produces 2 results.
    // Verify each expected start_time is present somewhere in the results.
    const times = new Set(results.map((r) => r.time));
    expect(times.has("2026-03-28T09:15:00")).toBe(true);
    expect(times.has("2026-03-28T10:05:00")).toBe(true);
    expect(times.has("2026-03-28T09:10:00")).toBe(true);
    expect(times.has("2026-03-28T11:03:00")).toBe(true);
  });

  it("fetches all pages when results span multiple pages", async () => {
    const page1 = {
      status: "open",
      teetimes: Array.from({ length: 24 }, (_, i) => ({
        start_time: `${7 + Math.floor(i / 4)}:${(i % 4) * 15 || "00"}`,
        date: "2026-04-06",
        max_player_size: 4,
        default_price: { green_fee: 30, bookable_holes: 18 },
      })),
    };
    const page2 = {
      status: "open",
      teetimes: Array.from({ length: 10 }, (_, i) => ({
        start_time: `${13 + Math.floor(i / 4)}:${(i % 4) * 15 || "00"}`,
        date: "2026-04-06",
        max_player_size: 4,
        default_price: { green_fee: 30, bookable_holes: 18 },
      })),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-06");

    expect(results).toHaveLength(34);
    // Page 2 returned < 24 results, so no page 3 fetch needed
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain("page=1");
    expect(fetchSpy.mock.calls[1][0]).toContain("page=2");
  });

  it("stops paginating when a page returns fewer than 24 results", async () => {
    const page1 = {
      status: "open",
      teetimes: Array.from({ length: 20 }, (_, i) => ({
        start_time: `${7 + Math.floor(i / 4)}:${(i % 4) * 15 || "00"}`,
        date: "2026-04-06",
        max_player_size: 4,
        default_price: { green_fee: 30, bookable_holes: 18 },
      })),
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }));

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-06");

    expect(results).toHaveLength(20);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "open", teetimes: [] }), { status: 200 }),
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses max_player_size for openSlots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    // After expansion, both variants from a given record carry the same openSlots.
    const at915 = results.find((r) => r.time === "2026-03-28T09:15:00")!;
    const at1005 = results.find((r) => r.time === "2026-03-28T10:05:00")!;
    const at1103 = results.find((r) => r.time === "2026-03-28T11:03:00")!;
    expect(at915.openSlots).toBe(4);
    expect(at1005.openSlots).toBe(2);
    expect(at1103.openSlots).toBe(1);
  });

  it("expands multi-hole courses (course.bookable_holes array) into two records", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        teetimes: [
          {
            start_time: "8:00",
            date: "2026-04-15",
            max_player_size: 4,
            course: { bookable_holes: [9, 18] },
            default_price: { green_fee: 55, bookable_holes: 18 },
          },
        ],
      }), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.holes).sort((a, b) => a - b)).toEqual([9, 18]);
    const v18 = results.find((r) => r.holes === 18)!;
    const v9 = results.find((r) => r.holes === 9)!;
    expect(v18.price).toBe(55);
    expect(v9.price).toBeNull();
    expect(v9.time).toBe(v18.time);
    expect(v9.openSlots).toBe(v18.openSlots);
  });

  it("emits a single record when course.bookable_holes is a single number", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        teetimes: [
          {
            start_time: "8:00",
            date: "2026-04-15",
            max_player_size: 4,
            course: { bookable_holes: 18 },
            default_price: { green_fee: 55, bookable_holes: 18 },
          },
        ],
      }), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
    expect(results[0].price).toBe(55);
  });

  it("emits a single record when course.bookable_holes is [18] (array with one value)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        teetimes: [
          {
            start_time: "8:00",
            date: "2026-04-15",
            max_player_size: 4,
            course: { bookable_holes: [18] },
            default_price: { green_fee: 55, bookable_holes: 18 },
          },
        ],
      }), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
  });

  it("defaults to a single 18-hole record when course.bookable_holes is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        teetimes: [
          {
            start_time: "8:00",
            date: "2026-04-15",
            max_player_size: 4,
            course: {},
            default_price: { green_fee: 55, bookable_holes: 18 },
          },
        ],
      }), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
  });

  it("defaults to a single record when course.bookable_holes is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        teetimes: [
          {
            start_time: "8:00",
            date: "2026-04-15",
            max_player_size: 4,
            course: { bookable_holes: null },
            default_price: { green_fee: 55, bookable_holes: 18 },
          },
        ],
      }), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
  });

  it("falls back to the default variant when course.bookable_holes contains only unrecognized values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        teetimes: [
          {
            start_time: "8:00",
            date: "2026-04-15",
            max_player_size: 4,
            course: { bookable_holes: [27] },
            default_price: { green_fee: 55, bookable_holes: 18 },
          },
        ],
      }), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
  });
});
