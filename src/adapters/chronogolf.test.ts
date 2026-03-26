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

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({
      courseId: "baker-national-championship",
      time: "2026-03-28T09:15:00",
      price: 51,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://www.chronogolf.com/club/baker-national-golf-club#teetimes",
    });
  });

  it("uses bookable_holes from default_price for holes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-28");

    // Third entry is Evergreen 9-hole
    expect(results[2].holes).toBe(9);
    expect(results[2].price).toBe(21);
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

    // "9:15" -> "2026-03-28T09:15:00"
    expect(results[0].time).toBe("2026-03-28T09:15:00");
    // "10:05" -> "2026-03-28T10:05:00"
    expect(results[1].time).toBe("2026-03-28T10:05:00");
    // "11:03" -> "2026-03-28T11:03:00"
    expect(results[3].time).toBe("2026-03-28T11:03:00");
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

    expect(results[0].openSlots).toBe(4); // max_player_size: 4
    expect(results[1].openSlots).toBe(2); // max_player_size: 2
    expect(results[3].openSlots).toBe(1); // max_player_size: 1
  });
});
