# Teesnap & MemberSports Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Teesnap and MemberSports platform adapters, plus five new catalog courses (Daytona, StoneRidge, River Oaks, Emerald Greens Gold/Silver).

**Architecture:** Two new adapters following the established `PlatformAdapter` pattern. Teesnap uses GET with availability calculated from booking data. MemberSports uses POST with a static API key. Emerald Greens uses the existing ForeUp adapter. All courses added to `courses.json` and registered in the adapter index.

**Tech Stack:** TypeScript, Vitest, existing adapter patterns

**Design doc:** `docs/plans/2026-03-27-teesnap-membersports-design.md`
**Teesnap API research:** `dev/research/teesnap-platform-investigation.md`
**MemberSports API research:** `dev/research/membersports-platform-investigation.md`

---

## Dependency Graph

```
Task 1 (Teesnap fixture + tests + impl) ──┐
                                           ├─→ Task 3 (register adapters + catalog + docs)
Task 2 (MemberSports fixture + tests + impl) ┘     │
                                                    ↓
                                           Task 4 (smoke tests + final verification)
```

Tasks 1 and 2 are **fully independent** and can run in parallel. Task 3 depends on both. Task 4 depends on Task 3.

---

## Task 1: Teesnap Adapter (fixture + tests + implementation)

BEFORE starting work:
1. Invoke the `superpowers:test-driven-development` skill
2. Read `dev/testing-pitfalls.md` — pay special attention to sections 1 (Silent Failure), 3 (Config Validation), and 6 (External API Resilience)
3. Read `dev/research/teesnap-platform-investigation.md` for full API details
4. Read `src/adapters/eagle-club.ts` and `src/adapters/eagle-club.test.ts` as the reference pattern
Follow TDD: write failing test → implement fix → verify green.

**Files:**
- Create: `src/test/fixtures/teesnap-tee-times.json`
- Create: `src/adapters/teesnap.test.ts`
- Create: `src/adapters/teesnap.ts`

### Step 1: Create the test fixture

Create `src/test/fixtures/teesnap-tee-times.json` with this exact content:

```json
{
  "teeTimes": {
    "bookings": [
      {
        "bookingId": 50001,
        "golfers": [1001, 1002],
        "teeOffSection": "FRONT_NINE",
        "roundType": "EIGHTEEN_HOLE"
      },
      {
        "bookingId": 50002,
        "golfers": [1003, 1004, 1005, 1006],
        "teeOffSection": "FRONT_NINE",
        "roundType": "EIGHTEEN_HOLE"
      },
      {
        "bookingId": 50003,
        "golfers": [1007],
        "teeOffSection": "FRONT_NINE",
        "roundType": "NINE_HOLE"
      }
    ],
    "golfers": [
      { "id": 1001, "roundType": "EIGHTEEN_HOLE", "checkedIn": false },
      { "id": 1002, "roundType": "EIGHTEEN_HOLE", "checkedIn": false },
      { "id": 1003, "roundType": "EIGHTEEN_HOLE", "checkedIn": false },
      { "id": 1004, "roundType": "EIGHTEEN_HOLE", "checkedIn": false },
      { "id": 1005, "roundType": "EIGHTEEN_HOLE", "checkedIn": false },
      { "id": 1006, "roundType": "EIGHTEEN_HOLE", "checkedIn": false },
      { "id": 1007, "roundType": "NINE_HOLE", "checkedIn": false }
    ],
    "teeSheetPriceOverrides": [],
    "teeTimes": [
      {
        "teeTime": "2026-04-15T08:00:00",
        "prices": [
          { "roundType": "NINE_HOLE", "rackRatePrice": "30.00", "price": "30.00", "taxInclusive": false },
          { "roundType": "EIGHTEEN_HOLE", "rackRatePrice": "55.00", "price": "50.00", "taxInclusive": false }
        ],
        "teeOffSections": [
          { "teeOff": "FRONT_NINE", "bookings": [], "isHeld": false }
        ],
        "squeezeTime": false,
        "shotgun": false
      },
      {
        "teeTime": "2026-04-15T08:09:00",
        "prices": [
          { "roundType": "NINE_HOLE", "rackRatePrice": "30.00", "price": "30.00", "taxInclusive": false },
          { "roundType": "EIGHTEEN_HOLE", "rackRatePrice": "55.00", "price": "50.00", "taxInclusive": false }
        ],
        "teeOffSections": [
          { "teeOff": "FRONT_NINE", "bookings": [50001], "isHeld": false }
        ],
        "squeezeTime": false,
        "shotgun": false
      },
      {
        "teeTime": "2026-04-15T08:18:00",
        "prices": [
          { "roundType": "NINE_HOLE", "rackRatePrice": "30.00", "price": "30.00", "taxInclusive": false },
          { "roundType": "EIGHTEEN_HOLE", "rackRatePrice": "55.00", "price": "50.00", "taxInclusive": false }
        ],
        "teeOffSections": [
          { "teeOff": "FRONT_NINE", "bookings": [50002], "isHeld": false }
        ],
        "squeezeTime": false,
        "shotgun": false
      },
      {
        "teeTime": "2026-04-15T08:27:00",
        "prices": [
          { "roundType": "NINE_HOLE", "rackRatePrice": "30.00", "price": "30.00", "taxInclusive": false },
          { "roundType": "EIGHTEEN_HOLE", "rackRatePrice": "55.00", "price": "50.00", "taxInclusive": false }
        ],
        "teeOffSections": [
          { "teeOff": "FRONT_NINE", "bookings": [], "isHeld": true }
        ],
        "squeezeTime": false,
        "shotgun": false
      },
      {
        "teeTime": "2026-04-15T08:36:00",
        "prices": [
          { "roundType": "NINE_HOLE", "rackRatePrice": "25.00", "price": "25.00", "taxInclusive": false }
        ],
        "teeOffSections": [
          { "teeOff": "FRONT_NINE", "bookings": [50003], "isHeld": false }
        ],
        "squeezeTime": false,
        "shotgun": false
      }
    ]
  }
}
```

