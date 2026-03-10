# TeeItUp Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a TeeItUp/Kenna platform adapter so the poller can fetch tee times from TeeItUp-powered courses.

**Architecture:** Follows the existing adapter pattern (CPS Golf, ForeUp): a class implementing `PlatformAdapter` with `platformId` and `fetchTeeTimes()`. Registered in `src/adapters/index.ts`. Uses a JSON fixture for unit tests.

**Tech Stack:** TypeScript, Vitest, existing `PlatformAdapter` interface from `src/types/index.ts`

**Design doc:** `docs/plans/2026-03-10-teeitup-adapter-design.md`

---

### Task 1: Create test fixture

The fixture is a trimmed version of a real API response from Lomas Santa Fe (2026-03-11). It covers the key variations we need to test: full-price times, promo-price times, partially booked (1 slot), and fully open (4 slots).

**Files:**
- Create: `src/test/fixtures/teeitup-tee-times.json`

**Step 1: Create the fixture file**

```json
[
  {
    "dayInfo": {
      "dawn": "2026-03-11T13:41:00.000Z",
      "sunrise": "2026-03-11T14:05:00.000Z",
      "sunset": "2026-03-12T01:52:00.000Z",
      "dusk": "2026-03-12T02:19:00.000Z"
    },
    "teetimes": [
      {
        "courseId": "54f14bc00c8ad60378b015c9",
        "teetime": "2026-03-11T17:50:00.000Z",
        "backNine": false,
        "rates": [
          {
            "_id": -512489923,
            "name": "Walking",
            "externalId": "-512489923",
            "allowedPlayers": [1],
            "holes": 18,
            "icons": [],
            "tags": [],
            "golfnow": {
              "TTTeeTimeId": -512489923,
              "GolfCourseId": 169060,
              "GolfFacilityId": 1241
            },
            "trade": false,
            "acceptCreditCard": false,
            "showAsHotDeal": false,
            "isSimulator": false,
            "dueOnlineWalking": 0,
            "greenFeeWalking": 3500,
            "transactionFees": 0,
            "showTransactionFees": false
          }
        ],
        "bookedPlayers": 3,
        "minPlayers": 1,
        "maxPlayers": 1,
        "players": [],
        "source": "API-2.1",
        "fromCache": false,
        "rollTimeOffer": null
      },
      {
        "courseId": "54f14bc00c8ad60378b015c9",
        "teetime": "2026-03-11T23:40:00.000Z",
        "backNine": false,
        "rates": [
          {
            "_id": -512489894,
            "name": "Walking",
            "externalId": "-512489894",
            "allowedPlayers": [1, 2, 3, 4],
            "holes": 18,
            "icons": [],
            "tags": [],
            "golfnow": {
              "TTTeeTimeId": -512489894,
              "GolfCourseId": 169060,
              "GolfFacilityId": 1241
            },
            "trade": false,
            "acceptCreditCard": false,
            "showAsHotDeal": false,
            "isSimulator": false,
            "dueOnlineWalking": 3000,
            "greenFeeWalking": 3200,
            "transactionFees": 0,
            "showTransactionFees": false,
            "promotion": {
              "discount": 0.06,
              "greenFeeWalking": 3000
            }
          }
        ],
        "bookedPlayers": 0,
        "minPlayers": 1,
        "maxPlayers": 4,
        "players": [],
        "source": "API-2.1",
        "fromCache": false,
        "rollTimeOffer": null
      },
      {
        "courseId": "54f14bc00c8ad60378b015c9",
        "teetime": "2026-03-12T00:00:00.000Z",
        "backNine": false,
        "rates": [
          {
            "_id": -512489892,
            "name": "Walking",
            "externalId": "-512489892",
            "allowedPlayers": [1, 2, 3, 4],
            "holes": 18,
            "icons": [],
            "tags": [],
            "golfnow": {
              "TTTeeTimeId": -512489892,
              "GolfCourseId": 169060,
              "GolfFacilityId": 1241
            },
            "trade": false,
            "acceptCreditCard": false,
            "showAsHotDeal": false,
            "isSimulator": false,
            "dueOnlineWalking": 2400,
            "greenFeeWalking": 2800,
            "transactionFees": 0,
            "showTransactionFees": false,
            "promotion": {
              "discount": 0.14,
              "greenFeeWalking": 2400
            }
          }
        ],
        "bookedPlayers": 0,
        "minPlayers": 1,
        "maxPlayers": 4,
        "players": [],
        "source": "API-2.1",
        "fromCache": false,
        "rollTimeOffer": null
      }
    ],
    "courseId": "54f14bc00c8ad60378b015c9",
    "totalAvailableTeetimes": 3,
    "fromCache": false
  }
]
```

