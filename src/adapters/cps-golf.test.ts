// ABOUTME: Tests for the CPS Golf adapter.
// ABOUTME: Covers API URL construction, response parsing, error handling, and edge cases.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CpsGolfAdapter } from "./cps-golf";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/cps-golf-tee-times.json";

const mockConfig: CourseConfig = {
  id: "theodore-wirth-18",
  name: "Theodore Wirth",
  platform: "cps_golf",
  platformConfig: {
    subdomain: "minneapolistheodorewirth",
    apiKey: "8ea2914e-cac2-48a7-a3e5-e0f41350bf3a",
    courseIds: "17",
    websiteId: "8265e495-5c83-44e5-93d8-c9e3f3a40529",
  },
  bookingUrl: "https://minneapolistheodorewirth.cps.golf/onlineresweb",
};

describe("CpsGolfAdapter", () => {
  const adapter = new CpsGolfAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("cps_golf");
  });

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "theodore-wirth-18",
      time: "2026-04-15T07:00:00",
      price: 42.0,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://minneapolistheodorewirth.cps.golf/onlineresweb",
    });
  });

  it("builds the correct API URL and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ TeeTimes: [] }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("minneapolistheodorewirth.cps.golf");
    expect(url).toContain("courseIds=17");
    // CPS Golf expects "Wed Apr 15 2026" format (no commas)
    expect(url).toMatch(/searchDate=\w{3}\+\w{3}\+\d{2}\+\d{4}/);
    expect(url).not.toContain("%2C"); // no URL-encoded commas
    const headers = options?.headers as Record<string, string>;
    expect(headers["x-apikey"]).toBe(
      "8ea2914e-cac2-48a7-a3e5-e0f41350bf3a"
    );
    expect(headers["x-timezone-offset"]).toBe("300");
    expect(headers["x-timezoneid"]).toBe("America/Chicago");
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("HTTP 401");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("timeout");
  });

  it("handles 9-hole tee times", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const nineHole = results.find((t) => t.holes === 9);
    expect(nineHole).toBeDefined();
    expect(nineHole!.price).toBe(30.0);
  });

  it("throws for courses with missing apiKey", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { subdomain: "minneapolisgrossnational" },
    };

    await expect(adapter.fetchTeeTimes(incompleteConfig, "2026-04-15")).rejects.toThrow("Missing apiKey");
  });

  it("handles null TeeTimes array from API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ TeeTimes: null }), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result).toEqual([]);
  });

  it("handles null GreenFee as null price", async () => {
    const teeTimeWithNullFee = {
      TeeTimeId: 100,
      TeeDateTime: "2026-03-15T10:00:00",
      GreenFee: null,
      NumberOfOpenSlots: 4,
      Holes: 18,
      CourseId: 17,
      CourseName: "Theodore Wirth",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ TeeTimes: [teeTimeWithNullFee] }), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result).toHaveLength(1);
    expect(result[0].price).toBeNull();
  });
});