Fixture slot summary:
- `08:00` — fully open (no bookings), both prices → 4 open slots, $50 (18-hole)
- `08:09` — partially booked (2 golfers via booking 50001) → 2 open slots, $50
- `08:18` — fully booked (4 golfers via booking 50002) → 0 open slots, FILTERED OUT
- `08:27` — held section (`isHeld: true`) → FILTERED OUT
- `08:36` — only 9-hole pricing, 1 golfer booked → 3 open slots, $25, holes: 9

### Step 2: Write the test file

Create `src/adapters/teesnap.test.ts` with this exact content:

```typescript
// @vitest-environment node
// ABOUTME: Tests for the Teesnap platform adapter.
// ABOUTME: Covers availability calculation, price mapping, held sections, and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeensnapAdapter } from "./teesnap";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/teesnap-tee-times.json";

const mockConfig: CourseConfig = {
  id: "stoneridge",
  name: "StoneRidge",
  platform: "teesnap",
  platformConfig: {
    subdomain: "stoneridgegc",
    courseId: "1320",
  },
  bookingUrl: "https://stoneridgegc.teesnap.net",
};

describe("TeensnapAdapter", () => {
  const adapter = new TeensnapAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("teesnap");
  });

  it("parses tee times and calculates availability", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // 5 slots in fixture: 08:00 (open), 08:09 (partial), 08:18 (full), 08:27 (held), 08:36 (9-hole only)
    // 08:18 filtered (0 open), 08:27 filtered (held) → 3 results
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "stoneridge",
      time: "2026-04-15T08:00:00",
      price: 50,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://stoneridgegc.teesnap.net",
    });
  });

  it("calculates open slots from booking golfer counts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].openSlots).toBe(4); // 08:00 — no bookings
    expect(results[1].openSlots).toBe(2); // 08:09 — 2 golfers booked
  });

  it("filters out fully booked slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:18:00"); // 4 golfers = full
  });

  it("filters out held sections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:27:00"); // isHeld = true
  });

  it("uses 18-hole promotional price (not rack rate) when available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Fixture: rackRatePrice "55.00", price "50.00" — must use price (promo), not rackRate
    expect(results[0].price).toBe(50);
    expect(results[0].holes).toBe(18);
  });

  it("falls back to 9-hole price when no 18-hole price exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // 08:36 has only NINE_HOLE pricing at $25
    const nineHoleSlot = results.find((r) => r.time === "2026-04-15T08:36:00");
    expect(nineHoleSlot?.price).toBe(25);
    expect(nineHoleSlot?.holes).toBe(9);
  });

  // PITFALL WARNING (testing-pitfalls.md §1.1): date_not_allowed is the ONLY case where
  // returning [] is correct. This is NOT an error — it means the course is closed for the
  // season. All actual errors (HTTP failures, network errors) must THROW, never return [].
  it("returns empty array for date_not_allowed (closed course)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: "date_not_allowed" }), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-01-15");
    expect(results).toEqual([]);
  });

  it("returns empty array when teeTimes.teeTimes is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("builds correct API URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://stoneridgegc.teesnap.net/customer-api/teetimes-day?course=1320&date=2026-04-15&players=1&holes=18&addons=off"
    );
  });

  it("sends browser-like User-Agent header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
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

  it("throws on HTTP 403 (CDN bot block)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("HTTP 403");
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
  it("throws when subdomain is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { courseId: "1320" },
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("subdomain");
  });

  it("throws when courseId is missing", async () => {
    const badConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { subdomain: "stoneridgegc" },
    };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("courseId");
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }),
        { status: 200 }
      )
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
```

