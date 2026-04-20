// ABOUTME: Tests for the CPS Golf adapter.
// ABOUTME: Covers v5 auth flow (token + transaction), response parsing, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxyFetch } from "@/lib/proxy-fetch";

vi.mock("@/lib/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));

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
    vi.mocked(proxyFetch).mockReset();
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

  it("maps holes from shItemCode (GreenFee9 → holes=9)", async () => {
    mockCpsFlow({
      ...fixture,
      content: [
        {
          ...fixture.content[0],
          shItemPrices: [
            { shItemCode: "GreenFee9", price: 30.0, itemDesc: "9 Hole Greens Fee" },
          ],
        },
      ],
    });

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toHaveLength(1);
    expect(results[0].holes).toBe(9);
    expect(results[0].price).toBe(30);
  });

  it("expands multi-hole slot with both GreenFee9 and GreenFee18 into two records", async () => {
    // Matches Francis A. Gross real-world shape: one record with both hole prices.
    mockCpsFlow({
      ...fixture,
      content: [
        {
          ...fixture.content[0],
          holes: 9, // CPS sets record-level holes to the minimum bookable for multi-hole
          shItemPrices: [
            { shItemCode: "GreenFee18", price: 43.71, itemDesc: "18 Hole Greens Fee" },
            { shItemCode: "GreenFee9", price: 25.0, itemDesc: "9 Hole Greens Fee" },
          ],
        },
      ],
    });

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.holes).sort((a, b) => a - b)).toEqual([9, 18]);
    const v9 = results.find((r) => r.holes === 9)!;
    const v18 = results.find((r) => r.holes === 18)!;
    expect(v9.price).toBe(25);
    expect(v18.price).toBe(43.71);
    expect(v9.time).toBe(v18.time);
    expect(v9.openSlots).toBe(v18.openSlots);
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

  it("skips records with no GreenFee SKU (cart-only prices)", async () => {
    // Per D-3: records without GreenFee9 or GreenFee18 are skipped — we can't
    // assign a meaningful hole count to price=null data, so the slot doesn't
    // surface. Current behavior (pre-fix) emitted a record with price=null.
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
    expect(results).toHaveLength(0);
  });

  it("skips records with absent shItemPrices (per D-3)", async () => {
    const missingPrices = {
      ...fixture,
      content: [{ ...fixture.content[0], shItemPrices: undefined }],
    };
    mockCpsFlow(missingPrices);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toHaveLength(0);
  });

  it("skips records with empty shItemPrices (per D-3)", async () => {
    const emptyPrices = {
      ...fixture,
      content: [{ ...fixture.content[0], shItemPrices: [] }],
    };
    mockCpsFlow(emptyPrices);

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");
    expect(results).toHaveLength(0);
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

  describe("v4 auth mode", () => {
    const v4Config: CourseConfig = {
      id: "edinburgh-usa",
      name: "Edinburgh USA",
      platform: "cps_golf",
      platformConfig: {
        subdomain: "edinburghusa",
        websiteId: "7b2c1b2a-acee-4ba4-e72a-08dc2c96d123",
        courseIds: "1,2",
        authType: "v4",
      },
      bookingUrl: "https://edinburghusa.cps.golf/onlineresweb",
    };

    const v4Env = {
      DB: {} as any,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      JWT_SECRET: "",
      CPS_V4_API_KEY: "test-v4-api-key",
    } satisfies CloudflareEnv;

    it("skips token but registers transaction for v4 courses", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(true), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(fixture), { status: 200 })
        );

      const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4Env);

      // 2 fetch calls (register + TeeTimes), not 3 (no token)
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Call 1: register transaction
      const [registerUrl, registerInit] = fetchSpy.mock.calls[0];
      expect(registerUrl).toContain("/RegisterTransactionId");
      expect((registerInit as RequestInit).headers).toHaveProperty("x-apikey", "test-v4-api-key");

      // Call 2: tee times with transactionId
      const [ttUrl, ttInit] = fetchSpy.mock.calls[1];
      expect(ttUrl).toContain("/TeeTimes?");
      expect(ttUrl).toContain("transactionId=");
      expect((ttInit as RequestInit).headers).toHaveProperty("x-apikey", "test-v4-api-key");
      expect((ttInit as RequestInit).headers).toHaveProperty("client-id", "js1");
      expect(results).toHaveLength(3);
    });

    it("skips transactionId when RegisterTransactionId returns 404", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 })) // register → 404
        .mockResolvedValueOnce(
          new Response(JSON.stringify(fixture), { status: 200 })
        );

      const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4Env);

      // 2 fetch calls (register attempt + TeeTimes), no token
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Call 2: TeeTimes WITHOUT transactionId in URL
      const [ttUrl] = fetchSpy.mock.calls[1];
      expect(ttUrl).toContain("/TeeTimes?");
      expect(ttUrl).not.toContain("transactionId=");
      expect(results).toHaveLength(3);
    });

    it("routes v4 request through proxy when proxy config is set", async () => {
      const v4ProxyEnv = {
        ...v4Env,
        FETCH_PROXY_URL: "https://proxy.lambda-url.us-west-2.on.aws/",
        AWS_ACCESS_KEY_ID: "AKID",
        AWS_SECRET_ACCESS_KEY: "SECRET",
      } satisfies CloudflareEnv;

      vi.spyOn(globalThis, "fetch");
      vi.mocked(proxyFetch)
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(true),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(fixture),
        });

      const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4ProxyEnv);

      // v4 + proxy: 2 proxyFetch calls (register + TeeTimes), no token
      expect(proxyFetch).toHaveBeenCalledTimes(2);
      expect(fetch).not.toHaveBeenCalled();

      const registerCall = vi.mocked(proxyFetch).mock.calls[0][0];
      expect(registerCall.url).toContain("/RegisterTransactionId");

      const ttCall = vi.mocked(proxyFetch).mock.calls[1][0];
      expect(ttCall.url).toContain("/TeeTimes?");
      expect(ttCall.url).toContain("transactionId=");
      expect(ttCall.headers).toHaveProperty("x-apikey", "test-v4-api-key");
      expect(ttCall.headers).toHaveProperty("client-id", "js1");
      expect(results).toHaveLength(3);
    });

    it("skips transactionId via proxy when RegisterTransactionId returns 404", async () => {
      const v4ProxyEnv = {
        ...v4Env,
        FETCH_PROXY_URL: "https://proxy.lambda-url.us-west-2.on.aws/",
        AWS_ACCESS_KEY_ID: "AKID",
        AWS_SECRET_ACCESS_KEY: "SECRET",
      } satisfies CloudflareEnv;

      vi.spyOn(globalThis, "fetch");
      vi.mocked(proxyFetch)
        .mockResolvedValueOnce({
          status: 404,
          headers: {},
          body: "Not Found",
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(fixture),
        });

      const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4ProxyEnv);

      expect(proxyFetch).toHaveBeenCalledTimes(2);
      expect(fetch).not.toHaveBeenCalled();

      const ttCall = vi.mocked(proxyFetch).mock.calls[1][0];
      expect(ttCall.url).toContain("/TeeTimes?");
      expect(ttCall.url).not.toContain("transactionId=");
      expect(results).toHaveLength(3);
    });

    it("throws when CPS_V4_API_KEY secret is missing", async () => {
      const noKeyEnv = { ...v4Env, CPS_V4_API_KEY: undefined } as unknown as CloudflareEnv;

      await expect(
        adapter.fetchTeeTimes(v4Config, "2026-03-12", noKeyEnv)
      ).rejects.toThrow("Missing CPS_V4_API_KEY");
    });
  });

  describe("proxy mode", () => {
    const proxyEnv = {
      DB: {} as any,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      JWT_SECRET: "",
      FETCH_PROXY_URL: "https://proxy.lambda-url.us-west-2.on.aws/",
      AWS_ACCESS_KEY_ID: "AKID",
      AWS_SECRET_ACCESS_KEY: "SECRET",
    } satisfies CloudflareEnv;

    beforeEach(() => {
      // Must spy on fetch to assert it wasn't called in proxy mode
      vi.spyOn(globalThis, "fetch");

      // Mock the 3-call proxy chain: token → register → tee times
      // These MUST match the adapter's call order exactly
      vi.mocked(proxyFetch)
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({ access_token: "proxy-token", expires_in: 600 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(true),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(fixture),
        });
    });

    it("routes all three CPS requests through proxyFetch", async () => {
      const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12", proxyEnv);

      expect(proxyFetch).toHaveBeenCalledTimes(3);
      expect(fetch).not.toHaveBeenCalled();
      expect(results).toHaveLength(3);
    });

    it("falls back to direct fetch when proxy env is not set", async () => {
      mockCpsFlow(fixture);
      const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

      expect(proxyFetch).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
    });

    it("warns and falls back to direct fetch on partial proxy config", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockCpsFlow(fixture);

      const partialEnv = {
        ...proxyEnv,
        AWS_SECRET_ACCESS_KEY: undefined,
      } as unknown as CloudflareEnv;

      const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12", partialEnv);

      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(consoleSpy.mock.calls[0][0]).toContain("Partial proxy config");
      expect(consoleSpy.mock.calls[0][0]).toContain("AWS_SECRET_ACCESS_KEY");
      expect(proxyFetch).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);

      consoleSpy.mockRestore();
    });
  });
});
