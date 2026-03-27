# Teesnap & MemberSports Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Teesnap and MemberSports platform adapters, plus five new catalog courses (Daytona, StoneRidge, River Oaks, Emerald Greens Gold/Silver).

**Architecture:** Two new adapters following the established `PlatformAdapter` pattern. Teesnap uses GET with availability calculated from booking data. MemberSports uses POST with a static API key. Emerald Greens uses the existing ForeUp adapter. All courses added to `courses.json` and registered in the adapter index.

**Tech Stack:** TypeScript, Vitest, existing adapter patterns

**Design doc:** `docs/plans/2026-03-27-teesnap-membersports-design.md`
**Teesnap API research:** `dev/research/teesnap-platform-investigation.md`
**MemberSports API research:** `dev/research/membersports-platform-investigation.md`

---

## Task 1: Teesnap Adapter — Test Fixture

**Files:**
- Create: `src/test/fixtures/teesnap-tee-times.json`

**Context:** The Teesnap API returns a nested response with `teeTimes.teeTimes[]` for slots, `teeTimes.bookings[]` for booking details, and `teeTimes.golfers[]` for golfer counts. We need a fixture that exercises: fully open slots, partially booked slots, fully booked slots, held sections, and both 9/18-hole pricing.

**Step 1: Create the test fixture**

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

Fixture covers:
- `08:00` — fully open (no bookings), both prices → 4 open slots, $50 (18-hole)
- `08:09` — partially booked (2 golfers via booking 50001) → 2 open slots, $50
- `08:18` — fully booked (4 golfers via booking 50002) → 0 open slots, filtered out
- `08:27` — held section → filtered out (even though no bookings)
- `08:36` — only 9-hole pricing, 1 golfer booked → 3 open slots, $25, holes: 9

**Step 2: Commit**

```bash
git add src/test/fixtures/teesnap-tee-times.json
git commit -m "test: add Teesnap API response fixture"
```

---

## Task 2: Teesnap Adapter — Unit Tests

**Files:**
- Create: `src/adapters/teesnap.test.ts`

**Context:** Follow the pattern in `src/adapters/eagle-club.test.ts`. Mock `globalThis.fetch`, use the fixture, test all behaviors.