### Step 3: Run tests to verify they fail

Run: `npx vitest run src/adapters/teesnap.test.ts`
Expected: FAIL — `TeensnapAdapter` does not exist yet.

### Step 4: Implement the adapter

Create `src/adapters/teesnap.ts` with this exact content:

```typescript
// ABOUTME: Teesnap platform adapter for fetching tee times.
// ABOUTME: Calculates availability from booking/golfer data; handles seasonal closures.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface TeensnapBooking {
  bookingId: number;
  golfers: number[];
}

interface TeensnapPrice {
  roundType: string;
  price: string;
  rackRatePrice: string;
}

interface TeensnapSection {
  teeOff: string;
  bookings: number[];
  isHeld: boolean;
}

interface TeensnapTeeTime {
  teeTime: string;
  prices: TeensnapPrice[];
  teeOffSections: TeensnapSection[];
}

interface TeensnapResponse {
  errors?: string;
  teeTimes?: {
    bookings: TeensnapBooking[];
    teeTimes: TeensnapTeeTime[];
  };
}

export class TeensnapAdapter implements PlatformAdapter {
  readonly platformId = "teesnap";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { subdomain, courseId } = config.platformConfig;

    if (!subdomain) throw new Error("Missing subdomain in platformConfig");
    if (!courseId) throw new Error("Missing courseId in platformConfig");

    const url =
      `https://${subdomain}.teesnap.net/customer-api/teetimes-day` +
      `?course=${courseId}&date=${date}&players=1&holes=18&addons=off`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Teesnap API returned HTTP ${response.status}`);
    }

    const data: TeensnapResponse = await response.json();

    // date_not_allowed means the course is closed for the season — not an error
    if (data.errors === "date_not_allowed") {
      return [];
    }

    if (!data.teeTimes?.teeTimes) {
      return [];
    }

    // Build booking lookup: bookingId -> golfer count
    const golferCounts = new Map<number, number>();
    for (const booking of data.teeTimes.bookings ?? []) {
      golferCounts.set(booking.bookingId, booking.golfers.length);
    }

    const results: TeeTime[] = [];

    for (const tt of data.teeTimes.teeTimes) {
      // Sum booked golfers across all non-held sections
      let allHeld = true;
      let totalBooked = 0;

      for (const section of tt.teeOffSections) {
        if (section.isHeld) continue;
        allHeld = false;
        for (const bookingId of section.bookings) {
          totalBooked += golferCounts.get(bookingId) ?? 0;
        }
      }

      if (allHeld) continue;

      const openSlots = 4 - totalBooked;
      if (openSlots <= 0) continue;

      // Prefer 18-hole price, fall back to 9-hole
      const eighteenPrice = tt.prices.find(
        (p) => p.roundType === "EIGHTEEN_HOLE"
      );
      const ninePrice = tt.prices.find((p) => p.roundType === "NINE_HOLE");
      const selectedPrice = eighteenPrice ?? ninePrice;

      results.push({
        courseId: config.id,
        time: tt.teeTime,
        price: selectedPrice ? parseFloat(selectedPrice.price) : null,
        holes: eighteenPrice ? 18 : 9,
        openSlots,
        bookingUrl: config.bookingUrl,
      });
    }

    return results;
  }
}
```

### Step 5: Run tests to verify they pass

Run: `npx vitest run src/adapters/teesnap.test.ts`
Expected: ALL PASS (16 tests)

### Step 6: Commit

```bash
git add src/test/fixtures/teesnap-tee-times.json src/adapters/teesnap.test.ts src/adapters/teesnap.ts
git commit -m "feat: add Teesnap adapter with tests"
```

BEFORE marking this task complete:
1. Review your tests against `dev/testing-pitfalls.md`
2. Verify: HTTP errors throw (§1.1)? Malformed JSON throws (§6.2)? Missing config throws (§3.1)? `date_not_allowed` returns `[]` with clear comment distinguishing it from error swallowing?
3. Run `npx vitest run src/adapters/teesnap.test.ts` and confirm ALL PASS

---

## Task 2: MemberSports Adapter (fixture + tests + implementation)

