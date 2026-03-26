# MN Course Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Onboard ~25 MN courses, build Chronogolf and Eagle Club adapters, add nines/state support, and verify live MN data.

**Architecture:** Incremental by platform — foundation changes first, then catalog additions, then new adapters. Each adapter follows the existing pattern (implements `PlatformAdapter`, unit tests with fixtures, smoke tests against live API).

**Tech Stack:** TypeScript, Vitest, D1/SQLite migrations, Next.js API routes, Cloudflare Workers

**Design doc:** `docs/plans/2026-03-26-mn-course-onboarding-design.md`

---

## Task 1: Database Migrations (state + nines columns)

**Files:**
- Create: `migrations/0006_add_state_and_nines.sql`
- Modify: `src/types/index.ts`
- Modify: `scripts/seed.ts`
- Modify: `src/lib/db.ts`

**Step 1: Write migration SQL**

```sql
-- Add state column to courses for geographic sorting
ALTER TABLE courses ADD COLUMN state TEXT NOT NULL DEFAULT 'MN';

-- Add nines column to tee_times for multi-nine courses (e.g., Bunker Hills)
ALTER TABLE tee_times ADD COLUMN nines TEXT;
```

Create file `migrations/0006_add_state_and_nines.sql` with this content.

**Step 2: Update TypeScript types**

In `src/types/index.ts`, add `nines` to `TeeTime`:

```typescript
export interface TeeTime {
  courseId: string;
  time: string;
  price: number | null;
  holes: 9 | 18;
  openSlots: number;
  bookingUrl: string;
  nines?: string; // e.g., "East/West" for multi-nine courses
}
```

Add `state` to `CourseRow`:

```typescript
export interface CourseRow {
  id: string;
  name: string;
  city: string;
  state: string;
  platform: string;
  platform_config: string;
  booking_url: string;
  is_active: number;
  last_had_tee_times: string | null;
}
```

Add `nines` to `TeeTimeRow`:

```typescript
export interface TeeTimeRow {
  // ... existing fields ...
  nines: string | null;
}
```

**Step 3: Update seed script to include state**

In `scripts/seed.ts`, update the `CourseEntry` interface to include `state?: string`, and update the INSERT statement:

```typescript
interface CourseEntry {
  id: string;
  name: string;
  city: string;
  state?: string;
  platform: string;
  platformConfig: Record<string, string>;
  bookingUrl: string;
}
```

Update the SQL generation to include state:

```typescript
lines.push(
  `INSERT INTO courses (id, name, city, state, platform, platform_config, booking_url) VALUES ('${esc(course.id)}', '${esc(course.name)}', '${esc(course.city)}', '${esc(course.state ?? "MN")}', '${esc(course.platform)}', '${esc(JSON.stringify(course.platformConfig))}', '${esc(course.bookingUrl)}') ON CONFLICT(id) DO UPDATE SET name=excluded.name, city=excluded.city, state=excluded.state, platform=excluded.platform, platform_config=excluded.platform_config, booking_url=excluded.booking_url;`
);
```

**Step 4: Update `upsertTeeTimes` in `src/lib/db.ts`**

Add `nines` to the INSERT statement:

```typescript
return db
  .prepare(
    `INSERT INTO tee_times (course_id, date, time, price, holes, open_slots, booking_url, fetched_at, nines)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  .bind(
    courseId,
    date,
    timeOnly,
    tt.price,
    tt.holes,
    tt.openSlots,
    tt.bookingUrl,
    fetchedAt,
    tt.nines ?? null
  );
