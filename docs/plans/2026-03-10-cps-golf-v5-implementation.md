# CPS Golf v5 Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the CPS Golf adapter from deprecated v4 API (static x-apikey) to v5 (OAuth2 Bearer token + transaction ID).

**Architecture:** Inline 3-step auth per `fetchTeeTimes` call: get token → register transaction → query tee times. Private methods for each step. Timezone derived dynamically from config.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers (crypto.randomUUID)

**Design doc:** `docs/plans/2026-03-10-cps-golf-v5-adapter-design.md`

---

### Task 1: Replace v4 fixture with v5 response data

**Files:**
- Modify: `src/test/fixtures/cps-golf-tee-times.json`

**Context:** The v4 fixture has a flat `{TeeTimes: [...]}` structure. The v5 response wraps tee times in `{transactionId, isSuccess, content: [...]}` with a richer per-tee-time shape. This fixture is based on real HAR-captured data from Rancho Bernardo Inn (jcgsc5.cps.golf).

**Step 1: Replace the fixture**

Replace the entire contents of `src/test/fixtures/cps-golf-tee-times.json` with:

```json
{
  "transactionId": "f592d5d9-a82c-bd59-435b-27ab5a20e64b",
  "isSuccess": true,
  "content": [
    {
      "teeSheetId": 5932777,
      "startTime": "2026-03-12T07:21:00",
      "startingTee": 1,
      "is18HoleOnly": true,
      "participants": 4,
      "courseId": 2,
      "courseDate": "2026-03-12T00:00:00",
      "holes": 18,
      "siteId": 2,
      "courseName": "Rancho Bernardo Inn",
      "shItemPrices": [
        {
          "shItemCode": "GreenFee18",
          "itemCode": "RB118001001",
          "price": 95.0,
          "itemDesc": "SC Resident M-Th"
        },
        {
          "shItemCode": "FullCart18",
          "itemCode": "RB1100001002",
          "price": 15.0,
          "itemDesc": "Cart Rental $15"
        }
      ],
      "minPlayer": 1,
      "maxPlayer": 1
    },
    {
      "teeSheetId": 5932829,
      "startTime": "2026-03-12T15:09:00",
      "startingTee": 1,
      "is18HoleOnly": true,
      "participants": 4,
      "courseId": 2,
      "courseDate": "2026-03-12T00:00:00",
      "holes": 18,
      "siteId": 2,
      "courseName": "Rancho Bernardo Inn",
      "shItemPrices": [
        {
          "shItemCode": "GreenFee18",
          "itemCode": "RB103001003",
          "price": 55.0,
          "itemDesc": "Twilight M-Th"
        },
        {
          "shItemCode": "FullCart18",
          "itemCode": "RB1100001002",
          "price": 15.0,
          "itemDesc": "Cart Rental $15"
        }
      ],
      "minPlayer": 1,
      "maxPlayer": 1
    },
    {
      "teeSheetId": 6698755,
      "startTime": "2026-03-12T18:00:00",
      "startingTee": 1,
      "is18HoleOnly": true,
      "participants": 4,
      "courseId": 2,
      "courseDate": "2026-03-12T00:00:00",
      "holes": 18,
      "siteId": 2,
      "courseName": "Rancho Bernardo Inn",
      "shItemPrices": [
        {
          "shItemCode": "GreenFee18",
          "itemCode": "RB106001001",
          "price": 40.0,
          "itemDesc": "Super Twilight M-Th"
        }
      ],
      "minPlayer": 2,
      "maxPlayer": 4
    }
  ]
}
```

Key characteristics of the 3 tee times:
- 7:21 AM: $95, maxPlayer 1, has cart fee (GreenFee18 + FullCart18)
- 3:09 PM: $55, maxPlayer 1, has cart fee (twilight rate)
- 6:00 PM: $40, maxPlayer 4, no cart fee (super twilight, only GreenFee18)

**Step 2: Commit**

```bash
git add src/test/fixtures/cps-golf-tee-times.json
git commit -m "test: replace CPS Golf fixture with v5 API response format"
```

---

### Task 2: Write failing tests for the v5 adapter

**Files:**
- Modify: `src/adapters/cps-golf.test.ts`

**Context:** The existing tests mock a single `fetch` call with v4 response format and check for `x-apikey` header. The v5 adapter makes 3 sequential fetches (token, register, tee times) and uses Bearer auth. All existing tests need rewriting.

**Step 1: Rewrite the test file**

