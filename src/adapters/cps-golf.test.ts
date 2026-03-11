// ABOUTME: Tests for the CPS Golf adapter.
// ABOUTME: Covers v5 auth flow (token + transaction), response parsing, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CpsGolfAdapter } from "./cps-golf";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/cps-golf-tee-times.json";

const mockConfig: CourseConfig = {
  id: "sd-rancho-bernardo-inn",
  name: "Rancho Bernardo Inn",
  platform: "cps_golf",
  platformConfig: {
    subdomain: "jcgsc5",
    websiteId: "94ce5060-0b39-444f-2756-08d8d81fed21",
    siteId: "16",
    terminalId: "3",
    courseIds: "2",
    timezone: "America/Los_Angeles",
  },
  bookingUrl: "https://jcgsc5.cps.golf/onlineresweb",
};

const tokenResponse = new Response(
  JSON.stringify({
    access_token: "test-bearer-token",
    expires_in: 600,
    token_type: "Bearer",
    scope: "onlinereservation references",
  }),
  { status: 200 }
);

const registerResponse = new Response(JSON.stringify(true), { status: 200 });

/** Set up the 3-fetch mock chain: token → register → tee times */
function mockCpsFlow(teeTimesBody: unknown) {
  return vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(tokenResponse.clone())
    .mockResolvedValueOnce(registerResponse.clone())
    .mockResolvedValueOnce(
      new Response(JSON.stringify(teeTimesBody), { status: 200 })
    );
}

