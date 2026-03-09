# Phase 1: Foundation + CPS Golf + ForeUp — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a working app with 16 courses (13 CPS Golf + 3 ForeUp), cron-based polling, time-first UI, and deployment to Cloudflare Workers.

**Architecture:** Next.js App Router on Cloudflare Workers via OpenNext. D1 (SQLite) for storage. Platform adapters fetch tee times via plain HTTP. A cron trigger polls on a dynamic schedule and writes results to D1. The frontend reads from D1 via API routes.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Cloudflare Workers + D1 + Cron Triggers, OpenNext for Cloudflare, Vitest, Tailwind CSS, GitHub Actions CI/CD.

**Reference:** Design doc at `docs/plans/2026-03-08-tee-times-app-design.md`. Research at `dev/research/`.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `wrangler.jsonc`, `src/app/layout.tsx`, `src/app/page.tsx`, `vitest.config.ts`, `tailwind.config.ts`, `src/app/globals.css`

**Step 1: Create Next.js project for Cloudflare Workers**

```bash
npm create cloudflare@latest -- . --framework=next --platform=workers
```

Accept defaults. This scaffolds Next.js with App Router, TypeScript, Tailwind CSS, and adds `@opennextjs/cloudflare` + `wrangler` as dependencies.

**Step 2: Verify the scaffold works**

```bash
npm run dev
```

Open `http://localhost:3000` — confirm the Next.js welcome page renders. Stop the dev server.

**Step 3: Add Vitest**

```bash
npm install -D vitest @vitejs/plugin-react
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Run tests to verify Vitest works**

```bash
npm test
```

Expected: "No test files found" — that's correct, we haven't written any yet.

**Step 5: Configure wrangler.jsonc with D1 binding**

Update `wrangler.jsonc` to add a D1 database binding. Keep existing OpenNext config, add:

```jsonc
{
  // ... existing config from scaffold ...
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tee-times-db",
      "database_id": "LOCAL_PLACEHOLDER"
    }
  ]
}
```

The `database_id` will be replaced with the real ID after `wrangler d1 create` during deployment setup. For local dev, wrangler uses a local SQLite file automatically.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Cloudflare Workers + Vitest"
```

---

## Task 2: D1 Database Schema

**Files:**
- Create: `migrations/0001_initial_schema.sql`

**Step 1: Create migrations directory**

```bash
mkdir migrations
```

**Step 2: Write the initial schema migration**

Create `migrations/0001_initial_schema.sql`:

```sql
-- courses: static catalog of supported golf courses
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_config TEXT NOT NULL, -- JSON
  booking_url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_active_check TEXT
);

-- tee_times: cached tee time availability
CREATE TABLE tee_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL,        -- YYYY-MM-DD
  time TEXT NOT NULL,        -- HH:MM
  price REAL,
  holes INTEGER NOT NULL,    -- 9 or 18
  open_slots INTEGER NOT NULL,
  booking_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL   -- ISO 8601
);

CREATE INDEX idx_tee_times_course_date ON tee_times(course_id, date);

-- poll_log: debugging and freshness tracking
CREATE TABLE poll_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL,         -- YYYY-MM-DD (which date was polled)
  polled_at TEXT NOT NULL,   -- ISO 8601
  status TEXT NOT NULL,      -- 'success', 'error', 'no_data'
  tee_time_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX idx_poll_log_course_date ON poll_log(course_id, date, polled_at);
```

**Step 3: Apply migration locally**

```bash
npx wrangler d1 migrations apply tee-times-db --local
```

Expected: Migration applied successfully.

**Step 4: Verify the schema**

```bash
npx wrangler d1 execute tee-times-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected: `courses`, `poll_log`, `tee_times` (plus D1's internal `_cf_KV` and `d1_migrations` tables).

**Step 5: Commit**

```bash
git add migrations/
git commit -m "feat: add D1 schema for courses, tee_times, poll_log"
```

---

## Task 3: Shared Types

**Files:**
- Create: `src/types/index.ts`

**Step 1: Define shared TypeScript types**

Create `src/types/index.ts`:

```typescript
/** Platform-specific configuration for a course's booking system */
export interface CourseConfig {
  id: string;
  name: string;
  platform: string;
  platformConfig: Record<string, string>;
  bookingUrl: string;
}

/** A single available tee time */
export interface TeeTime {
  courseId: string;
  time: string; // ISO 8601
  price: number | null;
  holes: 9 | 18;
  openSlots: number;
  bookingUrl: string;
}

/** Platform adapter interface — each booking platform implements this */
export interface PlatformAdapter {
  platformId: string;
  fetchTeeTimes(config: CourseConfig, date: string): Promise<TeeTime[]>;
}

/** Course row from D1 */
export interface CourseRow {
  id: string;
  name: string;
  city: string;
  platform: string;
  platform_config: string; // JSON string
  booking_url: string;
  is_active: number; // SQLite boolean
  last_active_check: string | null;
}

/** Tee time row from D1 */
export interface TeeTimeRow {
  id: number;
  course_id: string;
  date: string;
  time: string;
  price: number | null;
  holes: number;
  open_slots: number;
  booking_url: string;
  fetched_at: string;
}