Fixture has 3 tee times covering:
- `17:50Z` — full price ($35), 1 open slot (partially booked)
- `23:40Z` — promo price ($30, base $32), 4 open slots
- `00:00Z` — promo price ($24, base $28), 4 open slots

**Step 2: Commit**

```bash
git add src/test/fixtures/teeitup-tee-times.json
git commit -m "test: add TeeItUp API response fixture"
```

---

### Task 2: Write failing tests for TeeItUp adapter

Follow the same test structure as `src/adapters/foreup.test.ts`. All tests should fail because the adapter doesn't exist yet.

**Files:**
- Create: `src/adapters/teeitup.test.ts`

**Step 1: Write the test file**

```typescript
// ABOUTME: Tests for the TeeItUp adapter.
// ABOUTME: Covers API URL construction, response parsing, rate selection, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeeItUpAdapter } from "./teeitup";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/teeitup-tee-times.json";

const mockConfig: CourseConfig = {
  id: "keller",
  name: "Keller Golf Course",
  platform: "teeitup",
  platformConfig: {
    alias: "ramsey-county-golf",
    apiBase: "https://phx-api-be-east-1b.kenna.io",
    facilityId: "17055",
  },
  bookingUrl: "https://ramsey-county-golf.book.teeitup.com",
};

describe("TeeItUpAdapter", () => {
  const adapter = new TeeItUpAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("teeitup");
  });

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "keller",
      time: "2026-03-11T17:50:00.000Z",
      price: 35,
      holes: 18,
      openSlots: 1,
      bookingUrl: "https://ramsey-county-golf.book.teeitup.com",
    });
  });

  it("uses promo price when promotion exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    // Second tee time has promotion: greenFeeWalking 3000 cents = $30
    expect(results[1].price).toBe(30);
    // Third tee time has promotion: greenFeeWalking 2400 cents = $24
    expect(results[2].price).toBe(24);
  });

  it("derives open slots from maxPlayers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");

    // First: bookedPlayers=3, maxPlayers=1 → 1 open slot
    expect(results[0].openSlots).toBe(1);
    // Second: bookedPlayers=0, maxPlayers=4 → 4 open slots
    expect(results[1].openSlots).toBe(4);
  });

  it("builds the correct API URL and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ teetimes: [] }]), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=2026-04-15&facilityIds=17055"
    );
    const headers = options?.headers as Record<string, string>;
    expect(headers["x-be-alias"]).toBe("ramsey-county-golf");
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-11")
    ).rejects.toThrow("HTTP 500");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-03-11")
    ).rejects.toThrow("timeout");
  });

  it("throws when alias is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { apiBase: "https://x.kenna.io", facilityId: "1" },
    };

    await expect(adapter.fetchTeeTimes(bad, "2026-03-11")).rejects.toThrow(
      "Missing alias"
    );
  });

  it("throws when apiBase is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { alias: "test", facilityId: "1" },
    };

    await expect(adapter.fetchTeeTimes(bad, "2026-03-11")).rejects.toThrow(
      "Missing apiBase"
    );
  });

  it("throws when facilityId is missing", async () => {
    const bad: CourseConfig = {
      ...mockConfig,
      platformConfig: { alias: "test", apiBase: "https://x.kenna.io" },
    };

    await expect(adapter.fetchTeeTimes(bad, "2026-03-11")).rejects.toThrow(
      "Missing facilityId"
    );
  });

  it("handles empty teetimes array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ teetimes: [] }]), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(result).toEqual([]);
  });

  it("handles empty response array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(result).toEqual([]);
  });

  it("skips tee times with empty rates", async () => {
    const noRates = [
      {
        teetimes: [
          { ...fixture[0].teetimes[0], rates: [] },
          fixture[0].teetimes[1],
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(noRates), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(1);
  });

  it("skips tee times with zero maxPlayers", async () => {
    const fullyBooked = [
      {
        teetimes: [
          { ...fixture[0].teetimes[0], maxPlayers: 0 },
          fixture[0].teetimes[1],
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fullyBooked), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results).toHaveLength(1);
  });

  it("skips trade rates and uses first non-trade rate", async () => {
    const withTrade = [
      {
        teetimes: [
          {
            ...fixture[0].teetimes[0],
            rates: [
              { ...fixture[0].teetimes[0].rates[0], trade: true, greenFeeWalking: 9999 },
              { ...fixture[0].teetimes[0].rates[0], trade: false, greenFeeWalking: 3500 },
            ],
          },
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(withTrade), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-11");
    expect(results[0].price).toBe(35);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/teeitup.test.ts`
