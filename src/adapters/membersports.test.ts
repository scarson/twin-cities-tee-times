// ABOUTME: Tests for the MemberSports platform adapter.
// ABOUTME: Covers time conversion, slot filtering, availability calculation, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemberSportsAdapter } from "./membersports";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/membersports-tee-times.json";

const mockConfig: CourseConfig = {
  id: "river-oaks",
  name: "River Oaks Municipal",
  platform: "membersports",
  platformConfig: {
    golfClubId: "9431",
    golfCourseId: "11701",
  },
  bookingUrl: "https://app.membersports.com/tee-times/9431/11701/0",
};

describe("MemberSportsAdapter", () => {
  const adapter = new MemberSportsAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("membersports");
  });

  it("parses tee times and converts minutes to ISO time", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      courseId: "river-oaks",
      time: "2026-04-15T08:00:00",
      price: 42,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://app.membersports.com/tee-times/9431/11701/0",
    });
  });

  it("converts minutes since midnight to HH:MM format", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].time).toBe("2026-04-15T08:00:00");
    expect(results[1].time).toBe("2026-04-15T08:12:00");
  });

  it("calculates open slots as 4 - playerCount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].openSlots).toBe(4);
    expect(results[1].openSlots).toBe(2);
  });

  it("filters out fully booked slots (playerCount >= 4)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:24:00");
  });

  it("filters out bookingNotAllowed slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:36:00");
  });

  it("filters out hidden slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:48:00");
  });

  it("filters out slots with empty items array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T09:00:00");
  });

  it("sends correct POST body with integer IDs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://api.membersports.com/api/v1.0/GolfClubs/onlineBookingTeeTimes"
    );
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    expect(body.golfClubId).toBe(9431);
    expect(typeof body.golfClubId).toBe("number");
    expect(body.golfCourseId).toBe(11701);
    expect(typeof body.golfCourseId).toBe("number");
    expect(body.date).toBe("2026-04-15");
    expect(body.configurationTypeId).toBe(0);
    expect(body.memberProfileId).toBe(0);
  });

  it("sends x-api-key header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("A9814038-9E19-4683-B171-5A06B39147FC");
  });

  it("returns empty array for empty API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
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
  it("throws when golfClubId is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { golfCourseId: "11701" },
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("golfClubId");
  });

  it("throws when golfCourseId is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { golfClubId: "9431" },
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("golfCourseId");
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