/** Poll log row from D1 */
export interface PollLogRow {
  id: number;
  course_id: string;
  date: string;
  polled_at: string;
  status: "success" | "error" | "no_data";
  tee_time_count: number;
  error_message: string | null;
}
```

**Step 2: Commit**

```bash
git add src/types/
git commit -m "feat: add shared TypeScript types for courses, tee times, adapters"
```

---

## Task 4: Course Catalog Config + Seed Script

**Files:**
- Create: `src/config/courses.json`, `scripts/seed.ts`

**Step 1: Create the course catalog JSON**

Create `src/config/courses.json` with all 16 Phase 1 courses (13 CPS Golf + 3 ForeUp). The `platformConfig` values come from `dev/research/booking-platform-investigation.md` and `dev/research/tc-courses-platforms.md`.

> **Removed from Phase 1:** Highland 9-Hole (shares CPS subdomain `highlandnationalmn` with Highland National — can't differentiate without `courseIds`, which are unknown; add back once discovered). Pheasant Acres (ForeUp facility ID unknown; add back once discovered).

```json
[
  {
    "id": "theodore-wirth-18",
    "name": "Theodore Wirth",
    "city": "Minneapolis",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "minneapolistheodorewirth",
      "apiKey": "8ea2914e-cac2-48a7-a3e5-e0f41350bf3a",
      "courseIds": "17",
      "websiteId": "8265e495-5c83-44e5-93d8-c9e3f3a40529"
    },
    "bookingUrl": "https://minneapolistheodorewirth.cps.golf/onlineresweb"
  },
  {
    "id": "gross-national",
    "name": "Gross National",
    "city": "Minneapolis",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "minneapolisgrossnational"
    },
    "bookingUrl": "https://minneapolisgrossnational.cps.golf/onlineresweb"
  },
  {
    "id": "meadowbrook",
    "name": "Meadowbrook",
    "city": "Minneapolis",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "minneapolismeadowbrook"
    },
    "bookingUrl": "https://minneapolismeadowbrook.cps.golf/onlineresweb"
  },
  {
    "id": "columbia",
    "name": "Columbia",
    "city": "Minneapolis",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "minneapoliscolumbia"
    },
    "bookingUrl": "https://minneapoliscolumbia.cps.golf/onlineresweb"
  },
  {
    "id": "hiawatha",
    "name": "Hiawatha",
    "city": "Minneapolis",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "minneapolishiawatha"
    },
    "bookingUrl": "https://minneapolishiawatha.cps.golf/onlineresweb"
  },
  {
    "id": "phalen",
    "name": "Phalen",
    "city": "St. Paul",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "phalen"
    },
    "bookingUrl": "https://phalen.cps.golf/onlineresweb"
  },
  {
    "id": "chaska-town-course",
    "name": "Chaska Town Course",
    "city": "Chaska",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "chaska"
    },
    "bookingUrl": "https://chaska.cps.golf/onlineresweb"
  },
  {
    "id": "edinburgh-usa",
    "name": "Edinburgh USA",
    "city": "Brooklyn Park",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "edinburghusa"
    },
    "bookingUrl": "https://edinburghusa.cps.golf/onlineresweb"
  },
  {
    "id": "oak-glen",
    "name": "Oak Glen",
    "city": "Stillwater",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "oakglen"
    },
    "bookingUrl": "https://oakglen.cps.golf/onlineresweb"
  },
  {
    "id": "highland-national",
    "name": "Highland National",
    "city": "St. Paul",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "highlandnationalmn"
    },
    "bookingUrl": "https://highlandnationalmn.cps.golf/onlineresweb"
  },
  {
    "id": "como-park",
    "name": "Como Park",
    "city": "St. Paul",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "como"
    },
    "bookingUrl": "https://como.cps.golf/onlineresweb"
  },
  {
    "id": "victory-links",
    "name": "Victory Links",
    "city": "Blaine",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "victorylinksmn"
    },
    "bookingUrl": "https://victorylinksmn.cps.golf/onlineresweb"
  },
  {
    "id": "gem-lake-hills",
    "name": "Gem Lake Hills",
    "city": "White Bear Lake",
    "platform": "cps_golf",
    "platformConfig": {
      "subdomain": "gem"
    },
    "bookingUrl": "https://gem.cps.golf/onlineresweb"
  },
  {
    "id": "braemar",
    "name": "Braemar",
    "city": "Edina",
    "platform": "foreup",
    "platformConfig": {
      "facilityId": "21445",
      "scheduleId": "7829"
    },
    "bookingUrl": "https://foreupsoftware.com/index.php/booking/21445/7829"
  },
  {
    "id": "bunker-hills",
    "name": "Bunker Hills",
    "city": "Coon Rapids",
    "platform": "foreup",
    "platformConfig": {
      "facilityId": "20252"
    },
    "bookingUrl": "https://foreupsoftware.com/index.php/booking/20252"
  },
  {
    "id": "roseville-cedarholm",
    "name": "Roseville Cedarholm",
    "city": "Roseville",
    "platform": "foreup",
    "platformConfig": {
      "facilityId": "22244",
      "scheduleId": "10216"
    },
    "bookingUrl": "https://foreupsoftware.com/index.php/booking/22244/10216"
  },
]
```

> **Note on incomplete config:** Most courses won't return data yet — adapters skip courses with missing required config:
>
> - **CPS Golf:** Only Theodore Wirth has `apiKey`, `courseIds`, `websiteId` populated. The other 12 CPS courses need these values discovered via `GetAllOptions` or by intercepting API calls during the spring verification sprint (same technique used for T. Wirth in `dev/research/booking-platform-investigation.md`). The `siteId` and `terminalId` headers are also per-facility and discoverable the same way.
> - **ForeUp:** Bunker Hills is missing `scheduleId` (the ForeUp API's course identifier). The booking page at facility 20252 uses a default schedule — visit the page and inspect network requests to find the `schedule_id`. Braemar (7829) and Roseville Cedarholm (10216) have complete config.
>
> **Courses that can actually poll at launch:** Theodore Wirth (CPS), Braemar (ForeUp), Roseville Cedarholm (ForeUp) — 3 of 16. The rest are present in the catalog and will start polling once their config is completed.

**Step 2: Write the seed script**

Create `scripts/seed.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Seed script for D1. Run with:
 *   npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql
 *
 * This script generates the SQL file from courses.json.
 * Run: npx tsx scripts/seed.ts
 */

interface CourseEntry {
  id: string;
  name: string;
  city: string;
  platform: string;
  platformConfig: Record<string, string>;
  bookingUrl: string;
}

const coursesPath = resolve(__dirname, "../src/config/courses.json");
const courses: CourseEntry[] = JSON.parse(readFileSync(coursesPath, "utf-8"));

const lines: string[] = [
  "-- Auto-generated by scripts/seed.ts — do not edit manually",
  "DELETE FROM tee_times;",
  "DELETE FROM poll_log;", // poll_log has a date column now
  "DELETE FROM courses;",
  "",
];

for (const course of courses) {
  const esc = (s: string) => s.replace(/'/g, "''");
  lines.push(
    `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active) VALUES ('${esc(course.id)}', '${esc(course.name)}', '${esc(course.city)}', '${esc(course.platform)}', '${esc(JSON.stringify(course.platformConfig))}', '${esc(course.bookingUrl)}', 1);`
  );
}

const outputPath = resolve(__dirname, "seed.sql");
writeFileSync(outputPath, lines.join("\n") + "\n");
console.log(`Wrote ${courses.length} courses to ${outputPath}`);
```

**Step 3: Install tsx for running TypeScript scripts**

```bash
npm install -D tsx
```

Add to `package.json` scripts:

```json
"seed:generate": "npx tsx scripts/seed.ts",
"seed:local": "npx tsx scripts/seed.ts && npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql"
```

**Step 4: Run the seed**

```bash
npm run seed:local
```

Expected: "Wrote 16 courses to scripts/seed.sql", then wrangler applies it.

**Step 5: Verify seed data**

```bash
npx wrangler d1 execute tee-times-db --local --command "SELECT id, name, platform FROM courses ORDER BY platform, name"
```

Expected: 16 rows — 13 `cps_golf` + 3 `foreup`.

**Step 6: Commit**

```bash
git add src/config/courses.json scripts/ package.json package-lock.json
git commit -m "feat: add course catalog config and D1 seed script"
```

---

## Task 5: CPS Golf Adapter (TDD)

**Files:**
- Create: `src/adapters/cps-golf.ts`, `src/adapters/cps-golf.test.ts`, `src/test/fixtures/cps-golf-tee-times.json`

**Step 1: Record a CPS Golf API fixture**

Create `src/test/fixtures/cps-golf-tee-times.json`. This is a representative response based on the API format documented in `dev/research/booking-platform-investigation.md`. Since courses are closed in March, use this synthetic fixture matching the known response shape:

```json
{
  "TeeTimes": [
    {
      "TeeTimeId": 1001,
      "TeeDateTime": "2026-04-15T07:00:00",
      "GreenFee": 42.00,
      "NumberOfOpenSlots": 4,
      "Holes": 18,
      "CourseId": 17,
      "CourseName": "Championship 18"
    },
    {
      "TeeTimeId": 1002,
      "TeeDateTime": "2026-04-15T07:10:00",
      "GreenFee": 42.00,
      "NumberOfOpenSlots": 2,
      "Holes": 18,
      "CourseId": 17,
      "CourseName": "Championship 18"
    },
    {
      "TeeTimeId": 1003,
      "TeeDateTime": "2026-04-15T14:30:00",
      "GreenFee": 30.00,
      "NumberOfOpenSlots": 4,
      "Holes": 9,
      "CourseId": 17,
      "CourseName": "Championship 18"
    }
  ]
}
```

> **Important:** This fixture format is based on our research but MUST be verified against live API responses. The field names and nesting shown here are best guesses — the actual response structure was not captured during winter research because no MN tee times were available. See `dev/research/booking-platform-investigation.md` for the raw API details. The `searchDate` format and required headers are confirmed.
>
> **San Diego test courses:** Use Encinitas Ranch (`jcgsc5.cps.golf`) for live CPS Golf testing while MN courses are closed. Discover its API key via `GetAllOptions`, hit the TeeTimes endpoint, and record the real response as the fixture. See `dev/research/sd-test-courses.md`.

**Step 2: Write the failing tests**

Create `src/adapters/cps-golf.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CpsGolfAdapter } from "./cps-golf";
import type { CourseConfig } from "@/types";
import fixture from "@/test/fixtures/cps-golf-tee-times.json";