Expected: FAIL — `Cannot find module './teeitup'`

**Step 3: Commit the failing tests**

This is standard TDD practice — committing tests that fail because the implementation doesn't exist yet. The tests will pass after Task 3.

```bash
git add src/adapters/teeitup.test.ts
git commit -m "test: add failing TeeItUp adapter tests"
```

---

### Task 3: Implement TeeItUp adapter

Write the minimal adapter to make all tests pass.

**Files:**
- Create: `src/adapters/teeitup.ts`

**Step 1: Write the adapter**

```typescript
// ABOUTME: TeeItUp/Kenna platform adapter for fetching tee times.
// ABOUTME: Handles API requests, rate selection, and cents-to-dollars price conversion.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface TeeItUpRate {
  holes: number;
  trade?: boolean;
  greenFeeWalking: number;
  promotion?: {
    greenFeeWalking: number;
  };
}

interface TeeItUpTeeTime {
  teetime: string;
  maxPlayers: number;
  rates: TeeItUpRate[];
}

interface TeeItUpCourseEntry {
  teetimes: TeeItUpTeeTime[];
}

export class TeeItUpAdapter implements PlatformAdapter {
  readonly platformId = "teeitup";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
    const { alias, apiBase, facilityId } = config.platformConfig;

    if (!alias) throw new Error("Missing alias in platformConfig");
    if (!apiBase) throw new Error("Missing apiBase in platformConfig");
    if (!facilityId) throw new Error("Missing facilityId in platformConfig");

    const url = `${apiBase}/v2/tee-times?date=${date}&facilityIds=${facilityId}`;

    const response = await fetch(url, {
      headers: { "x-be-alias": alias },
    });

    if (!response.ok) {
      throw new Error(`TeeItUp API returned HTTP ${response.status}`);
    }

    const data: TeeItUpCourseEntry[] = await response.json();

    return data.flatMap((entry) =>
      (entry.teetimes ?? [])
        .filter((tt) => tt.maxPlayers > 0 && tt.rates.length > 0)
        .map((tt) => {
          const rate = tt.rates.find((r) => !r.trade) ?? tt.rates[0];
          const priceInCents = rate.promotion?.greenFeeWalking ?? rate.greenFeeWalking;

          return {
            courseId: config.id,
            time: tt.teetime,
            price: priceInCents / 100,
            holes: rate.holes === 9 ? 9 : 18,
            openSlots: tt.maxPlayers,
            bookingUrl: config.bookingUrl,
          };
        })
    );
  }
}
```