BEFORE starting work:
1. Invoke the `superpowers:test-driven-development` skill
2. Read `dev/testing-pitfalls.md` — pay special attention to sections 1 (Silent Failure), 3 (Config Validation), and 6 (External API Resilience)
3. Read `dev/research/membersports-platform-investigation.md` for full API details
4. Read `src/adapters/eagle-club.ts` and `src/adapters/eagle-club.test.ts` as the reference pattern
Follow TDD: write failing test → implement fix → verify green.

**Files:**
- Create: `src/test/fixtures/membersports-tee-times.json`
- Create: `src/adapters/membersports.test.ts`
- Create: `src/adapters/membersports.ts`

### Step 1: Create the test fixture

Create `src/test/fixtures/membersports-tee-times.json` with this exact content:

```json
[
  {
    "teeTime": 480,
    "items": [
      {
        "allowSinglesToBookOnline": true,
        "availableCount": 0,
        "bookingNotAllowed": false,
        "golfClubId": 9431,
        "golfCourseId": 11701,
        "golfCourseNumberOfHoles": 18,
        "hide": false,
        "name": "River Oaks Municipal",
        "playerCount": 0,
        "price": 42.0,
        "teeTime": 480,
        "teeTimeId": 14395001
      }
    ]
  },
  {
    "teeTime": 492,
    "items": [
      {
        "allowSinglesToBookOnline": true,
        "availableCount": 0,
        "bookingNotAllowed": false,
        "golfClubId": 9431,
        "golfCourseId": 11701,
        "golfCourseNumberOfHoles": 18,
        "hide": false,
        "name": "River Oaks Municipal",
        "playerCount": 2,
        "price": 42.0,
        "teeTime": 492,
        "teeTimeId": 14395002
      }
    ]
  },
  {
    "teeTime": 504,
    "items": [
      {
        "allowSinglesToBookOnline": true,
        "availableCount": 0,
        "bookingNotAllowed": false,
        "golfClubId": 9431,
        "golfCourseId": 11701,
        "golfCourseNumberOfHoles": 18,
        "hide": false,
        "name": "River Oaks Municipal",
        "playerCount": 4,
        "price": 42.0,
        "teeTime": 504,
        "teeTimeId": 14395003
      }
    ]
  },
  {
    "teeTime": 516,
    "items": [
      {
        "allowSinglesToBookOnline": true,
        "availableCount": 0,
        "bookingNotAllowed": true,
        "golfClubId": 9431,
        "golfCourseId": 11701,
        "golfCourseNumberOfHoles": 18,
        "hide": false,
        "name": "River Oaks Municipal",
        "playerCount": 0,
        "price": 42.0,
        "teeTime": 516,
        "teeTimeId": 14395004
      }
    ]
  },
  {
    "teeTime": 528,
    "items": [
      {
        "allowSinglesToBookOnline": true,
        "availableCount": 0,
        "bookingNotAllowed": false,
        "golfClubId": 9431,
        "golfCourseId": 11701,
        "golfCourseNumberOfHoles": 18,
        "hide": true,
        "name": "River Oaks Municipal",
        "playerCount": 0,
        "price": 42.0,
        "teeTime": 528,
        "teeTimeId": 14395005
      }
    ]
  },
  {
    "teeTime": 540,
    "items": []
  }
]
```

Fixture slot summary:
- `480` (8:00 AM) — fully open, 0 players → 4 open slots, $42
- `492` (8:12 AM) — 2 players booked → 2 open slots, $42
- `504` (8:24 AM) — 4 players booked → 0 open slots, FILTERED OUT
- `516` (8:36 AM) — `bookingNotAllowed: true` → FILTERED OUT
- `528` (8:48 AM) — `hide: true` → FILTERED OUT
- `540` (9:00 AM) — empty `items` → FILTERED OUT

### Step 2: Write the test file

Create `src/adapters/membersports.test.ts` with this exact content:

```typescript
// @vitest-environment node
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

    // 6 entries: 480 (open), 492 (partial), 504 (full), 516 (blocked), 528 (hidden), 540 (empty)
    // 504, 516, 528, 540 filtered out → 2 results
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

    expect(results[0].time).toBe("2026-04-15T08:00:00"); // 480 min = 8:00
    expect(results[1].time).toBe("2026-04-15T08:12:00"); // 492 min = 8:12
  });

  it("calculates open slots as 4 - playerCount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results[0].openSlots).toBe(4); // playerCount: 0
    expect(results[1].openSlots).toBe(2); // playerCount: 2
  });

  it("filters out fully booked slots (playerCount >= 4)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:24:00"); // playerCount: 4
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
    // Config values are strings in platformConfig but must be sent as integers to the API
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
```

### Step 3: Run tests to verify they fail

Run: `npx vitest run src/adapters/membersports.test.ts`
Expected: FAIL — `MemberSportsAdapter` does not exist yet.