const mockConfig: CourseConfig = {
  id: "theodore-wirth-18",
  name: "Theodore Wirth",
  platform: "cps_golf",
  platformConfig: {
    subdomain: "minneapolistheodorewirth",
    apiKey: "8ea2914e-cac2-48a7-a3e5-e0f41350bf3a",
    courseIds: "17",
    websiteId: "8265e495-5c83-44e5-93d8-c9e3f3a40529",
  },
  bookingUrl: "https://minneapolistheodorewirth.cps.golf/onlineresweb",
};

describe("CpsGolfAdapter", () => {
  const adapter = new CpsGolfAdapter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct platformId", () => {
    expect(adapter.platformId).toBe("cps_golf");
  });

  it("parses tee times from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      courseId: "theodore-wirth-18",
      time: "2026-04-15T07:00:00",
      price: 42.0,
      holes: 18,
      openSlots: 4,
      bookingUrl: "https://minneapolistheodorewirth.cps.golf/onlineresweb",
    });
  });

  it("builds the correct API URL and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ TeeTimes: [] }), { status: 200 })
    );

    await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("minneapolistheodorewirth.cps.golf");
    expect(url).toContain("courseIds=17");
    // CPS Golf expects "Wed Apr 15 2026" format (no commas)
    expect(url).toMatch(/searchDate=\w{3}\+\w{3}\+\d{2}\+\d{4}/);
    expect(url).not.toContain("%2C"); // no URL-encoded commas
    const headers = options?.headers as Record<string, string>;
    expect(headers["x-apikey"]).toBe(
      "8ea2914e-cac2-48a7-a3e5-e0f41350bf3a"
    );
    expect(headers["x-timezone-offset"]).toBe("300");
    expect(headers["x-timezoneid"]).toBe("America/Chicago");
  });

  it("returns empty array on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });

  it("handles 9-hole tee times", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    const nineHole = results.find((t) => t.holes === 9);
    expect(nineHole).toBeDefined();
    expect(nineHole!.price).toBe(30.0);
  });

  it("skips courses with missing apiKey", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { subdomain: "minneapolisgrossnational" },
    };

    const results = await adapter.fetchTeeTimes(incompleteConfig, "2026-04-15");
    expect(results).toEqual([]);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- src/adapters/cps-golf.test.ts
```

Expected: FAIL — `Cannot find module './cps-golf'`

**Step 4: Implement the CPS Golf adapter**

Create `src/adapters/cps-golf.ts`:

```typescript
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface CpsTeeTimes {
  TeeTimes: Array<{
    TeeTimeId: number;
    TeeDateTime: string;
    GreenFee: number;
    NumberOfOpenSlots: number;
    Holes: number;
    CourseId: number;
    CourseName: string;
  }>;
}

export class CpsGolfAdapter implements PlatformAdapter {
  readonly platformId = "cps_golf";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
    const { subdomain, apiKey, websiteId, siteId, terminalId, courseIds } =
      config.platformConfig;

    if (!apiKey) {
      return [];
    }

    const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;

    // CPS Golf uses JS Date toString format: "Wed Apr 15 2026"
    const searchDate = this.formatCpsDate(date);