**Step 1: Write the test file**

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
    // 08:18 filtered (0 open), 08:27 filtered (held)
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

  it("uses 18-hole price when available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // Uses promotional price ($50) not rack rate ($55)
    expect(results[0].price).toBe(50);
    expect(results[0].holes).toBe(18);
  });

  it("falls back to 9-hole price when no 18-hole price exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    // 08:36 has only NINE_HOLE pricing
    const nineHoleSlot = results.find((r) => r.time === "2026-04-15T08:36:00");
    expect(nineHoleSlot?.price).toBe(25);
    expect(nineHoleSlot?.holes).toBe(9);
  });

  it("returns empty array for date_not_allowed (closed course)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: "date_not_allowed" }), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-01-15");
    expect(results).toEqual([]);
  });

  it("builds correct API URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://stoneridgegc.teesnap.net/customer-api/teetimes-day?course=1320&date=2026-04-15&players=1&holes=18&addons=off"
    );
  });

  it("sends browser-like User-Agent header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("HTTP 500");
  });

  it("throws when subdomain is missing", async () => {
    const badConfig: CourseConfig = { ...mockConfig, platformConfig: { courseId: "1320" } };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("subdomain");
  });

  it("throws when courseId is missing", async () => {
    const badConfig: CourseConfig = { ...mockConfig, platformConfig: { subdomain: "stoneridgegc" } };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("courseId");
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ teeTimes: { teeTimes: [], bookings: [] } }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/teesnap.test.ts`
Expected: FAIL — `TeensnapAdapter` does not exist yet.

**Step 3: Commit**

```bash
git add src/adapters/teesnap.test.ts
git commit -m "test: add Teesnap adapter tests (red)"
```

---

## Task 3: Teesnap Adapter — Implementation

**Files:**
- Create: `src/adapters/teesnap.ts`

**Step 1: Implement the adapter**

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

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/adapters/teesnap.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/adapters/teesnap.ts
git commit -m "feat: add Teesnap adapter"
```

---

## Task 4: MemberSports Adapter — Test Fixture

**Files:**
- Create: `src/test/fixtures/membersports-tee-times.json`

**Step 1: Create the test fixture**

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

Fixture covers:
- `480` (8:00 AM) — fully open, 0 players → 4 open slots
- `492` (8:12 AM) — 2 players booked → 2 open slots
- `504` (8:24 AM) — 4 players booked → 0 open slots, filtered out
- `516` (8:36 AM) — `bookingNotAllowed: true` → filtered out
- `528` (8:48 AM) — `hide: true` → filtered out
- `540` (9:00 AM) — empty `items` → filtered out

**Step 2: Commit**

```bash
git add src/test/fixtures/membersports-tee-times.json
git commit -m "test: add MemberSports API response fixture"
```

---

## Task 5: MemberSports Adapter — Unit Tests

**Files:**
- Create: `src/adapters/membersports.test.ts`

**Step 1: Write the test file**

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

    // 6 entries in fixture: 480 (open), 492 (partial), 504 (full), 516 (blocked), 528 (hidden), 540 (empty items)
    // 504, 516, 528, 540 filtered out
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

  it("filters out fully booked slots", async () => {
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

    expect(times).not.toContain("2026-04-15T08:36:00"); // bookingNotAllowed: true
  });

  it("filters out hidden slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T08:48:00"); // hide: true
  });

  it("filters out slots with empty items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const times = results.map((r) => r.time);

    expect(times).not.toContain("2026-04-15T09:00:00"); // items: []
  });

  it("sends correct POST body", async () => {
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
    expect(body.golfClubId).toBe(9431);
    expect(body.golfCourseId).toBe(11701);
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

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    await expect(
      adapter.fetchTeeTimes(mockConfig, "2026-04-15")
    ).rejects.toThrow("HTTP 500");
  });

  it("throws when golfClubId is missing", async () => {
    const badConfig: CourseConfig = { ...mockConfig, platformConfig: { golfCourseId: "11701" } };

    await expect(
      adapter.fetchTeeTimes(badConfig, "2026-04-15")
    ).rejects.toThrow("golfClubId");
  });

  it("throws when golfCourseId is missing", async () => {
    const badConfig: CourseConfig = { ...mockConfig, platformConfig: { golfClubId: "9431" } };

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

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/membersports.test.ts`
Expected: FAIL — `MemberSportsAdapter` does not exist yet.

**Step 3: Commit**

```bash
git add src/adapters/membersports.test.ts
git commit -m "test: add MemberSports adapter tests (red)"
```

---

## Task 6: MemberSports Adapter — Implementation

**Files:**
- Create: `src/adapters/membersports.ts`

**Step 1: Implement the adapter**

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

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/adapters/membersports.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/adapters/membersports.ts
git commit -m "feat: add MemberSports adapter"
```

---

## Task 7: Register Adapters

**Files:**
- Modify: `src/adapters/index.ts`

**Step 1: Add imports and instances**

Add to imports:
```typescript
import { TeensnapAdapter } from "./teesnap";
import { MemberSportsAdapter } from "./membersports";
```

Add to the `adapters` array:
```typescript
new TeensnapAdapter(),
new MemberSportsAdapter(),
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/adapters/index.ts
git commit -m "feat: register Teesnap and MemberSports adapters"
```

---

## Task 8: Add Courses to Catalog

**Files:**
- Modify: `src/config/courses.json`

**Context:** Next available index is 44. ForeUp bookingUrl pattern is `https://foreupsoftware.com/index.php/booking/{facilityId}/{scheduleId}`.

**Step 1: Add five new course entries to `courses.json`**

Add these entries (insert among the MN courses, before the SD test courses):

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

**Step 2: Regenerate seed SQL**

Run: `npx tsx scripts/seed.ts`
Expected: `Wrote 49 courses to ...seed.sql`

**Step 3: Apply seed to local D1**

Run: `npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql`

**Step 4: Run full test suite + type check**

Run: `npm test && npx tsc --noEmit`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/config/courses.json scripts/seed.sql
git commit -m "feat: add Daytona, StoneRidge, River Oaks, Emerald Greens Gold/Silver to catalog"
```

---

## Task 9: Update Platform Catalog Documentation

**Files:**
- Modify: `dev/research/tc-courses-platforms.md`

**Step 1: Update the platform catalog**

- In the **Platform Summary** table: add row for MemberSports (1 course, 18-hole). Update Teesnap to 2 courses (River Oaks removed). Add 2 more to ForeUp count (Emerald Greens Gold/Silver). Remove 2 from GolfNow (Emerald Greens was incorrectly listed there). Adjust totals.
- In the **Teesnap** section: remove River Oaks row, add note that River Oaks moved to MemberSports.
- Add a new **MemberSports** section with River Oaks entry.
- In the **GolfNow** section: remove Emerald Greens row, add note that it uses ForeUp.
- In the **ForeUp** section: add Emerald Greens Gold and Emerald Greens Silver rows.
- In the **Platforms needing API investigation** section: remove Teesnap (done). Add note that MemberSports is implemented.

**Step 2: Commit**

```bash
git add dev/research/tc-courses-platforms.md
git commit -m "docs: update platform catalog — River Oaks to MemberSports, Emerald Greens to ForeUp"
```

---

## Task 10: Smoke Tests

**Files:**
- Create: `src/adapters/teesnap.smoke.test.ts`
- Create: `src/adapters/membersports.smoke.test.ts`

**Context:** Follow the pattern in `src/adapters/eagle-club.smoke.test.ts`. These hit live APIs and are NOT run in CI — they're for manual verification. Use `describe.skip` so they don't run in `npm test`.

**Step 1: Write Teesnap smoke test**

Test against StoneRidge (active course, courseId 1320). Verify:
- HTTP 200 response
- Response has `teeTimes.teeTimes` array
- Each tee time has `teeTime`, `prices`, `teeOffSections`
- Adapter returns valid `TeeTime[]` with expected fields

**Step 2: Write MemberSports smoke test**

Test against River Oaks (golfClubId 9431, golfCourseId 11701). Verify:
- HTTP 200 response
- Response is an array of slots with `teeTime` (number) and `items`
- Adapter returns valid `TeeTime[]` with expected fields

**Step 3: Run smoke tests manually to verify**

Run: `npx vitest run src/adapters/teesnap.smoke.test.ts` (after removing `.skip`)
Run: `npx vitest run src/adapters/membersports.smoke.test.ts` (after removing `.skip`)

**Step 4: Commit**

```bash
git add src/adapters/teesnap.smoke.test.ts src/adapters/membersports.smoke.test.ts
git commit -m "test: add Teesnap and MemberSports smoke tests"
```

---

## Task 11: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS (should be 509 + new tests)

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors

**Step 4: Verify local polling (optional)**

Run dev server and trigger a refresh for StoneRidge or River Oaks to verify end-to-end.

---

## Dependency Graph

```
Task 1 (Teesnap fixture) → Task 2 (Teesnap tests) → Task 3 (Teesnap impl)
Task 4 (MemberSports fixture) → Task 5 (MemberSports tests) → Task 6 (MemberSports impl)
Task 3 + Task 6 → Task 7 (register adapters)
Task 7 → Task 8 (catalog entries)
Task 8 → Task 9 (docs update)
Task 3 + Task 6 → Task 10 (smoke tests)
Task 8 + Task 9 + Task 10 → Task 11 (final verification)
```

Tasks 1-3 and Tasks 4-6 are independent and can be parallelized.