### Step 4: Implement the adapter

Create `src/adapters/membersports.ts` with this exact content:

```typescript
// ABOUTME: MemberSports platform adapter for fetching tee times.
// ABOUTME: Uses POST with static API key; converts minutes-since-midnight to ISO times.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

const API_URL =
  "https://api.membersports.com/api/v1.0/GolfClubs/onlineBookingTeeTimes";
const API_KEY = "A9814038-9E19-4683-B171-5A06B39147FC";

interface MemberSportsItem {
  bookingNotAllowed: boolean;
  golfCourseNumberOfHoles: number;
  hide: boolean;
  playerCount: number;
  price: number;
  teeTime: number;
}

interface MemberSportsSlot {
  teeTime: number;
  items: MemberSportsItem[];
}

export class MemberSportsAdapter implements PlatformAdapter {
  readonly platformId = "membersports";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { golfClubId, golfCourseId } = config.platformConfig;

    if (!golfClubId) throw new Error("Missing golfClubId in platformConfig");
    if (!golfCourseId) throw new Error("Missing golfCourseId in platformConfig");

    const body = {
      configurationTypeId: 0,
      date,
      golfClubGroupId: 0,
      golfClubId: parseInt(golfClubId, 10),
      golfCourseId: parseInt(golfCourseId, 10),
      groupSheetTypeId: 0,
      memberProfileId: 0,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`MemberSports API returned HTTP ${response.status}`);
    }

    const data: MemberSportsSlot[] = await response.json();

    const results: TeeTime[] = [];

    for (const slot of data) {
      if (slot.items.length === 0) continue;

      const item = slot.items[0];
      if (item.bookingNotAllowed || item.hide) continue;

      const openSlots = 4 - item.playerCount;
      if (openSlots <= 0) continue;

      results.push({
        courseId: config.id,
        time: this.minutesToIso(date, slot.teeTime),
        price: item.price,
        holes: item.golfCourseNumberOfHoles === 9 ? 9 : 18,
        openSlots,
        bookingUrl: config.bookingUrl,
      });
    }

    return results;
  }

  /** Convert minutes since midnight to "YYYY-MM-DDTHH:MM:00" */
  private minutesToIso(date: string, minutes: number): string {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${date}T${hh}:${mm}:00`;
  }
}
```

### Step 5: Run tests to verify they pass

Run: `npx vitest run src/adapters/membersports.test.ts`
Expected: ALL PASS (17 tests)

### Step 6: Commit

```bash
git add src/test/fixtures/membersports-tee-times.json src/adapters/membersports.test.ts src/adapters/membersports.ts
git commit -m "feat: add MemberSports adapter with tests"
```

BEFORE marking this task complete:
1. Review your tests against `dev/testing-pitfalls.md`
2. Verify: HTTP errors throw (§1.1)? Malformed JSON throws (§6.2)? Missing config throws (§3.1)? String-to-int conversion tested for POST body (§3.2)?
3. Run `npx vitest run src/adapters/membersports.test.ts` and confirm ALL PASS

---

### Review Loop: After Tasks 1-2

After completing Tasks 1 and 2:
You MUST carefully review the batch of work from multiple perspectives and revise/refine as appropriate. Repeat this review loop (you must do a minimum of three review rounds; if you still find substantive issues in the third review, keep going with additional rounds until there are no findings) until you're confident there aren't any more issues. Then update your private journal and continue onto the next tasks.

Review checklist:
- Do both adapters follow the same patterns as existing adapters in `src/adapters/`?
- Do ABOUTME comments match the standard (2 lines, greppable)?
- Does every error path throw (not return `[]`)?
- Are the only `return []` paths for known "no data" responses (not errors)?
- Do tests cover: happy path, partial data, filtered-out slots, HTTP error, network error, malformed JSON, missing config?
- Run `npm test` to confirm no regressions across the full suite.

---

## Task 3: Register Adapters + Catalog + Documentation

BEFORE starting work:
1. Read `src/adapters/index.ts` for the registration pattern
2. Read `src/config/courses.json` for the catalog entry format — look at existing ForeUp entries for the Emerald Greens pattern
3. Read `dev/research/tc-courses-platforms.md` for the documentation format

**Files:**
- Modify: `src/adapters/index.ts`
- Modify: `src/config/courses.json`
- Regenerate: `scripts/seed.sql` (via `npx tsx scripts/seed.ts`)
- Modify: `dev/research/tc-courses-platforms.md`

### Step 1: Register both adapters in `src/adapters/index.ts`

Add these two imports after the existing imports:

```typescript
import { TeensnapAdapter } from "./teesnap";
import { MemberSportsAdapter } from "./membersports";
```

Add these two entries to the `adapters` array (after `new TeeWireAdapter()`):

```typescript
new TeensnapAdapter(),
new MemberSportsAdapter(),
```

### Step 2: Add five courses to `src/config/courses.json`

Insert these entries **before** the first SD test course (the entry with `"id": "sd-balboa-park"`). The last MN course currently is Ft. Snelling at index 43.

```json
{
  "index": 44,
  "id": "daytona",
  "name": "Daytona Golf Club",
  "city": "Dayton",
  "state": "MN",
  "platform": "teesnap",
  "platformConfig": {
    "subdomain": "daytonagolfclub",
    "courseId": "1163"
  },
  "bookingUrl": "https://daytonagolfclub.teesnap.net"
},
{
  "index": 45,
  "id": "stoneridge",
  "name": "StoneRidge",
  "city": "Stillwater",
  "state": "MN",
  "platform": "teesnap",
  "platformConfig": {
    "subdomain": "stoneridgegc",
    "courseId": "1320"
  },
  "bookingUrl": "https://stoneridgegc.teesnap.net"
},
{
  "index": 46,
  "id": "river-oaks",
  "name": "River Oaks Municipal",
  "city": "Cottage Grove",
  "state": "MN",
  "platform": "membersports",
  "platformConfig": {
    "golfClubId": "9431",
    "golfCourseId": "11701"
  },
  "bookingUrl": "https://app.membersports.com/tee-times/9431/11701/0"
},
{
  "index": 47,
  "id": "emerald-greens-gold",
  "name": "Emerald Greens (Gold)",
  "city": "Hastings",
  "state": "MN",
  "platform": "foreup",
  "platformConfig": {
    "facilityId": "19202",
    "scheduleId": "1266"
  },
  "bookingUrl": "https://foreupsoftware.com/index.php/booking/19202/1266"
},
{
  "index": 48,
  "id": "emerald-greens-silver",
  "name": "Emerald Greens (Silver)",
  "city": "Hastings",
  "state": "MN",
  "platform": "foreup",
  "platformConfig": {
    "facilityId": "19202",
    "scheduleId": "1308"
  },
  "bookingUrl": "https://foreupsoftware.com/index.php/booking/19202/1308"
}
```

### Step 3: Regenerate seed SQL

Run: `npx tsx scripts/seed.ts`
Expected output: `Wrote 49 courses to .../seed.sql`

### Step 4: Update `dev/research/tc-courses-platforms.md`

Make these exact changes:

**Platform Summary table** — replace the existing table rows:

| Platform | 18-Hole | 9-Hole/Par 3 | Total |
|----------|---------|---------------|-------|
| CPS Golf (Club Prophet) | 12 | 2 | 14 |
| Chronogolf/Lightspeed | 27 | 8 | 35 |
| TeeItUp | 7 | 1 | 8 |
| ForeUp | 5 | 1 | 6 |
| Teesnap | 2 | 0 | 2 |
| MemberSports | 1 | 0 | 1 |
| GolfNow (primary) | 3 | 2 | 5 |
| Eagle Club Systems | 1 | 0 | 1 |
| EZLinks | 1 | 0 | 1 |
| City/Custom System | 0 | 3 | 3 |
| Unknown/Closed | 2 | 2 | 4 |
| **Total** | **61** | **19** | **80** |

Changes: ForeUp 3→5 (18-hole) and 4→6 (total) for Emerald Greens Gold/Silver. Teesnap 3→2 (River Oaks removed). GolfNow 4→3 and 6→5 (Emerald Greens removed). MemberSports row added. Total 79→80.

**Teesnap section** — remove the River Oaks row from the table. Add this note below the table:

```
> **Note:** River Oaks Municipal (Cottage Grove) previously used Teesnap but has moved to MemberSports.
```

**Add new MemberSports section** — insert after the Teesnap section:

```markdown
## MemberSports

