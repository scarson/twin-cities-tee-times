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

  it("parses tee times from API response, emitting both 9 and 18 variants when both fees are present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // 3 appointments × 2 variants (9 + 18) = 6 records
    expect(results).toHaveLength(6);
    expect(results[0]).toEqual({
      courseId: "valleywood",
      time: "2026-04-15T06:36:00",
      price: 33.3,
      holes: 18,
      openSlots: 4,
      bookingUrl:
        "https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115",
    });
    expect(results[1]).toEqual({
      courseId: "valleywood",
      time: "2026-04-15T06:36:00",
      price: 30.52,
      holes: 9,
      openSlots: 4,
      bookingUrl:
        "https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115",
    });
  });

  it("emits a single 18-hole record when only EighteenFee is present", async () => {
    const only18Fixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], NineFee: "", EighteenFee: "33.30" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(only18Fixture), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
    expect(results[0].price).toBe(33.3);
  });

  it("emits a single 9-hole record when only NineFee is present", async () => {
    const only9Fixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], NineFee: "30.52", EighteenFee: "" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(only9Fixture), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(9);
    expect(results[0].price).toBe(30.52);
  });

  it("skips appointments with neither fee populated", async () => {
    const noFeeFixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], NineFee: "", EighteenFee: "" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(noFeeFixture), { status: 200 })
    );
    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
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
    // results[0]/[1] are the 18-hole/9-hole of the 06:36 appointment;
    // results[2]/[3] are the 06:45 appointment's pair.
    expect(results[0].time).toBe("2026-04-15T06:36:00");
    expect(results[2].time).toBe("2026-04-15T06:45:00");
  });

  it("parses slots correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results[0].openSlots).toBe(4); // 06:36 / 18-hole
    expect(results[4].openSlots).toBe(2); // 06:54 / 18-hole (third appointment has Slots: 2)
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

  it("does not emit an 18-hole record when EighteenFee is empty (emits 9-hole only)", async () => {
    const emptyFeeFixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], EighteenFee: "", NineFee: "30.52" },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(emptyFeeFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(9);
    expect(results[0].price).toBe(30.52);
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

  it("emits an 18-hole record with null price when EighteenFee is present but non-numeric", async () => {
    const naFeeFixture = {
      ...fixture,
      LstAppointment: [
        { ...fixture.LstAppointment[0], EighteenFee: "N/A", NineFee: "" },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(naFeeFixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(18);
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

  it("emits 18-hole records using EighteenFee and 9-hole records using NineFee", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const r18 = results.find((r) => r.holes === 18);
    const r9 = results.find((r) => r.holes === 9);
    expect(r18?.price).toBe(33.3);
    expect(r9?.price).toBe(30.52);
  });
});