    const params = new URLSearchParams({
      searchDate,
      courseIds: courseIds ?? "",
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

    const url = `${baseUrl}/TeeTimes?${params}`;

    try {
      const response = await fetch(url, {
        headers: {
          "x-apikey": apiKey,
          "client-id": "onlineresweb",
          ...(websiteId && { "x-websiteid": websiteId }),
          ...(siteId && { "x-siteid": siteId }),
          ...(terminalId && { "x-terminalid": terminalId }),
          "x-componentid": "1",
          "x-moduleid": "7",
          "x-productid": "1",
          "x-ismobile": "false",
          "x-timezone-offset": "300",
          "x-timezoneid": "America/Chicago",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data: CpsTeeTimes = await response.json();

      return (data.TeeTimes ?? []).map((tt) => ({
        courseId: config.id,
        time: tt.TeeDateTime,
        price: tt.GreenFee ?? null,
        holes: tt.Holes === 9 ? 9 : 18,
        openSlots: tt.NumberOfOpenSlots,
        bookingUrl: config.bookingUrl,
      }));
    } catch {
      return [];
    }
  }

  /** Convert "2026-04-15" → "Wed Apr 15 2026" (CPS Golf's expected format) */
  private formatCpsDate(isoDate: string): string {
    const d = new Date(isoDate + "T12:00:00Z"); // noon UTC to avoid timezone issues
    // toLocaleDateString adds commas ("Wed, Apr 15, 2026") but CPS expects
    // the Date.toDateString() format without commas ("Wed Apr 15 2026")
    return d
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: "America/Chicago",
      })
      .replace(/,/g, "");
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- src/adapters/cps-golf.test.ts
```

Expected: All 7 tests PASS.

**Step 6: Commit**

```bash
git add src/adapters/cps-golf.ts src/adapters/cps-golf.test.ts src/test/fixtures/cps-golf-tee-times.json
git commit -m "feat: add CPS Golf adapter with tests"
```

---

## Task 6: ForeUp Adapter (TDD)

**Files:**
- Create: `src/adapters/foreup.ts`, `src/adapters/foreup.test.ts`, `src/test/fixtures/foreup-tee-times.json`

**Step 1: Record a ForeUp API fixture**

Create `src/test/fixtures/foreup-tee-times.json`. Based on the API documented in `dev/research/booking-platform-investigation.md`:

```json
[
  {
    "time": "2026-04-15 07:00",
    "available_spots": 4,
    "green_fee": "45.00",
    "holes": 18,
    "schedule_id": 7829
  },
  {
    "time": "2026-04-15 07:12",
    "available_spots": 3,
    "green_fee": "45.00",
    "holes": 18,
    "schedule_id": 7829
  },
  {
    "time": "2026-04-15 15:00",
    "available_spots": 4,
    "green_fee": "29.00",
    "holes": 9,
    "schedule_id": 7829
  }
]
```

> **Important:** This fixture format must be verified against live API responses. **San Diego test courses:** Use Balboa Park (facility 19348, schedule 1470) or Goat Hill (facility 20906, schedule 6161) for live ForeUp testing while MN courses are closed. See `dev/research/sd-test-courses.md`.

**Step 2: Write the failing tests**

Create `src/adapters/foreup.test.ts`:

```typescript
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
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- src/adapters/foreup.test.ts
```

Expected: FAIL — `Cannot find module './foreup'`

**Step 4: Implement the ForeUp adapter**

Create `src/adapters/foreup.ts`:

```typescript
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface ForeUpTeeTime {
  time: string; // "YYYY-MM-DD HH:MM"
  available_spots: number;
  green_fee: string | null;
  holes: number;
  schedule_id: number;
}

export class ForeUpAdapter implements PlatformAdapter {
  readonly platformId = "foreup";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
    const { scheduleId } = config.platformConfig;

    if (!scheduleId) {
      return [];
    }

    const params = new URLSearchParams({
      date,
      time: "all",
      holes: "0",
      players: "0",
      booking_class: "default",
      specials_only: "0",
      schedule_id: scheduleId,
      api_key: "no_limits",
    });

    const url = `https://foreupsoftware.com/index.php/api/booking/times?${params}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return [];
      }

      const data: ForeUpTeeTime[] = await response.json();

      return data.map((tt) => ({
        courseId: config.id,
        time: this.toIso(tt.time),
        price: tt.green_fee !== null ? parseFloat(tt.green_fee) : null,
        holes: tt.holes === 9 ? 9 : 18,
        openSlots: tt.available_spots,
        bookingUrl: config.bookingUrl,
      }));
    } catch {
      return [];
    }
  }

  /** Convert "YYYY-MM-DD HH:MM" → "YYYY-MM-DDTHH:MM:00" */
  private toIso(timeStr: string): string {
    return timeStr.replace(" ", "T") + ":00";
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- src/adapters/foreup.test.ts
```

Expected: All 7 tests PASS.

**Step 6: Commit**

```bash
git add src/adapters/foreup.ts src/adapters/foreup.test.ts src/test/fixtures/foreup-tee-times.json
git commit -m "feat: add ForeUp adapter with tests"
```

---

## Task 7: Adapter Registry

**Files:**
- Create: `src/adapters/index.ts`

**Step 1: Create the adapter registry**

Create `src/adapters/index.ts`:

```typescript
import type { PlatformAdapter } from "@/types";
import { CpsGolfAdapter } from "./cps-golf";
import { ForeUpAdapter } from "./foreup";

const adapters: PlatformAdapter[] = [
  new CpsGolfAdapter(),
  new ForeUpAdapter(),
];

const adapterMap = new Map(adapters.map((a) => [a.platformId, a]));

export function getAdapter(platformId: string): PlatformAdapter | undefined {
  return adapterMap.get(platformId);
}
```

**Step 2: Commit**

```bash
git add src/adapters/index.ts
git commit -m "feat: add adapter registry"
```

---

## Task 8: D1 Database Helper

**Files:**
- Create: `src/lib/db.ts`

This module provides typed helper functions for D1 operations used by the polling service and API routes.

**Step 1: Write the database helper**

Create `src/lib/db.ts`:

```typescript
import type { TeeTime } from "@/types";

// D1Database, D1PreparedStatement, etc. are global types from
// @cloudflare/workers-types (included by the Cloudflare scaffold in tsconfig).
// No import needed — they're ambient.

/**
 * Replace all tee times for a course+date in a single transaction.
 * DELETEs existing rows, INSERTs fresh results.
 */
export async function upsertTeeTimes(
  db: D1Database,
  courseId: string,
  date: string,
  teeTimes: TeeTime[],
  fetchedAt: string
): Promise<void> {
  const deleteStmt = db
    .prepare("DELETE FROM tee_times WHERE course_id = ? AND date = ?")
    .bind(courseId, date);

  const insertStmts = teeTimes.map((tt) => {
    const timeOnly = tt.time.includes("T")
      ? tt.time.split("T")[1].substring(0, 5)
      : tt.time;
    return db
      .prepare(
        `INSERT INTO tee_times (course_id, date, time, price, holes, open_slots, booking_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        courseId,
        date,
        timeOnly,
        tt.price,
        tt.holes,
        tt.openSlots,
        tt.bookingUrl,
        fetchedAt
      );
  });

  await db.batch([deleteStmt, ...insertStmts]);
}

/**
 * Log a poll attempt for debugging and freshness display.
 */
export async function logPoll(
  db: D1Database,
  courseId: string,
  date: string,
  status: "success" | "error" | "no_data",
  teeTimeCount: number,
  errorMessage?: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(courseId, date, new Date().toISOString(), status, teeTimeCount, errorMessage ?? null)
    .run();
}
```

**Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add D1 database helper for tee time upsert and poll logging"
```

---

## Task 9: Polling Service (TDD)

**Files:**
- Create: `src/lib/poller.ts`, `src/lib/poller.test.ts`

**Step 1: Write the failing tests**

Create `src/lib/poller.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollCourse, shouldPollDate, getPollingDates } from "./poller";

// Mock the adapter registry
vi.mock("@/adapters", () => ({
  getAdapter: vi.fn(),
}));

// Mock the db helpers
vi.mock("@/lib/db", () => ({
  upsertTeeTimes: vi.fn(),
  logPoll: vi.fn(),
}));

import { getAdapter } from "@/adapters";
import { upsertTeeTimes, logPoll } from "@/lib/db";

describe("shouldPollDate", () => {
  it("always polls today and tomorrow", () => {
    expect(shouldPollDate(0, 0)).toBe(true); // offset 0 = today
    expect(shouldPollDate(1, 0)).toBe(true); // offset 1 = tomorrow
  });

  it("polls days 3-4 every 30 min", () => {
    // minutesSinceLast < 30 → skip
    expect(shouldPollDate(2, 20)).toBe(false);
    // minutesSinceLast >= 30 → poll
    expect(shouldPollDate(2, 31)).toBe(true);
    expect(shouldPollDate(3, 30)).toBe(true);
  });

  it("polls days 5-7 only at 8am and 6pm", () => {
    // This is controlled by the cron caller, but the function
    // uses minutesSinceLast with a 10-hour threshold
    expect(shouldPollDate(4, 60)).toBe(false);
    expect(shouldPollDate(4, 600)).toBe(true);
    expect(shouldPollDate(6, 601)).toBe(true);
  });
});

describe("getPollingDates", () => {
  it("returns 7 dates starting from today", () => {
    const dates = getPollingDates("2026-04-15");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-04-15");
    expect(dates[6]).toBe("2026-04-21");
  });
});

describe("pollCourse", () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    }),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn(),
  };

  const mockCourse = {
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ facilityId: "21445", scheduleId: "7829" }),
    booking_url: "https://foreupsoftware.com/index.php/booking/21445/7829",
    is_active: 1,
    city: "Edina",
    last_active_check: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tee times and writes to db on success", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockResolvedValue([
        {
          courseId: "braemar",
          time: "2026-04-15T07:00:00",
          price: 45,
          holes: 18,
          openSlots: 4,
          bookingUrl: "https://foreupsoftware.com/index.php/booking/21445/7829",
        },
      ]),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(mockAdapter.fetchTeeTimes).toHaveBeenCalledOnce();
    expect(upsertTeeTimes).toHaveBeenCalledOnce();
    expect(logPoll).toHaveBeenCalledWith(
      mockDb,
      "braemar",
      "2026-04-15",
      "success",
      1,
      undefined
    );
  });

  it("logs error when adapter is not found", async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(logPoll).toHaveBeenCalledWith(
      mockDb,
      "braemar",
      "2026-04-15",
      "error",
      0,
      expect.stringContaining("No adapter")
    );
  });

  it("logs no_data when adapter returns empty array", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(logPoll).toHaveBeenCalledWith(mockDb, "braemar", "2026-04-15", "no_data", 0, undefined);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/lib/poller.test.ts
```

Expected: FAIL — `Cannot find module './poller'`

**Step 3: Implement the polling service**

Create `src/lib/poller.ts`:

```typescript
import { getAdapter } from "@/adapters";
import { upsertTeeTimes, logPoll } from "@/lib/db";
// D1Database is a global type from @cloudflare/workers-types
import type { CourseRow, CourseConfig } from "@/types";

/**
 * Determine whether a given date offset should be polled this cycle.
 * @param dayOffset 0 = today, 1 = tomorrow, etc.
 * @param minutesSinceLastPoll minutes since this course+date was last polled
 */
export function shouldPollDate(
  dayOffset: number,
  minutesSinceLastPoll: number
): boolean {
  if (dayOffset <= 1) {
    // Today + tomorrow: always poll (frequency controlled by time-of-day cron)
    return true;
  }
  if (dayOffset <= 3) {
    // Days 3-4: every 30 minutes
    return minutesSinceLastPoll >= 30;
  }
  // Days 5-7: twice daily (roughly every 10 hours)
  return minutesSinceLastPoll >= 600;
}

/**
 * Generate an array of 7 date strings starting from the given date.
 */
export function getPollingDates(todayStr: string): string[] {
  const dates: string[] = [];
  const [year, month, day] = todayStr.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(year, month - 1, day + i));
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

/**
 * Poll a single course for a single date.
 */
export async function pollCourse(
  db: D1Database,
  course: CourseRow,
  date: string
): Promise<void> {
  const adapter = getAdapter(course.platform);

  if (!adapter) {
    await logPoll(db, course.id, date, "error", 0, `No adapter for platform: ${course.platform}`);
    return;
  }

  const config: CourseConfig = {
    id: course.id,
    name: course.name,
    platform: course.platform,
    platformConfig: JSON.parse(course.platform_config),
    bookingUrl: course.booking_url,
  };

  try {
    const teeTimes = await adapter.fetchTeeTimes(config, date);

    if (teeTimes.length === 0) {
      await logPoll(db, course.id, date, "no_data", 0, undefined);
      return;
    }

    const now = new Date().toISOString();
    await upsertTeeTimes(db, course.id, date, teeTimes, now);
    await logPoll(db, course.id, date, "success", teeTimes.length, undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logPoll(db, course.id, date, "error", 0, message);
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/lib/poller.test.ts
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/lib/poller.ts src/lib/poller.test.ts
git commit -m "feat: add polling service with date-tiered frequency"
```

---

## Task 10: API Route — GET /api/tee-times

**Files:**
- Create: `src/app/api/tee-times/route.ts`

This is the primary API endpoint for the frontend. Returns tee times for given date + optional filters.

**Step 1: Implement the route handler**

Create `src/app/api/tee-times/route.ts`:

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date parameter required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // Optional filters
  const courseIds = searchParams.get("courses")?.split(",").filter(Boolean);
  const startTime = searchParams.get("startTime"); // HH:MM
  const endTime = searchParams.get("endTime"); // HH:MM
  const holes = searchParams.get("holes"); // "9" or "18"
  const minSlots = searchParams.get("minSlots"); // minimum open slots

  let query = `
    SELECT t.*, c.name as course_name, c.city as course_city
    FROM tee_times t
    JOIN courses c ON t.course_id = c.id
    WHERE t.date = ?
  `;
  const bindings: unknown[] = [date];

  if (courseIds && courseIds.length > 0) {
    const placeholders = courseIds.map(() => "?").join(",");
    query += ` AND t.course_id IN (${placeholders})`;
    bindings.push(...courseIds);
  }

  if (startTime) {
    query += " AND t.time >= ?";
    bindings.push(startTime);
  }

  if (endTime) {
    query += " AND t.time <= ?";
    bindings.push(endTime);
  }

  if (holes === "9" || holes === "18") {
    query += " AND t.holes = ?";
    bindings.push(parseInt(holes));
  }

  if (minSlots) {
    query += " AND t.open_slots >= ?";
    bindings.push(parseInt(minSlots));
  }

  query += " ORDER BY t.time ASC";

  const result = await db.prepare(query).bind(...bindings).all();

  return NextResponse.json({
    date,
    teeTimes: result.results,
  });
}
```

**Step 2: Commit**

```bash
git add src/app/api/tee-times/route.ts
git commit -m "feat: add GET /api/tee-times endpoint with filtering"
```

---

## Task 11: API Route — GET /api/courses

**Files:**
- Create: `src/app/api/courses/route.ts`

**Step 1: Implement the route handler**

Create `src/app/api/courses/route.ts`:

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  const result = await db
    .prepare(
      `SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
              p.polled_at as last_polled,
              p.status as last_poll_status
       FROM courses c
       LEFT JOIN (
         SELECT course_id, polled_at, status,
                ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
         FROM poll_log
       ) p ON c.id = p.course_id AND p.rn = 1
       ORDER BY c.name`
    )
    .all();

  return NextResponse.json({ courses: result.results });
}
```

**Step 2: Add single-course endpoint**

Create `src/app/api/courses/[id]/route.ts`:

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { env } = await getCloudflareContext();
  const db = env.DB;