Courses using `app.membersports.com` for reservations.

| Course Name | City | Holes | MemberSports IDs | Notes |
|---|---|---|---|---|
| River Oaks Municipal | Cottage Grove | 18 | golfClubId 9431, golfCourseId 11701 | Previously on Teesnap |

**Notes:**
- MemberSports uses a public REST API at `api.membersports.com` with a static `x-api-key`.
- Only River Oaks is confirmed to actively use MemberSports in the TC metro. Other MN courses have MemberSports catalog entries but don't use it for booking.
```

**GolfNow section** — remove the Emerald Greens row from the table. Add this note:

```
> **Note:** Emerald Greens (Hastings) was previously listed here but uses ForeUp as its primary booking system (facility 19202).
```

**ForeUp section** — add two rows to the table:

```
| Emerald Greens (Gold) | Hastings | 18 | Facility 19202, Schedule 1266 | 36-hole facility |
| Emerald Greens (Silver) | Hastings | 18 | Facility 19202, Schedule 1308 | 36-hole facility |
```

**Platforms needing API investigation section** — change the Teesnap bullet to:

```
- **Teesnap:** 2 courses. Adapter implemented.
```

Add a new bullet:

```
- **MemberSports:** 1 course (River Oaks). Adapter implemented.
```

### Step 5: Run full test suite + type check

Run: `npm test && npx tsc --noEmit`
Expected: ALL PASS, no type errors

### Step 6: Commit (two separate commits)

```bash
git add src/adapters/index.ts src/config/courses.json scripts/seed.sql
git commit -m "feat: register Teesnap/MemberSports adapters and add 5 courses to catalog"