Note: No `as 9 | 18` cast needed — TypeScript infers literal types from the ternary, consistent with CPS Golf and ForeUp adapters.

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/adapters/teeitup.test.ts`
Expected: All 13 tests PASS

**Step 3: Commit**

```bash
git add src/adapters/teeitup.ts
git commit -m "feat: add TeeItUp platform adapter"
```

---

### Task 4: Register adapter and update registry tests

Add the TeeItUp adapter to the adapter registry so the poller can find it.

**Files:**
- Modify: `src/adapters/index.ts`
- Modify: `src/adapters/index.test.ts`

**Step 1: Update the registry**

In `src/adapters/index.ts`, make two edits:

**Edit 1 — add import.** Find:
```typescript
import { ForeUpAdapter } from "./foreup";
```
Replace with:
```typescript
import { ForeUpAdapter } from "./foreup";
import { TeeItUpAdapter } from "./teeitup";
```

**Edit 2 — add to array.** Find:
```typescript
  new ForeUpAdapter(),
];
```
Replace with:
```typescript
  new ForeUpAdapter(),
  new TeeItUpAdapter(),
];
```

**Step 2: Add registry test**

In `src/adapters/index.test.ts`, find:
```typescript
  it("returns undefined for unknown platform", () => {
```
Insert this test **before** that line:
```typescript
  it("returns TeeItUp adapter for 'teeitup'", () => {
    const adapter = getAdapter("teeitup");
    expect(adapter).toBeDefined();
    expect(adapter!.platformId).toBe("teeitup");
  });

```

**Step 3: Run all adapter tests**

Run: `npx vitest run src/adapters/`
Expected: All tests pass (CPS Golf, ForeUp, TeeItUp, and registry)

**Step 4: Run full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no type errors

**Step 5: Commit**

```bash
git add src/adapters/index.ts src/adapters/index.test.ts
git commit -m "feat: register TeeItUp adapter in platform registry"
```

---

### Task 5: Add SD test course to courses.json

Add Lomas Santa Fe to `src/config/courses.json` with `is_active: 0` (not polled in production) so we can test the full pipeline locally.

**Files:**
- Modify: `src/config/courses.json`

**Step 1: Add the entry**

In `src/config/courses.json`, use the Edit tool. Find (the last entry's closing):
```json
    "bookingUrl": "https://foreupsoftware.com/index.php/booking/19162/1202"
  }
]
```
Replace with:
```json
    "bookingUrl": "https://foreupsoftware.com/index.php/booking/19162/1202"
  },
  {
    "index": 19,
    "id": "sd-lomas-santa-fe",
    "name": "Lomas Santa Fe Executive Golf Course (SD Test)",
    "city": "Solana Beach",
    "platform": "teeitup",
    "platformConfig": {
      "alias": "lomas-santa-fe-executive-golf-course",
      "apiBase": "https://phx-api-be-east-1b.kenna.io",
      "facilityId": "1241"
    },
    "bookingUrl": "https://lomas-santa-fe-executive-golf-course.book.teeitup.com",
    "is_active": 0
  }
]
```

**IMPORTANT field naming:** Use `platformConfig` and `bookingUrl` (camelCase) to match all existing entries. Do NOT use `platform_config` or `booking_url`. There is no `state` field — don't add one. Follow the name pattern of other SD test courses (e.g., `"Goat Hill Park (SD Test)"`).

**Do NOT** run `npm run seed:local` — seeding is not needed for this task.

**Step 2: Run the full test suite** to verify nothing breaks

Run: `npm test && npx tsc --noEmit`
Expected: All pass

**Step 3: Commit**

```bash
git add src/config/courses.json
git commit -m "feat: add Lomas Santa Fe SD test course (TeeItUp, inactive)"
```

---

### Task 6: Run full verification

**Step 1: Run the full CI-equivalent checks**

```bash
npx tsc --noEmit && npm test && npx @opennextjs/cloudflare build
```

Expected: Type-check passes, all tests pass, build succeeds.

If the build fails for reasons **unrelated** to the adapter changes (e.g., OpenNext or Cloudflare tooling issues), flag it to Sam rather than debugging — don't let unrelated build issues block this task.

**Step 2: Verify with git status**

Run: `git status`
Expected: Clean working tree, all changes committed.