  const course = await db
    .prepare(
      `SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
              p.polled_at as last_polled,
              p.status as last_poll_status
       FROM courses c
       LEFT JOIN (
         SELECT course_id, polled_at, status,
                ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
         FROM poll_log
       ) p ON c.id = p.course_id AND p.rn = 1
       WHERE c.id = ?`
    )
    .bind(id)
    .first();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  return NextResponse.json({ course });
}
```

**Step 3: Commit**

```bash
git add src/app/api/courses/
git commit -m "feat: add GET /api/courses and GET /api/courses/[id] endpoints"
```

---

## Task 12: API Route — POST /api/courses/[id]/refresh

**Files:**
- Create: `src/app/api/courses/[id]/refresh/route.ts`

The manual refresh endpoint. Fetches fresh tee times for a single course for today's date and writes to D1.

**Step 1: Implement the route handler**

Create `src/app/api/courses/[id]/refresh/route.ts`:

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { pollCourse } from "@/lib/poller";
import type { CourseRow } from "@/types";

export const runtime = "edge";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { env } = await getCloudflareContext();
  const db = env.DB;

  // Look up the course
  const course = await db
    .prepare("SELECT * FROM courses WHERE id = ?")
    .bind(id)
    .first<CourseRow>();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // Get date from query param or default to today
  const { searchParams } = new URL(request.url);
  const date =
    searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  // Check for recent poll (30-second cache to prevent duplicate upstream calls)
  const recentPoll = await db
    .prepare(
      `SELECT polled_at FROM poll_log
       WHERE course_id = ? AND date = ? AND polled_at > datetime('now', '-30 seconds')
       ORDER BY polled_at DESC LIMIT 1`
    )
    .bind(id, date)
    .first<{ polled_at: string }>();

  if (recentPoll) {
    return NextResponse.json({
      message: "Recently refreshed",
      lastPolled: recentPoll.polled_at,
    });
  }

  await pollCourse(db, course, date);

  return NextResponse.json({ message: "Refreshed", courseId: id, date });
}
```

**Step 2: Commit**

```bash
git add src/app/api/courses/
git commit -m "feat: add POST /api/courses/[id]/refresh for manual refresh"
```

---

## Task 13: Cron Polling Handler

**Files:**
- Create: `src/lib/cron-handler.ts`, `src/lib/cron-handler.test.ts`
- Modify: `worker.ts` (custom Worker entry point)

Cloudflare Cron Triggers invoke the Worker's `scheduled()` event handler — NOT an HTTP endpoint. We create a custom Worker entry point that wraps the OpenNext handler for HTTP requests and adds a `scheduled` handler for cron polling.