Replace the entire contents of `src/adapters/cps-golf.test.ts`. Key changes from v4 tests:
- `mockConfig` removes `apiKey`, adds `siteId` and `terminalId`
- Test helper `mockCpsFlow()` sets up 3 sequential fetch mocks (token → register → tee times)
- Tests verify Bearer auth instead of x-apikey
- Response parsing tests use v5 field names
- New tests for token failure, register failure, NO_TEETIMES response

```typescript
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
```

**Step 2: Run the tests to verify they fail**

Run: `npm test -- src/adapters/cps-golf.test.ts`

Expected: All tests fail (adapter still has v4 implementation).

**Step 3: Commit the failing tests**

```bash
git add src/adapters/cps-golf.test.ts
git commit -m "test: rewrite CPS Golf tests for v5 API (all failing)"
```

---

### Task 3: Implement the v5 adapter

**Files:**
- Modify: `src/adapters/cps-golf.ts`

**Context:** Replace the single-fetch v4 implementation with the 3-step v5 auth flow. Private methods for token, transaction, and header construction. The `formatCpsDate` method stays but uses dynamic timezone.

**Step 1: Rewrite the adapter**

Replace the entire contents of `src/adapters/cps-golf.ts` with:

```typescript
// ABOUTME: CPS Golf (Club Prophet) platform adapter for fetching tee times.
// ABOUTME: Handles v5 OAuth2 auth flow, transaction registration, and response parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface CpsV5TeeTime {
  startTime: string;
  holes: number;
  maxPlayer: number;
  shItemPrices: Array<{
    shItemCode: string;
    price: number;
  }>;
}

interface CpsV5Response {
  transactionId: string;
  isSuccess: boolean;
  content: CpsV5TeeTime[] | { messageKey: string };
}

export class CpsGolfAdapter implements PlatformAdapter {
  readonly platformId = "cps_golf";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
    const { subdomain } = config.platformConfig;

    if (!subdomain) {
      throw new Error("Missing subdomain in platformConfig");
    }

    const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;
    const timezone = config.platformConfig.timezone ?? "America/Chicago";

    const token = await this.getToken(subdomain);
    const transactionId = await this.registerTransaction(
      baseUrl,
      token,
      this.buildHeaders(config, token, timezone)
    );

    const searchDate = this.formatCpsDate(date, timezone);

    const params = new URLSearchParams({
      searchDate,
      courseIds: config.platformConfig.courseIds ?? "",
      transactionId,
      holes: "0",
      numberOfPlayer: "0",
      searchTimeType: "0",
      teeOffTimeMin: "0",
      teeOffTimeMax: "23",
      isChangeTeeOffTime: "true",
      teeSheetSearchView: "5",
      classCode: "R",
      defaultOnlineRate: "N",
      isUseCapacityPricing: "false",
      memberStoreId: "1",
      searchType: "1",
    });

    const response = await fetch(`${baseUrl}/TeeTimes?${params}`, {
      headers: this.buildHeaders(config, token, timezone),
    });

    if (!response.ok) {
      throw new Error(`CPS Golf API returned HTTP ${response.status}`);
    }

    const data: CpsV5Response = await response.json();

    if (!Array.isArray(data.content)) {
      return [];
    }

    return data.content
      .filter((tt) => tt.maxPlayer > 0)
      .map((tt) => ({
        courseId: config.id,
        time: tt.startTime,
        price: this.extractGreenFee(tt.shItemPrices),
        holes: tt.holes === 9 ? 9 : 18,
        openSlots: tt.maxPlayer,
        bookingUrl: config.bookingUrl,
      }));
  }

  private async getToken(subdomain: string): Promise<string> {
    const url = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=onlinereswebshortlived",
    });

    if (!response.ok) {
      throw new Error(
        `CPS Golf token request failed: HTTP ${response.status}`
      );
    }

    const data: { access_token: string } = await response.json();
    return data.access_token;
  }

  private async registerTransaction(
    baseUrl: string,
    token: string,
    headers: Record<string, string>
  ): Promise<string> {
    const transactionId = crypto.randomUUID();

    const response = await fetch(`${baseUrl}/RegisterTransactionId`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transactionId }),
    });

    if (!response.ok) {
      throw new Error("CPS Golf transaction registration failed");
    }

    return transactionId;
  }

  private buildHeaders(
    config: CourseConfig,
    token: string,
    timezone: string
  ): Record<string, string> {
    const { websiteId, siteId, terminalId } = config.platformConfig;

    return {
      Authorization: `Bearer ${token}`,
      "client-id": "onlineresweb",
      ...(websiteId && { "x-websiteid": websiteId }),
      ...(siteId && { "x-siteid": siteId }),
      ...(terminalId && { "x-terminalid": terminalId }),
      "x-componentid": "1",
      "x-moduleid": "7",
      "x-productid": "1",
      "x-ismobile": "false",
      "x-timezone-offset": String(this.getTimezoneOffset(timezone)),
      "x-timezoneid": timezone,
      "x-requestid": crypto.randomUUID(),
    };
  }

  private extractGreenFee(
    prices: Array<{ shItemCode: string; price: number }>
  ): number | null {
    const greenFee = prices.find((p) =>
      p.shItemCode.startsWith("GreenFee")
    );
    return greenFee?.price ?? null;
  }

  private getTimezoneOffset(timezone: string): number {
    const now = new Date();
    const utc = new Date(
      now.toLocaleString("en-US", { timeZone: "UTC" })
    );
    const local = new Date(
      now.toLocaleString("en-US", { timeZone: timezone })
    );
    return (utc.getTime() - local.getTime()) / 60000;
  }

  /** Convert "2026-04-15" → "Wed Apr 15 2026" (CPS Golf's expected format) */
  private formatCpsDate(isoDate: string, timezone: string): string {
    const d = new Date(isoDate + "T12:00:00Z"); // noon UTC to avoid timezone issues
    return d
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: timezone,
      })
      .replace(/,/g, "");
  }
}
```