git add dev/research/tc-courses-platforms.md
git commit -m "docs: update platform catalog — River Oaks to MemberSports, Emerald Greens to ForeUp"
```

BEFORE marking this task complete:
1. Verify `npx tsx scripts/seed.ts` outputs exactly 49 courses
2. Run `npm test && npx tsc --noEmit` and confirm ALL PASS
3. Verify the adapters array in `index.ts` has 8 entries (6 existing + 2 new)

---

## Task 4: Smoke Tests + Final Verification

BEFORE starting work:
1. Read `src/adapters/eagle-club.smoke.test.ts` as the exact pattern to follow
2. Read `src/lib/format.ts` for the `todayCT()` function used to compute test dates

**Files:**
- Create: `src/adapters/teesnap.smoke.test.ts`
- Create: `src/adapters/membersports.smoke.test.ts`

### Step 1: Write Teesnap smoke test

Create `src/adapters/teesnap.smoke.test.ts` with this exact content:

```typescript
// ABOUTME: Live API smoke tests for the Teesnap adapter against StoneRidge.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeensnapAdapter } from "./teesnap";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 3));
  return future.toISOString().split("T")[0];
})();

const config: CourseConfig = {
  id: "stoneridge",
  name: "StoneRidge",
  platform: "teesnap",
  platformConfig: {
    subdomain: "stoneridgegc",
    courseId: "1320",
  },
  bookingUrl: "https://stoneridgegc.teesnap.net",
};

let captured: { url: string; body: unknown }[];
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init?) => {
    const response = await originalFetch(input, init);
    const clone = response.clone();
    try {
      captured.push({ url: String(input), body: await clone.json() });
    } catch {
      /* non-JSON response */
    }
    return response;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function fetchTeeTimes(adapter: TeensnapAdapter): Promise<TeeTime[]> {
  captured = [];
  return adapter.fetchTeeTimes(config, testDate);
}

describe.skip("Teesnap - live API smoke tests", () => {
  const adapter = new TeensnapAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const results = await fetchTeeTimes(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe.skip("Teesnap - API contract validation", () => {
  const adapter = new TeensnapAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "Teesnap Level 2: No tee times available — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as {
        teeTimes: {
          teeTimes: { teeTime: string; prices: unknown[]; teeOffSections: unknown[] }[];
          bookings: unknown[];
        };
      };

      expect(Array.isArray(data.teeTimes.teeTimes)).toBe(true);
      expect(Array.isArray(data.teeTimes.bookings)).toBe(true);

      for (const tt of data.teeTimes.teeTimes) {
        expect(typeof tt.teeTime).toBe("string");
        expect(tt.teeTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(Array.isArray(tt.prices)).toBe(true);
        expect(Array.isArray(tt.teeOffSections)).toBe(true);
      }
    },
    15000
  );
});

describe.skip("Teesnap - parsed output validation", () => {
  const adapter = new TeensnapAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "Teesnap Level 3: No tee times available — skipping output validation"
        );
        ctx.skip();
        return;
      }

      for (const tt of results) {
        expect(tt.courseId).toBe(config.id);
        expect(tt.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        expect(new Date(tt.time).getTime()).not.toBeNaN();

        if (tt.price !== null) {
          expect(typeof tt.price).toBe("number");
          expect(Number.isNaN(tt.price)).toBe(false);
        }

        expect([9, 18]).toContain(tt.holes);
        expect(Number.isInteger(tt.openSlots)).toBe(true);
        expect(tt.openSlots).toBeGreaterThan(0);
        expect(tt.bookingUrl).toBeTruthy();
      }
    },
    15000
  );
});
```

### Step 2: Write MemberSports smoke test

Create `src/adapters/membersports.smoke.test.ts` with this exact content:

```typescript
// ABOUTME: Live API smoke tests for the MemberSports adapter against River Oaks.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemberSportsAdapter } from "./membersports";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 3));
  return future.toISOString().split("T")[0];
})();

