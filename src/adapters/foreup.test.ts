import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForeUpAdapter } from "./foreup";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/foreup-tee-times.json";

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
    expect(url).toContain("date=2026-04-15");
    expect(url).toContain("time=all");
    expect(url).toContain("holes=0");
    expect(url).toContain("players=0");
    expect(url).toContain("booking_class=default");
    expect(url).toContain("specials_only=0");
    expect(url).toContain("schedule_id=7829");
    expect(url).toContain("api_key=no_limits");
  });

  it("returns empty array on error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fail"));

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("converts time string to ISO 8601", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].time).toBe("2026-04-15T07:00:00");
  });

  it("skips courses with missing scheduleId", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: {},
    };

    const results = await adapter.fetchTeeTimes(incompleteConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("handles null green_fee", async () => {
    const noPrice = [{ ...fixture[0], green_fee: null }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(noPrice), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].price).toBeNull();
  });
});
