// ABOUTME: Tests for the Eagle Club Systems adapter.
// ABOUTME: Covers API request format, response parsing, price extraction, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EagleClubAdapter } from "./eagle-club";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/eagle-club-tee-times.json";

const mockConfig: CourseConfig = {
  id: "valleywood",
  name: "Valleywood",
  platform: "eagle_club",
  platformConfig: {
    dbname: "mnvalleywood20250115",
  },
  bookingUrl:
    "https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115",
};

describe("EagleClubAdapter", () => {
  const adapter = new EagleClubAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("eagle_club");
  });

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "valleywood",
      time: "2026-04-15T06:36:00",
      price: 33.3,
      holes: 18,
      openSlots: 4,
      bookingUrl:
        "https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115",
    });
  });

  it("sends correct POST body with BCC and date", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ BG: { BoolSuccess: true }, LstAppointment: [] }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://api.eagleclubsystems.online/api/online/OnlineAppointmentRetrieve"
    );
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    expect(body.BCC.StrDatabase).toBe("mnvalleywood20250115");
    expect(body.StrDate).toBe("20260415");
    expect(body.StrTime).toBe("0000");
  });

  it("converts HHMM time to ISO 8601", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].time).toBe("2026-04-15T06:36:00");
    expect(results[1].time).toBe("2026-04-15T06:45:00");
  });

  it("parses slots correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].openSlots).toBe(4);
    expect(results[2].openSlots).toBe(2);
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
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

  it("throws when dbname is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: {},
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("dbname");
  });

  it("returns empty array when no appointments available", async () => {
    const emptyResponse = {
      BG: { BoolSuccess: true },
      LstAppointment: [],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(emptyResponse), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("throws on API-level error (BoolSuccess false)", async () => {
    const errorResponse = {
      BG: {
        BoolSuccess: false,
        StrResult: "Software version is out of date.",
        StrExceptions: [],
      },
      LstAppointment: [],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(errorResponse), { status: 200 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("Software version is out of date");
  });

  it("returns null price when EighteenFee is empty", async () => {
    const emptyFeeFixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], EighteenFee: "" },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(emptyFeeFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].price).toBeNull();
  });

  it("uses StrExceptions when BoolSuccess is false and StrResult is empty", async () => {
    const errorResponse = {
      BG: {
        BoolSuccess: false,
        StrResult: "",
        StrExceptions: ["Connection timeout", "Retry failed"],
      },
      LstAppointment: [],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(errorResponse), { status: 200 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("Connection timeout; Retry failed");
  });

  it("returns null price for non-numeric EighteenFee", async () => {
    const naFeeFixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], EighteenFee: "N/A" },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(naFeeFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].price).toBeNull();
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ BG: { BoolSuccess: true }, LstAppointment: [] }),
        { status: 200 },
      ),
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses EighteenFee as price for 18-hole course", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].price).toBe(33.3);
  });
});