const config: CourseConfig = {
  id: "river-oaks",
  name: "River Oaks Municipal",
  platform: "membersports",
  platformConfig: {
    golfClubId: "9431",
    golfCourseId: "11701",
  },
  bookingUrl: "https://app.membersports.com/tee-times/9431/11701/0",
};

let captured: { url: string; body: unknown }[];
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init?) => {
    const response = await originalFetch(input, init);
    const clone = response.clone();
    try {
      captured.push({ url: String(input), body: await clone.json() });
    } catch {
      /* non-JSON response */
    }
    return response;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function fetchTeeTimes(
  adapter: MemberSportsAdapter
): Promise<TeeTime[]> {
  captured = [];
  return adapter.fetchTeeTimes(config, testDate);
}

describe.skip("MemberSports - live API smoke tests", () => {
  const adapter = new MemberSportsAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const results = await fetchTeeTimes(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe.skip("MemberSports - API contract validation", () => {
  const adapter = new MemberSportsAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "MemberSports Level 2: No tee times available — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as {
        teeTime: number;
        items: { teeTime: number; price: number; playerCount: number }[];
      }[];

      expect(Array.isArray(data)).toBe(true);

      for (const slot of data) {
        expect(typeof slot.teeTime).toBe("number");
        expect(slot.teeTime).toBeGreaterThanOrEqual(0);
        expect(slot.teeTime).toBeLessThan(1440); // minutes in a day
        expect(Array.isArray(slot.items)).toBe(true);

        for (const item of slot.items) {
          expect(typeof item.teeTime).toBe("number");
          expect(typeof item.price).toBe("number");
          expect(typeof item.playerCount).toBe("number");
        }
      }
    },
    15000
  );
});

describe.skip("MemberSports - parsed output validation", () => {
  const adapter = new MemberSportsAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "MemberSports Level 3: No tee times available — skipping output validation"
        );
        ctx.skip();
        return;
      }

      for (const tt of results) {
        expect(tt.courseId).toBe(config.id);
        expect(tt.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        expect(new Date(tt.time).getTime()).not.toBeNaN();

        if (tt.price !== null) {
          expect(typeof tt.price).toBe("number");
          expect(Number.isNaN(tt.price)).toBe(false);
        }

        expect([9, 18]).toContain(tt.holes);
        expect(Number.isInteger(tt.openSlots)).toBe(true);
        expect(tt.openSlots).toBeGreaterThan(0);
        expect(tt.bookingUrl).toBeTruthy();
      }
    },
    15000
  );
});
```

### Step 3: Run smoke tests manually

Remove `.skip` from each describe block one at a time, run, then re-add `.skip`:

```bash
npx vitest run src/adapters/teesnap.smoke.test.ts
npx vitest run src/adapters/membersports.smoke.test.ts
```

Expected: ALL PASS (or skip if course is closed for season — this is acceptable for MN courses in winter)

### Step 4: Final verification

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: ALL PASS, no type errors, no lint errors

### Step 5: Commit

```bash
git add src/adapters/teesnap.smoke.test.ts src/adapters/membersports.smoke.test.ts
git commit -m "test: add Teesnap and MemberSports smoke tests"
```

BEFORE marking this task complete:
1. Verify smoke tests use `describe.skip` (they must NOT run in CI)
2. Verify smoke tests follow the 3-level pattern (adapter execution, API contract, parsed output)
3. Run `npm test` and confirm no regressions (smoke tests should be skipped)
4. Run `npx tsc --noEmit` and confirm clean

---

### Review Loop: After Tasks 3-4

After completing Tasks 3 and 4:
You MUST carefully review the batch of work from multiple perspectives and revise/refine as appropriate. Repeat this review loop (you must do a minimum of three review rounds; if you still find substantive issues in the third review, keep going with additional rounds until there are no findings) until you're confident there aren't any more issues. Then update your private journal and continue onto the next tasks.

Review checklist:
- Does `src/adapters/index.ts` have exactly 8 adapter entries?
- Does `src/config/courses.json` have exactly 49 entries?
- Does `scripts/seed.sql` have exactly 49 INSERT statements?
- Do the new catalog entries match the platformConfig format expected by their adapters?
- Do the Emerald Greens ForeUp entries use `facilityId` + `scheduleId` (matching the existing ForeUp pattern)?
- Does `tc-courses-platforms.md` have consistent counts in the summary table vs the individual sections?
- Run `npm test && npx tsc --noEmit && npm run lint` — all clean?