```

**Step 5: Apply migration locally and verify**

```bash
npx wrangler d1 execute tee-times-db --local --file=migrations/0006_add_state_and_nines.sql
npx wrangler d1 execute tee-times-db --local --command="PRAGMA table_info(courses)"
npx wrangler d1 execute tee-times-db --local --command="PRAGMA table_info(tee_times)"
```

Expected: `state` column on courses, `nines` column on tee_times.

**Step 6: Run tests**

```bash
npm test
```

Expected: All tests pass (type changes are additive/optional).

**Step 7: Commit**

```
feat: add state and nines columns (migration 0006)
```

---

## Task 2: State Field + Area Config + Sort Order

**Files:**
- Modify: `src/config/courses.json` (add `"state"` to all entries)
- Modify: `src/config/areas.ts` (add new cities, reorder SD to last)
- Modify: `src/app/api/courses/route.ts` (sort by state then name)
- Modify: `src/app/api/tee-times/route.ts` (add `nines` to SELECT, sort by state then time)
- Modify: `src/app/courses/page.tsx` (remove `?test=true` SD filter)

**Step 1: Add `"state"` to all entries in `courses.json`**

Add `"state": "MN"` to all MN courses. Add `"state": "CA"` to all SD test courses (ids starting with `sd-`). Place the field after `"city"`.

**Step 2: Add new cities to `CITY_TO_AREA` in `src/config/areas.ts`**

Add missing cities for the new courses:

```typescript
const CITY_TO_AREA: Record<string, string> = {
  // Core cities
  Minneapolis: "Minneapolis",
  "St. Paul": "St. Paul",

  // North Metro
  "Brooklyn Park": "North Metro",
  "Coon Rapids": "North Metro",
  Blaine: "North Metro",
  Roseville: "North Metro",
  "Ham Lake": "North Metro",
  Anoka: "North Metro",

  // East Metro
  "White Bear Lake": "East Metro",
  Stillwater: "East Metro",
  Maplewood: "East Metro",
  "Inver Grove Heights": "East Metro",

  // South Metro
  Edina: "South Metro",
  Chaska: "South Metro",
  Hopkins: "South Metro",
  "Apple Valley": "South Metro",
  Bloomington: "South Metro",
  "Golden Valley": "South Metro",
  Medina: "South Metro",
  "Maple Plain": "South Metro",
  "Maple Grove": "South Metro",

  // San Diego (test courses)
  "San Diego": "San Diego",
  Oceanside: "San Diego",
  Coronado: "San Diego",
  Encinitas: "San Diego",
  "San Marcos": "San Diego",
  "Solana Beach": "San Diego",
};
```

Move San Diego to the end of `AREA_ORDER`:

```typescript
export const AREA_ORDER = [
  "Minneapolis",
  "St. Paul",
  "North Metro",
  "East Metro",
  "South Metro",
  "San Diego",
];
```

**Step 3: Update courses API to sort by state then name**

In `src/app/api/courses/route.ts`, change `ORDER BY c.name` to:

```sql
ORDER BY c.state ASC, c.name ASC
```

This puts MN (alphabetically first) before other states.

**Step 4: Update tee-times API to include nines and sort by state**

In `src/app/api/tee-times/route.ts`, update the SELECT to include nines:

```sql
SELECT t.*, t.nines, c.name as course_name, c.city as course_city, c.state as course_state
```

And change `ORDER BY t.time ASC` to:

```sql
ORDER BY c.state ASC, t.time ASC
```

**Step 5: Update courses page — remove SD test filter**

In `src/app/courses/page.tsx`, the current filter is:

```typescript
const visibleCourses = (courseCatalog as CatalogCourse[]).filter(
  (c) => showTest || !c.id.startsWith("sd-")
);
```

Remove the `?test=true` logic entirely. All courses should be visible, with SD courses sorted last by the area grouping:

```typescript
const visibleCourses = courseCatalog as CatalogCourse[];
```

Remove the `showTest` variable and `useSearchParams` if no longer needed (check if other params are used).

**Step 6: Regenerate seed SQL and apply locally**

```bash
npx tsx scripts/seed.ts
npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql
```

**Step 7: Run tests and type-check**

```bash
npm test && npx tsc --noEmit
```

**Step 8: Commit**

```
feat: add state field to courses, sort MN before SD, show all courses
```

---

## Task 3: Bunker Hills Nines Support

**Files:**
- Modify: `src/config/courses.json` (add `scheduleId` to Bunker Hills)
- Modify: `src/adapters/foreup.ts` (parse nines fields)
- Modify: `src/adapters/foreup.test.ts` (add nines test cases)
- Modify: `src/test/fixtures/foreup-tee-times.json` (add nines fixture data)
- Modify: `src/components/tee-time-list.tsx` (display nines label)

**Step 1: Write failing test for nines parsing**

In `src/adapters/foreup.test.ts`, add a fixture and test:

First, update `src/test/fixtures/foreup-tee-times.json` — add `teesheet_side_name` and `reround_teesheet_side_name` fields to existing entries (and add a new entry for a multi-nine time):

```json
[
  {
    "time": "2026-04-15 07:00",
    "available_spots": 4,
    "green_fee": "45.00",
    "holes": 18,
    "schedule_id": 7829,
    "teesheet_side_name": null,
    "reround_teesheet_side_name": null
  },
  {
    "time": "2026-04-15 07:10",
    "available_spots": 2,
    "green_fee": "35.00",
    "holes": 9,
    "schedule_id": 7829,
    "teesheet_side_name": null,
    "reround_teesheet_side_name": null
  },
  {
    "time": "2026-04-15 07:20",
    "available_spots": 3,
    "green_fee": null,
    "holes": 18,
    "schedule_id": 7829,
    "teesheet_side_name": null,
    "reround_teesheet_side_name": null
  }
]
```

Create a second fixture `src/test/fixtures/foreup-bunker-hills.json` with nines data:

```json
[
  {
    "time": "2026-04-15 10:36",
    "available_spots": 4,
    "green_fee": "56.00",
    "holes": 18,
    "schedule_id": 5010,
    "teesheet_side_name": "East",
    "reround_teesheet_side_name": "West"
  },
  {
    "time": "2026-04-15 10:36",
    "available_spots": 4,
    "green_fee": "56.00",
    "holes": 18,
    "schedule_id": 5010,
    "teesheet_side_name": "West",
    "reround_teesheet_side_name": "North"
  },
  {
    "time": "2026-04-15 10:36",
    "available_spots": 3,
    "green_fee": "56.00",
    "holes": 18,
    "schedule_id": 5010,
    "teesheet_side_name": "North",
    "reround_teesheet_side_name": "East"
  }
]
```

Add test in `foreup.test.ts`:

```typescript
import bunkerFixture from "@/test/fixtures/foreup-bunker-hills.json";