describe("CpsGolfAdapter", () => {
  const adapter = new CpsGolfAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("cps_golf");
  });

  it("parses tee times from v5 API response", async () => {
    mockCpsFlow(fixture);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "sd-rancho-bernardo-inn",
      time: "2026-03-12T07:21:00",
      price: 95,
      holes: 18,
      openSlots: 1,
      bookingUrl: "https://jcgsc5.cps.golf/onlineresweb",
    });
  });

  it("extracts green fee from shItemPrices, ignoring cart fees", async () => {
    mockCpsFlow(fixture);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    // First tee time: GreenFee18=$95 (FullCart18=$15 ignored)
    expect(results[0].price).toBe(95);
    // Third tee time: GreenFee18=$40 (no cart fee present)
    expect(results[2].price).toBe(40);
  });

  it("uses maxPlayer as open slots", async () => {
    mockCpsFlow(fixture);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    expect(results[0].openSlots).toBe(1); // maxPlayer: 1
    expect(results[2].openSlots).toBe(4); // maxPlayer: 4
  });

  it("maps 9-hole tee times correctly", async () => {
    mockCpsFlow({
      ...fixture,
      content: [{ ...fixture.content[0], holes: 9 }],
    });

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results[0].holes).toBe(9);
  });

  it("gets bearer token then registers transaction before querying", async () => {
    const fetchSpy = mockCpsFlow(fixture);

    await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Call 1: token
    const [tokenUrl, tokenOpts] = fetchSpy.mock.calls[0];
    expect(tokenUrl).toBe(
      "https://jcgsc5.cps.golf/identityapi/myconnect/token/short"
    );
    expect(tokenOpts?.method).toBe("POST");

    // Call 2: register transaction
    const [registerUrl, registerOpts] = fetchSpy.mock.calls[1];
    expect(registerUrl).toContain("RegisterTransactionId");
    const registerHeaders = registerOpts?.headers as Record<string, string>;
    expect(registerHeaders["Authorization"]).toBe("Bearer test-bearer-token");

    // Call 3: tee times
    const [ttUrl, ttOpts] = fetchSpy.mock.calls[2];
    expect(ttUrl).toContain("TeeTimes");
    expect(ttUrl).toContain("transactionId=");
    const ttHeaders = ttOpts?.headers as Record<string, string>;
    expect(ttHeaders["Authorization"]).toBe("Bearer test-bearer-token");
  });

  it("does not send x-apikey header", async () => {
    const fetchSpy = mockCpsFlow(fixture);

    await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    // Check tee times call headers (call 3)
    const headers = fetchSpy.mock.calls[2][1]?.headers as Record<string, string>;
    expect(headers["x-apikey"]).toBeUndefined();
  });

  it("sends timezone headers from config", async () => {
    const fetchSpy = mockCpsFlow(fixture);

    await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    const headers = fetchSpy.mock.calls[2][1]?.headers as Record<string, string>;
    expect(headers["x-timezoneid"]).toBe("America/Los_Angeles");
    expect(headers["x-timezone-offset"]).toBeDefined();
  });

  it("defaults timezone to America/Chicago when not specified", async () => {
    const configNoTz: CourseConfig = {
      ...mockConfig,
      platformConfig: { ...mockConfig.platformConfig },
    };
    delete (configNoTz.platformConfig as Record<string, string | undefined>).timezone;
    const fetchSpy = mockCpsFlow(fixture);

    await adapter.fetchTeeTimes(configNoTz, "2026-03-12");

    const headers = fetchSpy.mock.calls[2][1]?.headers as Record<string, string>;
    expect(headers["x-timezoneid"]).toBe("America/Chicago");
  });

  it("returns empty array for NO_TEETIMES response", async () => {
    const noTeetimes = {
      transactionId: "test-txn",
      isSuccess: true,
      content: {
        messageKey: "NO_TEETIMES",
        messageTemplate: "No tee times available",
      },
    };
    mockCpsFlow(noTeetimes);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toEqual([]);
  });

  it("returns empty array for empty content array", async () => {
    mockCpsFlow({ transactionId: "test-txn", isSuccess: true, content: [] });

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toEqual([]);
  });

  it("filters out tee times with maxPlayer <= 0", async () => {
    const withFullyBooked = {
      ...fixture,
      content: [
        { ...fixture.content[0], maxPlayer: 0 },
        fixture.content[1],
      ],
    };
    mockCpsFlow(withFullyBooked);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toHaveLength(1);
  });

  it("returns null price when shItemPrices has no green fee", async () => {
    const noGreenFee = {
      ...fixture,
      content: [
        {
          ...fixture.content[0],
          shItemPrices: [
            { shItemCode: "FullCart18", price: 15.0, itemDesc: "Cart" },
          ],
        },
      ],
    };
    mockCpsFlow(noGreenFee);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results[0].price).toBeNull();
  });

  it("returns null price when shItemPrices is absent", async () => {
    const missingPrices = {
      ...fixture,
      content: [{ ...fixture.content[0], shItemPrices: undefined }],
    };
    mockCpsFlow(missingPrices);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results[0].price).toBeNull();
  });

  it("returns null price when shItemPrices is empty", async () => {
    const emptyPrices = {
      ...fixture,
      content: [{ ...fixture.content[0], shItemPrices: [] }],
    };
    mockCpsFlow(emptyPrices);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results[0].price).toBeNull();
  });

  it("throws on token fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-12")
    ).rejects.toThrow("token request failed");
  });

  it("throws on transaction registration failure", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenResponse.clone())
      .mockResolvedValueOnce(new Response("Error", { status: 500 }));

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-12")
    ).rejects.toThrow("transaction registration failed");
  });

  it("throws when RegisterTransactionId returns false", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenResponse.clone())
      .mockResolvedValueOnce(
        new Response(JSON.stringify(false), { status: 200 })
      );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-12")
    ).rejects.toThrow("transaction registration failed");
  });

  it("throws on tee times HTTP error", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenResponse.clone())
      .mockResolvedValueOnce(registerResponse.clone())
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }));

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-12")
    ).rejects.toThrow("HTTP 500");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-12")
    ).rejects.toThrow("timeout");
  });

  it("throws when subdomain is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { courseIds: "2" },
    };

    await expect(
      adapter.fetchTeeTimes(bad, "2026-03-12")
    ).rejects.toThrow("Missing subdomain");
  });

  it("includes correct searchDate format and courseIds in URL", async () => {
    const fetchSpy = mockCpsFlow(fixture);

    await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

    const ttUrl = fetchSpy.mock.calls[2][0] as string;
    expect(ttUrl).toContain("courseIds=2");
    // "Thu Mar 12 2026" URL-encoded
    expect(ttUrl).toMatch(/searchDate=\w{3}\+\w{3}\+\d{2}\+\d{4}/);
    expect(ttUrl).not.toContain("%2C"); // no commas
  });
});