**Step 1: Write the cron handler logic (testable, framework-agnostic)**

Create `src/lib/cron-handler.ts`:

```typescript
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
// D1Database is a global type from @cloudflare/workers-types
import type { CourseRow } from "@/types";

/**
 * Determine whether this 5-minute cron invocation should actually poll,
 * based on current Central Time hour.
 *
 * Cron fires every 5 min. Effective intervals:
 * - 5am–10am CT: every 5 min (every invocation)
 * - 10am–2pm CT: every 10 min
 * - 2pm–8pm CT: every 15 min
 * - 8pm–5am CT: every 60 min
 */
export function shouldRunThisCycle(now: Date): boolean {
  const centralHour = parseInt(
    now.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    })
  );
  const minute = now.getMinutes();

  if (centralHour >= 5 && centralHour < 10) return true;
  if (centralHour >= 10 && centralHour < 14) return minute % 10 < 5;
  if (centralHour >= 14 && centralHour < 20) return minute % 15 < 5;
  return minute < 5; // 8pm–5am: once per hour
}

/**
 * Sleep helper for rate limiting between API calls.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main cron polling logic. Called by the Worker's scheduled() handler.
 */
export async function runCronPoll(db: D1Database): Promise<{
  pollCount: number;
  courseCount: number;
  skipped: boolean;
}> {
  const now = new Date();

  if (!shouldRunThisCycle(now)) {
    return { pollCount: 0, courseCount: 0, skipped: true };
  }

  const coursesResult = await db
    .prepare("SELECT * FROM courses WHERE is_active = 1")
    .all<CourseRow>();
  const courses = coursesResult.results;

  const todayStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  }); // YYYY-MM-DD
  const dates = getPollingDates(todayStr);

  // Batch-fetch the most recent poll time for every course+date combo (one query)
  const recentPolls = await db
    .prepare(
      `SELECT course_id, date, MAX(polled_at) as last_polled
       FROM poll_log
       WHERE polled_at > datetime('now', '-24 hours')
       GROUP BY course_id, date`
    )
    .all<{ course_id: string; date: string; last_polled: string }>();

  const pollTimeMap = new Map<string, string>();
  for (const row of recentPolls.results) {
    pollTimeMap.set(`${row.course_id}:${row.date}`, row.last_polled);
  }

  let pollCount = 0;

  for (const course of courses) {
    for (let i = 0; i < dates.length; i++) {
      const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
      const minutesSinceLast = lastPolled
        ? (Date.now() - new Date(lastPolled).getTime()) / 60000
        : Infinity;

      if (shouldPollDate(i, minutesSinceLast)) {
        await pollCourse(db, course, dates[i]);
        pollCount++;

        // Rate limit: CPS Golf allows 5 req/sec. 250ms between requests
        // gives ~4 req/sec with headroom. ForeUp has no known limit but
        // being polite doesn't hurt.
        await sleep(250);
      }
    }
  }

  return { pollCount, courseCount: courses.length, skipped: false };
}
```

**Step 2: Write tests for the cron handler**