**Step 2: Run the tests**

Run: `npm test -- src/adapters/cps-golf.test.ts`

Expected: All tests pass. If any fail, fix the adapter code (not the tests — the tests define the correct behavior).

**Step 3: Run the full test suite**

Run: `npm test`

Expected: All 225+ tests pass (other tests should be unaffected).

**Step 4: Commit**

```bash
git add src/adapters/cps-golf.ts
git commit -m "feat: update CPS Golf adapter to v5 auth flow"
```

---

### Task 4: Update courses.json configs

**Files:**
- Modify: `src/config/courses.json`

**Context:** Remove the deprecated `apiKey` field from Theodore Wirth (only course that has it). Add `timezone: "America/Los_Angeles"` to the 3 SD CPS Golf courses. TC courses omit timezone (defaults to "America/Chicago").

**Step 1: Edit Theodore Wirth config**

In `src/config/courses.json`, find the Theodore Wirth entry (index 1, id "theodore-wirth-18") and remove the `"apiKey"` line from its `platformConfig`:

Before:
```json
"platformConfig": {
  "subdomain": "minneapolistheodorewirth",
  "apiKey": "8ea2914e-cac2-48a7-a3e5-e0f41350bf3a",
  "courseIds": "17",
  "websiteId": "8265e495-5c83-44e5-93d8-c9e3f3a40529"
}
```

After:
```json
"platformConfig": {
  "subdomain": "minneapolistheodorewirth",
  "courseIds": "17",
  "websiteId": "8265e495-5c83-44e5-93d8-c9e3f3a40529"
}
```

**Step 2: Add timezone to SD CPS courses**

Find the 3 SD CPS Golf courses (sd-encinitas-ranch, sd-twin-oaks, sd-rancho-bernardo-inn) and add `"timezone": "America/Los_Angeles"` to each `platformConfig`.

Example (Encinitas Ranch) before:
```json
"platformConfig": {
  "subdomain": "jcgsc5",
  "websiteId": "94ce5060-0b39-444f-2756-08d8d81fed21",
  "siteId": "16",
  "terminalId": "3",
  "courseIds": "6"
}
```

After:
```json
"platformConfig": {
  "subdomain": "jcgsc5",
  "websiteId": "94ce5060-0b39-444f-2756-08d8d81fed21",
  "siteId": "16",
  "terminalId": "3",
  "courseIds": "6",
  "timezone": "America/Los_Angeles"
}
```

Apply the same change to sd-twin-oaks (courseIds "4") and sd-rancho-bernardo-inn (courseIds "2").

**Step 3: Run the full test suite**

Run: `npm test`

Expected: All tests pass.

**Step 4: Run type-check**

Run: `npx tsc --noEmit`

Expected: Clean, no errors.

**Step 5: Commit**

```bash
git add src/config/courses.json
git commit -m "chore: remove deprecated apiKey, add timezone to SD CPS courses"
```

---

### Task 5: Final verification

**Step 1: Run full test suite**

Run: `npm test`

Expected: All tests pass (225+ total).

**Step 2: Run type-check**

Run: `npx tsc --noEmit`

Expected: Clean.

**Step 3: Run production build**

Run: `npx @opennextjs/cloudflare build`

Expected: Build succeeds.