it("parses nines from teesheet_side_name fields", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(bunkerFixture), { status: 200 })
  );

  const bunkerConfig: CourseConfig = {
    id: "bunker-hills",
    name: "Bunker Hills",
    platform: "foreup",
    platformConfig: { facilityId: "20252", scheduleId: "5010" },
    bookingUrl: "https://foreupsoftware.com/index.php/booking/20252",
  };

  const results = await adapter.fetchTeeTimes(bunkerConfig, "2026-04-15");

  expect(results).toHaveLength(3);
  expect(results[0].nines).toBe("East/West");
  expect(results[1].nines).toBe("West/North");
  expect(results[2].nines).toBe("North/East");
});

it("omits nines when teesheet_side_name is null", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(fixture), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

  expect(results[0].nines).toBeUndefined();
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/adapters/foreup.test.ts
```

Expected: FAIL — `nines` not in output.

**Step 3: Update ForeUp adapter to parse nines**

In `src/adapters/foreup.ts`, update the `ForeUpTeeTime` interface:

```typescript
interface ForeUpTeeTime {
  time: string;
  available_spots: number;
  green_fee: string | null;
  holes: number;
  schedule_id: number;
  teesheet_side_name?: string | null;
  reround_teesheet_side_name?: string | null;
}
```

Update the map in `fetchTeeTimes` to include nines:

```typescript
return data.map((tt) => {
  const nines = tt.teesheet_side_name && tt.reround_teesheet_side_name
    ? `${tt.teesheet_side_name}/${tt.reround_teesheet_side_name}`
    : undefined;

  return {
    courseId: config.id,
    time: this.toIso(tt.time),
    price: tt.green_fee !== null && !Number.isNaN(parseFloat(tt.green_fee))
      ? parseFloat(tt.green_fee)
      : null,
    holes: tt.holes === 9 ? 9 : 18,
    openSlots: tt.available_spots,
    bookingUrl: config.bookingUrl,
    ...(nines && { nines }),
  };
});
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/adapters/foreup.test.ts
```

Expected: PASS

**Step 5: Add `scheduleId` to Bunker Hills in `courses.json`**

Update the Bunker Hills entry:

```json
{
  "platformConfig": {
    "facilityId": "20252",
    "scheduleId": "5010"
  }
}
```

**Step 6: Update tee-time-list.tsx to display nines**

In `src/components/tee-time-list.tsx`, add `nines` to the `TeeTimeItem` interface:

```typescript
interface TeeTimeItem {
  // ... existing fields ...
  nines?: string | null;
}
```

In the render, display nines after holes when present:

```tsx
<span>{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}</span>
```

**Step 7: Run all tests**

```bash
npm test
```

**Step 8: Commit**

```
feat: add nines support for multi-nine courses (Bunker Hills)
```

---

## Task 4: TeeItUp MN Courses + Pioneer Creek

**Files:**
- Modify: `src/config/courses.json` (add Keller, Inver Wood ×2, Bluff Creek, Pioneer Creek)
- Modify: `src/config/areas.ts` (add any missing cities if not already added in Task 2)

This task requires **live API discovery** for TeeItUp course configs. The implementing agent must fetch each booking page to extract `alias`, `apiBase`, and `facilityId` from hidden input fields.

**Step 1: Discover TeeItUp config for Keller**

Already known from research:
- alias: `ramsey-county-golf`
- apiBase: `https://phx-api-be-east-1b.kenna.io`
- facilityId: `17055`
- bookingUrl: `https://ramsey-county-golf.book.teeitup.com/?course=17055`

Add to `courses.json`:

```json
{
  "id": "keller",
  "name": "Keller",
  "city": "Maplewood",
  "state": "MN",
  "address": "2166 Maplewood Dr, Maplewood, MN 55109",
  "platform": "teeitup",
  "platformConfig": {
    "alias": "ramsey-county-golf",
    "apiBase": "https://phx-api-be-east-1b.kenna.io",
    "facilityId": "17055"
  },
  "bookingUrl": "https://ramsey-county-golf.book.teeitup.com/?course=17055"
}
```

**Step 2: Discover TeeItUp config for Inver Wood**

Fetch the booking page at `https://inverwood-golf-course.book.teeitup.golf` and extract:
- `id="alias"` → alias
- `id="beApiURI"` → apiBase
- facility/course IDs from the page

Research says 27 holes (18 + 9 executive). May be two facility IDs on the same tenant. Check the `/facilities` endpoint with the discovered alias to find both.

Add entries to `courses.json` for both the 18-hole and 9-hole courses.

**Step 3: Discover TeeItUp config for Bluff Creek**

Research URL is older format: `teeitup.com/golf/course.wpl?C=55317`. Try navigating to find the newer booking page URL. Check if there's a `*.book.teeitup.com` or `*.book.teeitup.golf` domain. Extract config from the page.

If the older URL format doesn't have hidden config fields, try the `/facilities` endpoint approach with likely tenant names.

Add entry to `courses.json`.

**Step 4: Add Pioneer Creek (CPS Golf)**

Config already discovered:

```json
{
  "id": "pioneer-creek",
  "name": "Pioneer Creek",
  "city": "Maple Plain",
  "state": "MN",
  "address": "705 Copeland Rd, Maple Plain, MN 55359",
  "platform": "cps_golf",
  "platformConfig": {
    "subdomain": "pioneercreek",
    "websiteId": "07ecdaf7-4af5-4b9f-40c3-08dc8bc4f610",
    "courseIds": "5"
  },
  "bookingUrl": "https://pioneercreek.cps.golf/onlineresweb"
}
```

**Step 5: Regenerate seed SQL**

```bash
npx tsx scripts/seed.ts
```

**Step 6: Run tests and type-check**

```bash
npm test && npx tsc --noEmit
```

**Step 7: Commit**

```
feat: add TeeItUp MN courses (Keller, Inver Wood, Bluff Creek) and Pioneer Creek
```

---

## Task 5: Chronogolf Adapter

**Files:**
- Create: `src/adapters/chronogolf.ts`
- Create: `src/adapters/chronogolf.test.ts`
- Create: `src/test/fixtures/chronogolf-tee-times.json`
- Modify: `src/adapters/index.ts` (register adapter)
- Modify: `src/config/courses.json` (add Chronogolf courses)
- Modify: `src/adapters/chronogolf.smoke.test.ts` (replace stubs with real tests)

This task requires **live API discovery**. The tee time endpoint and CSRF requirements were unverified in March (courses were closed). Courses are open now.

**Step 1: Discover the Chronogolf tee time API**

Fetch the Baker National booking widget page at `https://www.chronogolf.com/club/8320` and observe network requests. Look for:
- The tee time endpoint URL pattern
- Whether `x-csrf-token` is required
- The response format (fields, structure)
- The `affiliation_type_id` for public/non-member bookings

Try the predicted endpoint first:
```
GET https://www.chronogolf.com/marketplace/clubs/8320/teetimes?date=YYYY-MM-DD&course_id=9602
```

If CSRF is required, fetch the widget page first to extract the token from meta tags or response headers.

Document the discovered endpoint, headers, and response format.

**Step 2: Create test fixture**

Based on the discovered response format, create `src/test/fixtures/chronogolf-tee-times.json` with representative data.

**Step 3: Write failing tests**

Create `src/adapters/chronogolf.test.ts` following the pattern in existing adapter tests:
- Test platformId
- Test tee time parsing (time, price, holes, openSlots)
- Test API URL construction
- Test error handling (HTTP errors, empty responses)
- Test with both 18-hole and 9-hole course configs

**Step 4: Run tests to verify they fail**

```bash
npx vitest run src/adapters/chronogolf.test.ts
```

**Step 5: Implement the adapter**

Create `src/adapters/chronogolf.ts` implementing `PlatformAdapter`. Follow the pattern of existing adapters. The `platformConfig` shape:

```typescript
{
  clubId: string;
  courseId: string;
  affiliationTypeId?: string;
}
```

Handle CSRF token if required (fetch widget page, extract token, pass as header).

**Step 6: Run tests to verify they pass**

```bash
npx vitest run src/adapters/chronogolf.test.ts
```

**Step 7: Register adapter in `src/adapters/index.ts`**

```typescript
import { ChronogolfAdapter } from "./chronogolf";

const adapters: PlatformAdapter[] = [
  new CpsGolfAdapter(),
  new ForeUpAdapter(),
  new TeeItUpAdapter(),
  new ChronogolfAdapter(),
];
```

**Step 8: Discover Chronogolf config for all courses**

For each course, find the `clubId` and `courseId` from the Chronogolf marketplace. Known:
- Baker National: clubId `8320`, courseIds `9602` (Championship 18), `9603` (Evergreen 9)

Discover for:
- Majestic Oaks: `chronogolf.com/club/majestic-oaks-golf-club` — **45 holes, may need multiple entries**. Use the `/marketplace/clubs/{clubId}/courses` endpoint to find all course IDs.
- Dwan: `chronogolf.com/club/dwan-golf-club`
- Rush Creek: `chronogolf.com/club/rush-creek-golf-club`
- Anoka Greenhaven: `chronogolf.com/club/greenhaven-golf-course`

For each, also discover the `affiliationTypeId` for public bookings from `/marketplace/organizations/{clubId}/affiliation_types`.

**Step 9: Add all Chronogolf courses to `courses.json`**

Add entries for Baker National (×2), Majestic Oaks (×N based on discovery), Dwan, Rush Creek, Anoka Greenhaven.

**Step 10: Update smoke tests**

Replace stubs in `src/adapters/chronogolf.smoke.test.ts` with real live API smoke tests, following the pattern of existing smoke tests (e.g., `foreup.smoke.test.ts`).

**Step 11: Regenerate seed SQL and run all tests**

```bash
npx tsx scripts/seed.ts
npm test && npx tsc --noEmit
```

**Step 12: Commit**

```
feat: add Chronogolf adapter with Baker National, Majestic Oaks, Dwan, Rush Creek, Greenhaven
```

---

## Task 6: Eagle Club Adapter

**Files:**
- Create: `src/adapters/eagle-club.ts`
- Create: `src/adapters/eagle-club.test.ts`
- Create: `src/test/fixtures/eagle-club-tee-times.json`
- Modify: `src/adapters/index.ts` (register adapter)
- Modify: `src/config/courses.json` (add Valleywood)
- Modify: `src/adapters/eagle-club.smoke.test.ts` (replace stubs)

This task requires **live API discovery**. The exact request body format for `OnlineAppointmentRetrieve` was not fully documented.

**Step 1: Discover the Eagle Club API request/response format**

Hit the Valleywood booking page at `https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115` and observe the Angular app's network requests. Specifically capture:
- The exact POST body for `OnlineAppointmentRetrieve`
- The response structure (what fields are in `LstAppointment` entries)
- How dates are passed (query param vs. body field)
- How prices are structured (from `OnlineTheRestRetrieve` if needed)

API base: `https://api.eagleclubsystems.online`

Try:
```
POST https://api.eagleclubsystems.online/api/online/OnlineAppointmentRetrieve
Content-Type: application/json
Body: { "dbname": "mnvalleywood20250115" }
```

Document the discovered request format and response structure.

**Step 2: Create test fixture**

Based on the discovered response format, create `src/test/fixtures/eagle-club-tee-times.json`.

**Step 3: Write failing tests**

Create `src/adapters/eagle-club.test.ts`:
- Test platformId
- Test tee time parsing from `LstAppointment` array
- Test price extraction
- Test error handling
- Test empty response (no appointments available)

**Step 4: Run tests to verify they fail**

```bash
npx vitest run src/adapters/eagle-club.test.ts
```

**Step 5: Implement the adapter**

Create `src/adapters/eagle-club.ts` implementing `PlatformAdapter`. The `platformConfig` shape:

```typescript
{
  dbname: string;
}
```

POST-based API — different from the GET-based adapters. Follow the research in `dev/research/remaining-platforms-investigation.md`.

**Step 6: Run tests to verify they pass**

```bash
npx vitest run src/adapters/eagle-club.test.ts
```

**Step 7: Register adapter in `src/adapters/index.ts`**

```typescript
import { EagleClubAdapter } from "./eagle-club";
// ... add to adapters array
```

**Step 8: Add Valleywood to `courses.json`**

```json
{
  "id": "valleywood",
  "name": "Valleywood",
  "city": "Apple Valley",
  "state": "MN",
  "address": "4851 McAndrews Rd, Apple Valley, MN 55124",
  "platform": "eagle_club",
  "platformConfig": {
    "dbname": "mnvalleywood20250115"
  },
  "bookingUrl": "https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115"
}
```

**Step 9: Update smoke tests**

Replace stubs in `src/adapters/eagle-club.smoke.test.ts` with real live API smoke tests.

**Step 10: Regenerate seed SQL and run all tests**

```bash
npx tsx scripts/seed.ts
npm test && npx tsc --noEmit
```

**Step 11: Commit**

```
feat: add Eagle Club adapter with Valleywood course
```

---

## Task 7: Live Verification of All MN Courses

**Files:**
- Potentially modify: `src/config/courses.json` (fix any config issues found)

**Step 1: Verify existing CPS Golf MN courses return data**

Run smoke tests or manual API calls against each CPS Golf MN course to confirm they return tee times now that courses are opening. Test at least:
- Theodore Wirth, Columbia, Gross National (confirmed open March 25-26)
- Meadowbrook (opening March 29)
- Phalen, Highland National, Como Park
- Edinburgh USA, Chaska Town Course
- Pioneer Creek (7-day advance limit noted)

If any CPS courses need `websiteId`/`courseIds` config that we don't have, discover via `GetAllOptions` endpoint and update `courses.json`.

**Step 2: Verify ForeUp MN courses**

Test Braemar and Bunker Hills (with new scheduleId). Confirm nines data appears correctly for Bunker Hills.

**Step 3: Verify new TeeItUp courses**

Test Keller, Inver Wood, Bluff Creek against live API.

**Step 4: Verify new Chronogolf courses**

Test Baker National, Majestic Oaks, Dwan, Rush Creek, Anoka Greenhaven.

**Step 5: Verify Eagle Club**

Test Valleywood.

**Step 6: Fix any issues discovered and commit**

```
fix: resolve course config issues found during live verification
```

---

## Parallelization Notes (for subagent-driven development)

**Sequential dependencies:**
- Task 1 → Task 2 → Task 3 (foundation, then state/areas, then nines)
- Task 1 must complete before Tasks 5 and 6 (type changes needed)

**Parallelizable after Task 3:**
- **Task 4** (TeeItUp + Pioneer Creek catalog) — independent research + JSON edits
- **Task 5** (Chronogolf adapter) and **Task 6** (Eagle Club adapter) — independent adapters, but both modify `courses.json` and `adapters/index.ts`, so merge carefully if parallel

**Recommended execution:**
1. Tasks 1-3 sequentially (foundation)
2. Task 4 (catalog additions — quick)
3. Tasks 5 and 6 in parallel (independent adapters, use worktrees)
4. Task 7 after all others complete (verification)