Create `src/lib/cron-handler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldRunThisCycle } from "./cron-handler";

describe("shouldRunThisCycle", () => {
  function makeDate(centralHour: number, minute: number): Date {
    // Create a Date that, when formatted in America/Chicago, shows the given hour
    // Central Time is UTC-6 (CST) or UTC-5 (CDT)
    const d = new Date(`2026-04-15T${String(centralHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-05:00`);
    return d;
  }

  it("runs every invocation during 5am-10am CT", () => {
    expect(shouldRunThisCycle(makeDate(5, 0))).toBe(true);
    expect(shouldRunThisCycle(makeDate(7, 33))).toBe(true);
    expect(shouldRunThisCycle(makeDate(9, 55))).toBe(true);
  });

  it("runs every 10 min during 10am-2pm CT", () => {
    expect(shouldRunThisCycle(makeDate(10, 0))).toBe(true); // 0 % 10 < 5
    expect(shouldRunThisCycle(makeDate(11, 5))).toBe(false); // 5 % 10 = 5, not < 5
    expect(shouldRunThisCycle(makeDate(13, 20))).toBe(true); // 20 % 10 = 0 < 5
  });

  it("runs every 15 min during 2pm-8pm CT", () => {
    expect(shouldRunThisCycle(makeDate(14, 0))).toBe(true); // 0 % 15 < 5
    expect(shouldRunThisCycle(makeDate(15, 10))).toBe(false); // 10 % 15 = 10
    expect(shouldRunThisCycle(makeDate(19, 30))).toBe(true); // 30 % 15 = 0 < 5
  });

  it("runs once per hour during 8pm-5am CT", () => {
    expect(shouldRunThisCycle(makeDate(22, 0))).toBe(true); // 0 < 5
    expect(shouldRunThisCycle(makeDate(22, 5))).toBe(false); // 5 not < 5
    expect(shouldRunThisCycle(makeDate(3, 15))).toBe(false); // 15 not < 5
  });
});
```

**Step 3: Run tests**

```bash
npm test -- src/lib/cron-handler.test.ts
```

Expected: All tests PASS.

**Step 4: Create custom Worker entry point**

Create `worker.ts` at the project root:

```typescript
// Custom Cloudflare Worker entry point.
// Wraps OpenNext for HTTP requests + adds scheduled() for cron triggers.

import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { handler } from "./.open-next/server-functions/default/handler.mjs";
import { runCronPoll } from "./src/lib/cron-handler";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      return handler(request, env, ctx);
    });
  },

  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(runCronPoll(env.DB));
  },
};
```

> **Note:** The import paths (`.open-next/cloudflare/init.js`, `.open-next/server-functions/default/handler.mjs`) must match what the OpenNext build actually produces. Verify after the first `npx @opennextjs/cloudflare build` and adjust if needed.

**Step 5: Update wrangler.jsonc with cron trigger and worker entry**

Add to `wrangler.jsonc`:

```jsonc
{
  // ... existing config ...
  "main": "worker.ts",
  "triggers": {
    "crons": ["*/5 * * * *"]
  }
}
```

> **Important:** Setting `"main"` may conflict with OpenNext's default build output. This needs to be tested during the first deploy. The alternative is to use a separate Worker just for cron triggers that calls the main Worker via a service binding. If the custom entry point doesn't work with OpenNext, fall back to that approach.

**Step 6: Commit**

```bash
git add src/lib/cron-handler.ts src/lib/cron-handler.test.ts worker.ts wrangler.jsonc
git commit -m "feat: add cron polling handler with dynamic time-of-day schedule"
```

---

## Task 14: Time-First View (Frontend)

**Files:**
- Create: `src/app/page.tsx` (replace scaffold), `src/components/tee-time-list.tsx`, `src/components/date-picker.tsx`, `src/components/time-filter.tsx`, `src/lib/favorites.ts`

This is the primary UI. User picks a date + optional time window, sees all available tee times across favorited courses sorted by time.

**Step 1: Create the favorites localStorage helper**

Create `src/lib/favorites.ts`:

```typescript
const STORAGE_KEY = "tct-favorites";

export function getFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function setFavorites(courseIds: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(courseIds));
}

export function toggleFavorite(courseId: string): string[] {
  const current = getFavorites();
  const next = current.includes(courseId)
    ? current.filter((id) => id !== courseId)
    : [...current, courseId];
  setFavorites(next);
  return next;
}

export function isFavorite(courseId: string): boolean {
  return getFavorites().includes(courseId);
}
```

**Step 2: Create the date picker component**

Create `src/components/date-picker.tsx`:

```tsx
"use client";

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 6);
  const max = maxDate.toISOString().split("T")[0];

  return (
    <input
      type="date"
      value={value}
      min={today}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-gray-300 px-3 py-2 text-sm"
    />
  );
}
```

**Step 3: Create the time filter component**

Create `src/components/time-filter.tsx`:

```tsx
"use client";

interface TimeFilterProps {
  startTime: string;
  endTime: string;
  onStartChange: (time: string) => void;
  onEndChange: (time: string) => void;
}

export function TimeFilter({
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: TimeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600">From</label>
      <input
        type="time"
        value={startTime}
        onChange={(e) => onStartChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <label className="text-sm text-gray-600">to</label>
      <input
        type="time"
        value={endTime}
        onChange={(e) => onEndChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </div>
  );
}
```

**Step 4: Create the tee time list component**

Create `src/components/tee-time-list.tsx`:

```tsx
"use client";

interface TeeTimeItem {
  course_id: string;
  course_name: string;
  course_city: string;
  date: string;
  time: string;
  price: number | null;
  holes: number;
  open_slots: number;
  booking_url: string;
  fetched_at: string;
}

interface TeeTimeListProps {
  teeTimes: TeeTimeItem[];
  loading: boolean;
}

export function TeeTimeList({ teeTimes, loading }: TeeTimeListProps) {
  if (loading) {
    return <p className="py-8 text-center text-gray-500">Loading tee times...</p>;
  }

  if (teeTimes.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="text-lg font-medium">No tee times found</p>
        <p className="mt-1 text-sm">
          Try a different date, widen the time window, or add more courses to
          your favorites.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {teeTimes.map((tt, i) => (
        <div
          key={`${tt.course_id}-${tt.time}-${i}`}
          className="flex items-center justify-between py-3"
        >
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">
                {formatTime(tt.time)}
              </span>
              <span className="text-sm text-gray-600">{tt.course_name}</span>
              <span className="text-xs text-gray-400">{tt.course_city}</span>
            </div>
            <div className="mt-0.5 flex gap-3 text-xs text-gray-500">
              <span>{tt.holes} holes</span>
              <span>
                {tt.open_slots} {tt.open_slots === 1 ? "spot" : "spots"}
              </span>
              {tt.price !== null && <span>${tt.price.toFixed(2)}</span>}
            </div>
          </div>
          <a
            href={tt.booking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            Book
          </a>
        </div>
      ))}
    </div>
  );
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${m} ${ampm}`;
}
```

**Step 5: Replace the main page**

Replace `src/app/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { DatePicker } from "@/components/date-picker";
import { TimeFilter } from "@/components/time-filter";
import { TeeTimeList } from "@/components/tee-time-list";
import { getFavorites } from "@/lib/favorites";

export default function Home() {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [teeTimes, setTeeTimes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeeTimes = async () => {
      setLoading(true);
      const params = new URLSearchParams({ date });

      const favorites = getFavorites();
      if (favorites.length > 0) {
        params.set("courses", favorites.join(","));
      }
      if (startTime) params.set("startTime", startTime);
      if (endTime) params.set("endTime", endTime);

      try {
        const res = await fetch(`/api/tee-times?${params}`);
        const data = await res.json();
        setTeeTimes(data.teeTimes ?? []);
      } catch {
        setTeeTimes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTeeTimes();
  }, [date, startTime, endTime]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Twin Cities Tee Times</h1>
      <p className="mt-1 text-sm text-gray-500">
        Find available tee times across Twin Cities golf courses
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <DatePicker value={date} onChange={setDate} />
        <TimeFilter
          startTime={startTime}
          endTime={endTime}
          onStartChange={setStartTime}
          onEndChange={setEndTime}
        />
      </div>

      <div className="mt-6">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
```

**Step 6: Verify it renders locally**

```bash
npm run dev
```

Open `http://localhost:3000`. The page should render with the date picker, time filter, and an empty state message (no data in D1 yet during local dev). Stop the dev server.

**Step 7: Commit**

```bash
git add src/app/page.tsx src/components/ src/lib/favorites.ts
git commit -m "feat: add time-first view with date picker, time filter, tee time list"
```

---

## Task 15: Course Drill-Down View

**Files:**
- Create: `src/app/courses/[id]/page.tsx`, `src/components/course-header.tsx`, `src/components/refresh-button.tsx`

**Step 1: Create the refresh button component**

Create `src/components/refresh-button.tsx`:

```tsx
"use client";

import { useState } from "react";

interface RefreshButtonProps {
  courseId: string;
  date: string;
  onRefreshed: () => void;
}

export function RefreshButton({ courseId, date, onRefreshed }: RefreshButtonProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/courses/${courseId}/refresh?date=${date}`, {
        method: "POST",
      });
      onRefreshed();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {refreshing ? "Refreshing..." : "Refresh now"}
    </button>
  );
}
```

**Step 2: Create the course header component**

Create `src/components/course-header.tsx`:

```tsx
"use client";

import { toggleFavorite, isFavorite } from "@/lib/favorites";
import { useState } from "react";

interface CourseHeaderProps {
  course: {
    id: string;
    name: string;
    city: string;
    booking_url: string;
    last_polled: string | null;
  };
}

export function CourseHeader({ course }: CourseHeaderProps) {
  const [favorited, setFavorited] = useState(() => isFavorite(course.id));

  const handleToggle = () => {
    toggleFavorite(course.id);
    setFavorited(!favorited);
  };

  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold">{course.name}</h1>
        <p className="text-sm text-gray-500">{course.city}</p>
        {course.last_polled && (
          <p className="mt-1 text-xs text-gray-400">
            Last updated {timeAgo(course.last_polled)}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleToggle}
          className={`rounded border px-3 py-1 text-sm ${
            favorited
              ? "border-yellow-400 bg-yellow-50 text-yellow-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {favorited ? "Favorited" : "Add to Favorites"}
        </button>
        <a
          href={course.booking_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700"
        >
          Book online
        </a>
      </div>
    </div>
  );
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

**Step 3: Create the course drill-down page**

Create `src/app/courses/[id]/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { DatePicker } from "@/components/date-picker";
import { TeeTimeList } from "@/components/tee-time-list";
import { CourseHeader } from "@/components/course-header";
import { RefreshButton } from "@/components/refresh-button";

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [course, setCourse] = useState<any>(null);
  const [teeTimes, setTeeTimes] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, timesRes] = await Promise.all([
        fetch(`/api/courses/${id}`),
        fetch(`/api/tee-times?date=${date}&courses=${id}`),
      ]);
      const courseData = await courseRes.json();
      const timesData = await timesRes.json();

      setCourse(courseData.course ?? null);
      setTeeTimes(timesData.teeTimes ?? []);
    } catch {
      setTeeTimes([]);
    } finally {
      setLoading(false);
    }
  }, [id, date]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!course && !loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <p className="text-gray-500">Course not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {course && <CourseHeader course={course} />}

      <div className="mt-4 flex items-center gap-4">
        <DatePicker value={date} onChange={setDate} />
        {course && (
          <RefreshButton
            courseId={id}
            date={date}
            onRefreshed={fetchData}
          />
        )}
      </div>

      <div className="mt-6">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
```

**Step 4: Verify the page renders**

```bash
npm run dev
```

Navigate to `http://localhost:3000/courses/braemar`. Should see the course header and empty tee time list. Stop the dev server.

**Step 5: Commit**

```bash
git add src/app/courses/ src/components/course-header.tsx src/components/refresh-button.tsx
git commit -m "feat: add course drill-down page with refresh and favorites"
```

---

## Task 16: Navigation and Layout Polish

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `src/components/nav.tsx`

**Step 1: Create the nav component**

Create `src/components/nav.tsx`:

```tsx
import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-green-700">
          TC Tee Times
        </Link>
      </div>
    </nav>
  );
}
```

**Step 2: Update the layout**

Update `src/app/layout.tsx` to include the nav:

```tsx
import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twin Cities Tee Times",
  description:
    "Find available tee times across Twin Cities metro golf courses",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <Nav />
        {children}
      </body>
    </html>
  );
}
```

**Step 3: Add course links to tee time list**

Update `src/components/tee-time-list.tsx` — wrap the course name in a `<Link>`:

Add import at the top:
```tsx
import Link from "next/link";
```

Change the course name span to:
```tsx
<Link
  href={`/courses/${tt.course_id}`}
  className="text-sm text-gray-600 hover:text-green-700 hover:underline"
>
  {tt.course_name}
</Link>
```

**Step 4: Verify navigation works**

```bash
npm run dev
```

Verify: nav bar renders, clicking course name links to drill-down, back navigation works. Stop the dev server.

**Step 5: Commit**

```bash
git add src/app/layout.tsx src/components/nav.tsx src/components/tee-time-list.tsx
git commit -m "feat: add navigation bar and course links in tee time list"
```

---

## Task 17: GitHub Actions CI/CD Pipeline

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

Since the dev environment is Windows but the app deploys to Cloudflare Workers (Linux), CI is the primary verification environment. All tests and builds run in CI on Ubuntu.

**Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test

  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npx @opennextjs/cloudflare build
```

**Step 2: Create the deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy to Cloudflare
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npx @opennextjs/cloudflare build
      - name: Apply D1 migrations
        run: npx wrangler d1 migrations apply tee-times-db --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Step 3: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions CI and Cloudflare deploy workflows"
```

---

## Task 18: Verify via CI Push

Since the dev environment is Windows and the app targets Cloudflare Workers (Linux), verification happens through CI rather than running locally.

**Step 1: Push to dev branch and check CI**

```bash
git push origin dev
```

Go to the GitHub repo → Actions tab. All three CI jobs (Type Check, Test, Build) should pass.

**Step 2: Fix any failures**

If CI fails, read the error logs, fix locally, commit, and push again:

```bash
git add -A
git commit -m "fix: address CI failures"
git push origin dev
```

Iterate until all three jobs are green.

**Step 3: Merge to main (triggers deploy)**

Once CI passes on `dev`, create a PR from `dev` → `main` and merge. This triggers the deploy workflow. But first, the one-time Cloudflare setup must be done (see below).

---

## Manual Setup: Cloudflare Account & First Deploy

These steps are done **once** by you (Sam), before the first merge to `main`. They require a Cloudflare account and access to the GitHub repo settings.

### Step 1: Create a Cloudflare account (if you don't have one)

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with email/password
3. No paid plan needed — Workers free tier covers this project

### Step 2: Install wrangler and log in

Run in your project directory (or any terminal — wrangler stores auth globally):

```bash
npx wrangler login
```

This opens a browser window. Authorize wrangler to access your Cloudflare account. It stores credentials in `~/.wrangler/`.

### Step 3: Create the D1 database

```bash
npx wrangler d1 create tee-times-db
```

This prints something like:

```
✅ Successfully created DB 'tee-times-db'

[[d1_databases]]
binding = "DB"
database_name = "tee-times-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` value.** Open `wrangler.jsonc` and replace `"LOCAL_PLACEHOLDER"` with the real ID:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "tee-times-db",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  // ← paste here
  }
]
```

Commit this change:

```bash
git add wrangler.jsonc
git commit -m "chore: set real D1 database_id"
```

### Step 4: Apply schema and seed data to remote D1

```bash
npx wrangler d1 migrations apply tee-times-db --remote
```

Expected: "Migration 0001_initial_schema.sql applied successfully."

Then seed the courses:

```bash
npm run seed:generate
npx wrangler d1 execute tee-times-db --remote --file=scripts/seed.sql
```

Expected: 16 courses inserted.

Verify:

```bash
npx wrangler d1 execute tee-times-db --remote --command "SELECT id, name, platform FROM courses LIMIT 5"
```

### Step 5: Create a Cloudflare API token for GitHub Actions

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use the **"Edit Cloudflare Workers"** template
4. Under **Account Resources**, select your account
5. Under **Zone Resources**, select "All zones" (or the specific zone if you have a custom domain)
6. Click **Continue to summary** → **Create Token**
7. **Copy the token** (it's shown only once)

### Step 6: Get your Cloudflare Account ID

1. Go to https://dash.cloudflare.com/ → any zone → **Overview** page
2. The Account ID is in the right sidebar under "API"
3. Or run: `npx wrangler whoami` — it shows account IDs

### Step 7: Add secrets to GitHub

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add:
   - Name: `CLOUDFLARE_API_TOKEN` — Value: the token from Step 5
   - Name: `CLOUDFLARE_ACCOUNT_ID` — Value: the account ID from Step 6

### Step 8: First deploy

Merge the `dev` branch to `main` (or push directly). The deploy workflow will:
1. Run tests
2. Build with OpenNext
3. Apply any new D1 migrations
4. Deploy the Worker

Check the Actions tab for the deploy result. Once green, your app is live at:

```
https://tee-times-app.<your-subdomain>.workers.dev
```

(The exact URL is shown in the wrangler deploy output in the Actions log.)

### Step 9: Verify the live app

Visit the Workers URL. You should see:
- The "Twin Cities Tee Times" page with date picker and time filter
- An empty state (no tee times yet — cron hasn't run)
- Navigating to `/courses/braemar` shows the course page

The cron trigger (`*/5 * * * *`) starts running automatically. Within 5 minutes, it will attempt to poll the 3 courses with complete config (Theodore Wirth, Braemar, Roseville Cedarholm). Check if data appears.

### Ongoing: Adding new migrations

When future tasks add new migrations (e.g., `migrations/0002_add_column.sql`), the deploy workflow automatically applies them via `wrangler d1 migrations apply --remote` before deploying the Worker. No manual intervention needed.

---

## Phase 1 Milestone Checklist

When complete, you should have:

- [ ] Next.js App Router project with TypeScript + Tailwind
- [ ] D1 schema with courses, tee_times, poll_log tables
- [ ] 16 courses seeded (13 CPS Golf + 3 ForeUp)
- [ ] CPS Golf adapter with 7 tests
- [ ] ForeUp adapter with 7 tests
- [ ] Polling service with date-tiered frequency
- [ ] API routes: GET /api/tee-times, GET /api/courses, GET /api/courses/[id], POST /api/courses/[id]/refresh
- [ ] Time-first view (primary UI) with date picker + time filter
- [ ] Course drill-down with manual refresh
- [ ] Favorites via localStorage
- [ ] Freshness indicator ("Last updated X ago")
- [ ] GitHub Actions CI (type-check + test + build) passing
- [ ] GitHub Actions deploy workflow (test + build + migrate + deploy)
- [ ] Cloudflare account, D1 database, and GitHub secrets configured
- [ ] App live at Workers URL, cron trigger polling

**Next phase:** Phase 2 adds TeeItUp adapter (Keller + 7 others) + Eagle Club adapter (Valleywood) + Dashboard view, bringing all 11 favorites online.
