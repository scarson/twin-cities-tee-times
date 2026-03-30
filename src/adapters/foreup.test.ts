// ABOUTME: Tests for the ForeUp adapter.
// ABOUTME: Covers API URL construction, response parsing, price edge cases, and errors.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForeUpAdapter } from "./foreup";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/foreup-tee-times.json";
import bunkerFixture from "@/test/fixtures/foreup-bunker-hills.json";

const mockConfig: CourseConfig = {
  id: "braemar",
  name: "Braemar",
  platform: "foreup",
  platformConfig: {
    facilityId: "21445",
    scheduleId: "7829",
  },
  bookingUrl: "https://foreupsoftware.com/index.php/booking/21445/7829",
};

describe("ForeUpAdapter", () => {
  const adapter = new ForeUpAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("foreup");
  });

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "braemar",
      time: "2026-04-15T07:00:00",
      price: 45.0,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://foreupsoftware.com/index.php/booking/21445/7829",
    });
  });

  it("builds the correct API URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("foreupsoftware.com");
    expect(url).toContain("date=04-15-2026");
    expect(url).toContain("time=all");
    expect(url).toContain("holes=0");
    expect(url).toContain("players=0");
    expect(url).toContain("booking_class=default");
    expect(url).toContain("specials_only=0");
    expect(url).toContain("schedule_id=7829");
    expect(url).toContain("api_key=no_limits");
  });

  it("throws on fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fail"));

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("fail");
  });

  it("converts time string to ISO 8601", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].time).toBe("2026-04-15T07:00:00");
  });

  it("throws for courses with missing scheduleId", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: {},
    };

    await expect(adapter.fetchTeeTimes(incompleteConfig, "2026-04-15")).rejects.toThrow("Missing scheduleId");
  });

  it("handles null green_fee", async () => {
    const noPrice = [{ ...fixture[0], green_fee: null }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(noPrice), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].price).toBeNull();
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-03-15")).rejects.toThrow("HTTP 500");
  });

  it("throws on malformed JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not json {{{", { status: 200 })
    );
    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow();
  });

  it("throws on 429 rate-limited response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 })
    );
    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("429");
  });

  it("parses nines from teesheet_side_name fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(bunkerFixture), { status: 200 })
    );

    const bunkerConfig: CourseConfig = {
      id: "bunker-hills",
      name: "Bunker Hills",
      platform: "foreup",
      platformConfig: { facilityId: "20252", scheduleId: "5010" },
      bookingUrl: "https://foreupsoftware.com/index.php/booking/20252",
    };

    const results = await adapter.fetchTeeTimes(bunkerConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0].nines).toBe("East/West");
    expect(results[1].nines).toBe("West/North");
    expect(results[2].nines).toBe("North/East");
  });

  it("omits nines when teesheet_side_name is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].nines).toBeUndefined();
  });

  it("omits nines when side names are non-informative placeholders", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{
        time: "2026-04-15 08:00",
        green_fee: "16.25",
        holes: 9,
        available_spots: 4,
        schedule_id: 7829,
        teesheet_side_name: "New Tee Sheet",
        reround_teesheet_side_name: "New Tee Sheet",
      }]), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].nines).toBeUndefined();
  });

  it("omits nines when only teesheet_side_name is set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{
        time: "2026-04-15 08:00",
        green_fee: "45.00",
        holes: 18,
        available_spots: 4,
        schedule_id: 7829,
        teesheet_side_name: "East",
        reround_teesheet_side_name: null,
      }]), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].nines).toBeUndefined();
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("parses string holes value '9/18' as 18", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{
        time: "2026-04-15 08:00",
        green_fee: "45.00",
        holes: "9/18",
        available_spots: 4,
        schedule_id: 7829,
      }]), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].holes).toBe(18);
  });

  it("parses string holes value '9' as 9", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{
        time: "2026-04-15 08:00",
        green_fee: "25.00",
        holes: "9",
        available_spots: 4,
        schedule_id: 7829,
      }]), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].holes).toBe(9);
  });

  it("returns null price for non-numeric green_fee", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{
        time: "2026-03-15 08:00",
        green_fee: "free",
        holes: 18,
        available_spots: 4,
        schedule_id: 7829,
      }]), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result[0].price).toBeNull();
  });
});
