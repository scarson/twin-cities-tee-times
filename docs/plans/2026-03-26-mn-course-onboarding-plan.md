# MN Course Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Onboard ~25 MN courses, build Chronogolf and Eagle Club adapters, add nines/state support, and verify live MN data.

**Architecture:** Incremental by platform — foundation changes first, then catalog additions, then new adapters. Each adapter follows the existing pattern (implements `PlatformAdapter`, unit tests with fixtures, smoke tests against live API).

**Tech Stack:** TypeScript, Vitest, D1/SQLite migrations, Next.js API routes, Cloudflare Workers

**Design doc:** `docs/plans/2026-03-26-mn-course-onboarding-design.md`

**Scope boundaries:** Each task specifies exactly which files to create/modify. Do NOT refactor surrounding code, add docstrings to existing code, "improve" error handling beyond what's specified, or make changes outside the listed files.

**ABOUTME requirement:** Every new `.ts` or `.tsx` file MUST start with two `// ABOUTME:` comment lines explaining what the file does. See any existing source file for the pattern.

**Migration numbering:** Before creating migration files, run `ls migrations/` to verify the next available number. This plan assumes `0006` is next — if not, adjust accordingly.

---

## Task 1: Database Migrations (state + nines columns)

**Depends on:** Nothing (first task)

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

Create file `migrations/0006_add_state_and_nines.sql` with this content (verify the number by running `ls migrations/` first).

**Step 2: Update TypeScript types**

In `src/types/index.ts`, add `nines?: string` to the `TeeTime` interface. Add it after `bookingUrl`:

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

Add `state: string` to `CourseRow` after `city`:

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

Add `nines: string | null` to `TeeTimeRow` after `booking_url`:

```typescript
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
  nines: string | null;
}
```

**Step 3: Update seed script to include state**

In `scripts/seed.ts`, add `state?: string` to the `CourseEntry` interface after `city`:

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

Update the SQL generation loop. Replace the existing `lines.push(...)` call with:

```typescript
lines.push(
  `INSERT INTO courses (id, name, city, state, platform, platform_config, booking_url) VALUES ('${esc(course.id)}', '${esc(course.name)}', '${esc(course.city)}', '${esc(course.state ?? "MN")}', '${esc(course.platform)}', '${esc(JSON.stringify(course.platformConfig))}', '${esc(course.bookingUrl)}') ON CONFLICT(id) DO UPDATE SET name=excluded.name, city=excluded.city, state=excluded.state, platform=excluded.platform, platform_config=excluded.platform_config, booking_url=excluded.booking_url;`
);
```

**Step 4: Update `upsertTeeTimes` in `src/lib/db.ts`**

In the `upsertTeeTimes` function, find the `insertStmts` mapping (the `teeTimes.map(...)` block). Replace the existing INSERT prepared statement and `.bind()` call with:

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

Do NOT change anything else in `db.ts`.

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

**Depends on:** Task 1 (migration must exist before seeding state values)

**Files:**
- Modify: `src/config/courses.json` (add `"state"` to all entries)
- Modify: `src/config/areas.ts` (add new cities, reorder SD to last)
- Modify: `src/app/api/courses/route.ts` (sort by state then name)
- Modify: `src/app/api/tee-times/route.ts` (add state to SELECT/ORDER BY)
- Modify: `src/app/courses/page.tsx` (remove `?test=true` SD filter)

**Step 1: Add `"state"` to all entries in `courses.json`**

Add `"state": "MN"` to all MN courses. Add `"state": "CA"` to all SD test courses (their IDs start with `sd-`). Place the `"state"` field immediately after `"city"` in each entry.

The existing entries also have an `"index"` field — leave those as-is. Do NOT add, remove, or change any other fields.

**Step 2: Add new cities to `CITY_TO_AREA` in `src/config/areas.ts`**

Replace the entire `CITY_TO_AREA` object and `AREA_ORDER` array with:

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

export const AREA_ORDER = [
  "Minneapolis",
  "St. Paul",
  "North Metro",
  "East Metro",
  "South Metro",
  "San Diego",
];
```

Key change: San Diego moves from first to last in `AREA_ORDER`.

**Step 3: Update courses API to sort by state then name**

In `src/app/api/courses/route.ts`, change `ORDER BY c.name` to:

```sql
ORDER BY c.state ASC, c.name ASC
```

This puts MN (alphabetically before CA) first.

**Step 4: Update tee-times API to include state and sort by state**

In `src/app/api/tee-times/route.ts`:

1. Add `c.state as course_state` to the SELECT clause. The existing `t.*` already includes `nines` from the migration, so do NOT add `t.nines` separately. The SELECT should become:

```sql
SELECT t.*, c.name as course_name, c.city as course_city, c.state as course_state
```

2. Change `ORDER BY t.time ASC` to:

```sql
ORDER BY c.state ASC, t.time ASC
```

**Step 5: Update courses page — remove SD test filter**

In `src/app/courses/page.tsx`:

1. Remove the `useSearchParams` import from `"next/navigation"`
2. Remove the `Suspense` import from `"react"` (only if nothing else uses it)
3. Remove the `showTest` variable: `const showTest = searchParams.get("test") === "true";`
4. Remove the `const searchParams = useSearchParams();` line
5. Replace the filter:
   ```typescript
   // OLD:
   const visibleCourses = (courseCatalog as CatalogCourse[]).filter(
     (c) => showTest || !c.id.startsWith("sd-")
   );
   // NEW:
   const visibleCourses = courseCatalog as CatalogCourse[];
   ```
6. Simplify the default export — remove the `Suspense` wrapper since `useSearchParams` is gone:
   ```typescript
   // OLD:
   export default function CoursesPage() {
     return (
       <Suspense>
         <CourseBrowser />
       </Suspense>
     );
   }
   // NEW:
   export default function CoursesPage() {
     return <CourseBrowser />;
   }
   ```

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

**Depends on:** Task 1 (needs `nines` field on `TeeTime` type)

**Files:**
- Modify: `src/config/courses.json` (add `scheduleId` to Bunker Hills)
- Modify: `src/adapters/foreup.ts` (parse nines fields)
- Modify: `src/adapters/foreup.test.ts` (add nines test cases)
- Modify: `src/test/fixtures/foreup-tee-times.json` (add nines fields to existing data)
- Create: `src/test/fixtures/foreup-bunker-hills.json` (nines fixture)
- Modify: `src/components/tee-time-list.tsx` (display nines label)

**Step 1: Update existing ForeUp fixture and create Bunker Hills fixture**

Update `src/test/fixtures/foreup-tee-times.json` — add `teesheet_side_name` and `reround_teesheet_side_name` fields (both `null`) to each existing entry. Keep all other field values identical so existing tests continue to pass:

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

Create `src/test/fixtures/foreup-bunker-hills.json`:

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

**Step 2: Write failing tests**

Add these tests in `src/adapters/foreup.test.ts`. Add the import at the top of the file with the other imports:

```typescript
import bunkerFixture from "@/test/fixtures/foreup-bunker-hills.json";
```

Add these test cases inside the existing `describe("ForeUpAdapter", ...)` block:

```typescript
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

**Step 3: Run tests to verify they fail**

```bash
npx vitest run src/adapters/foreup.test.ts
```

Expected: FAIL — `nines` property not in output.

**Step 4: Update ForeUp adapter to parse nines**

In `src/adapters/foreup.ts`, add two optional fields to the `ForeUpTeeTime` interface:

```typescript
interface ForeUpTeeTime {
  time: string; // "YYYY-MM-DD HH:MM"
  available_spots: number;
  green_fee: string | null;
  holes: number;
  schedule_id: number;
  teesheet_side_name?: string | null;
  reround_teesheet_side_name?: string | null;
}
```

Replace the `return data.map(...)` block in `fetchTeeTimes` with:

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

**Step 5: Run tests to verify they pass**

```bash
npx vitest run src/adapters/foreup.test.ts
```

Expected: ALL tests pass (both new nines tests and all existing tests).

**Step 6: Add `scheduleId` to Bunker Hills in `courses.json`**

Find the Bunker Hills entry (id: `"bunker-hills"`) and update its `platformConfig` to:

```json
"platformConfig": {
  "facilityId": "20252",
  "scheduleId": "5010"
}
```

Do NOT change any other field on the Bunker Hills entry.

**Step 7: Update tee-time-list.tsx to display nines**

In `src/components/tee-time-list.tsx`:

1. Add `nines` to the `TeeTimeItem` interface after `fetched_at`:

```typescript
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
  nines?: string | null;
}
```

2. Find the `<span>{tt.holes} holes</span>` element and replace it with:

```tsx
<span>{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}</span>
```

Do NOT change anything else in this component.

**Step 8: Run all tests**

```bash
npm test
```

Expected: All tests pass.

**Step 9: Commit**

```
feat: add nines support for multi-nine courses (Bunker Hills)
```

---

## Task 4: TeeItUp MN Courses + Pioneer Creek

**Depends on:** Task 2 (needs `"state"` field convention established in courses.json)

**Files:**
- Modify: `src/config/courses.json` (add Keller, Inver Wood ×2, Bluff Creek, Pioneer Creek)

This task requires **live API discovery** for TeeItUp course configs.

**Scope boundary:** This task ONLY adds catalog entries. Do NOT modify any adapter code, test files, or other source files.

**Step 1: Add Keller to `courses.json`**

Config is already known from research. Add this entry (place it with other TeeItUp entries, maintaining alphabetical order within platform groups is not required — just append before the SD test courses):

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

Note: Existing entries have an `"index"` field. Omit it from new entries — it is not referenced by any code.

**Step 2: Discover TeeItUp config for Inver Wood**

Use `WebFetch` to fetch `https://inverwood-golf-course.book.teeitup.golf`. In the HTML response, look for these hidden input fields:
- `<input id="alias" value="...">`  → this is the tenant alias
- `<input id="beApiURI" value="...">` → this is the apiBase URL

Then call the facilities endpoint to discover facility IDs:
```
GET {apiBase}/facilities
Headers: x-be-alias: {alias}
```

Research says Inver Wood has 27 holes (18 + 9 executive). The facilities response should reveal whether these are separate facility IDs. If so, create TWO catalog entries:
- `"id": "inver-wood-18"` for the 18-hole course
- `"id": "inver-wood-9"` for the 9-hole executive course

If the facilities endpoint shows only ONE facility with both 9 and 18-hole options, create one entry with `"id": "inver-wood"`.

Add entries to `courses.json` with `"city": "Inver Grove Heights"`, `"state": "MN"`.

**Step 3: Discover TeeItUp config for Bluff Creek**

The research URL (`teeitup.com/golf/course.wpl?C=55317`) is an older format. Try these steps in order:

1. Fetch `https://bluff-creek-golf-course.book.teeitup.com` — if it exists, extract config from hidden inputs
2. Fetch `https://bluff-creek.book.teeitup.golf` — same approach
3. Fetch `https://www.teeitup.com/golf/course.wpl?C=55317` — check if it redirects to a newer booking page
4. If none work, try fetching `https://www.bluffcreekgolfclub.com` and look for a booking link

Extract `alias`, `apiBase`, `facilityId`. Add entry to `courses.json` with `"city": "Chaska"`, `"state": "MN"`.

If Bluff Creek cannot be discovered, add it to `courses.json` with `"is_active": 0` and leave a comment in the commit message noting discovery failed.

**Step 4: Add Pioneer Creek (CPS Golf)**

Config already discovered. Add this entry:

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

**Note:** Pioneer Creek has a **7-day advance booking limit**. The cron handler polls dates 0-7. Polls for date offset 7 may return an error ("membership only allows 7 days in advance"). This is expected behavior — the adapter will throw, `pollCourse` will log status `"error"`, and earlier dates will still work. Do NOT add special handling for this.

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

**Depends on:** Task 1 (needs `TeeTime` type with `nines` field), Task 3 (must complete before this to avoid `courses.json` conflicts)

**Files:**
- Create: `src/adapters/chronogolf.ts`
- Create: `src/adapters/chronogolf.test.ts`
- Create: `src/test/fixtures/chronogolf-tee-times.json`
- Modify: `src/adapters/index.ts` (register adapter)
- Modify: `src/config/courses.json` (add Chronogolf courses)
- Modify: `src/adapters/chronogolf.smoke.test.ts` (replace stubs with real tests)

This task requires **live API discovery**. The tee time endpoint and CSRF requirements were unverified in March (courses were closed). Courses are open now.

**Adapter requirements** (from existing adapter patterns and testing pitfalls):
- `platformId` MUST be `"chronogolf"` (matches `"platform"` field in courses.json)
- MUST use `AbortSignal.timeout(10000)` on all fetch calls
- MUST throw on HTTP errors (non-2xx responses) — do NOT return empty array for errors
- MUST throw on missing required config fields (`clubId`, `courseId`)
- Tests MUST cover: platformId, parsing, error handling (HTTP error, network error), missing config fields
- If Chronogolf blocks Cloudflare Workers IPs (HTTP 403/525), use the Lambda proxy pattern from `src/adapters/cps-golf.ts` and `src/lib/proxy-fetch.ts`

**Step 1: Discover the Chronogolf tee time API**

Use `WebFetch` to probe the API directly (do NOT try to "observe network requests" — you don't have a browser).

1. First, try the predicted tee time endpoint. Use a date 1-3 days from now (not today — tee times may be sold out):
   ```
   GET https://www.chronogolf.com/marketplace/clubs/8320/teetimes?date=YYYY-MM-DD&course_id=9602
   ```

2. If that returns an error or requires auth, fetch the booking page HTML at `https://www.chronogolf.com/club/8320` and look for:
   - API endpoint URLs in `<script>` tags or data attributes
   - CSRF token in `<meta>` tags (e.g., `<meta name="csrf-token" content="...">`)

3. If CSRF is needed, fetch the page first to get the token, then retry the tee time endpoint with `x-csrf-token` header.

4. Also fetch affiliation types to find the public booking type:
   ```
   GET https://www.chronogolf.com/marketplace/organizations/8320/affiliation_types
   ```

Document the discovered: endpoint URL, required headers, response JSON structure (field names, types).

**Step 2: Create test fixture**

Based on the discovered response format, create `src/test/fixtures/chronogolf-tee-times.json` with 3-5 representative tee time entries. Include variety: different times, prices, 18-hole and 9-hole if both exist.

**Step 3: Write failing tests**

Create `src/adapters/chronogolf.test.ts` following the pattern in `src/adapters/foreup.test.ts` (read it first for the exact pattern). Required test cases:

- `it("has the correct platformId")` — assert `adapter.platformId === "chronogolf"`
- `it("parses tee times from API response")` — assert full TeeTime shape for first result
- `it("builds the correct API URL")` — spy on fetch, assert URL contains expected params
- `it("throws on HTTP error")` — mock 500 response, assert throws
- `it("throws on network error")` — mock fetch rejection, assert throws
- `it("throws when clubId is missing")` — config with empty clubId, assert throws
- `it("returns empty array when no tee times available")` — mock empty response

**Step 4: Run tests to verify they fail**

```bash
npx vitest run src/adapters/chronogolf.test.ts
```

Expected: FAIL — adapter file doesn't exist yet.

**Step 5: Implement the adapter**

Create `src/adapters/chronogolf.ts` implementing `PlatformAdapter`. The `platformConfig` shape:

```typescript
{
  clubId: string;      // e.g., "8320"
  courseId: string;     // e.g., "9602"
  affiliationTypeId?: string;  // for public booking type
}
```

Key implementation notes:
- Use the endpoint and headers discovered in Step 1
- Use `AbortSignal.timeout(10000)` on all fetch calls
- Convert response tee times to `TeeTime[]` format
- If CSRF is required, implement a two-step flow: fetch page → extract token → fetch tee times

**Step 6: Run tests to verify they pass**

```bash
npx vitest run src/adapters/chronogolf.test.ts
```

Expected: ALL tests pass.

**Step 7: Register adapter in `src/adapters/index.ts`**

Add import and registration. The adapters array should become:

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

For each course, use `WebFetch` to find the `clubId` and `courseId`. Known:
- Baker National: clubId `8320`, courseIds `9602` (Championship 18), `9603` (Evergreen 9)

For the others, fetch each club's organization endpoint to get the clubId:
- Majestic Oaks: `GET https://www.chronogolf.com/marketplace/organizations/majestic-oaks-golf-club` (try slug in URL; if 404, fetch the club page HTML and extract the ID)
- Dwan: `GET https://www.chronogolf.com/marketplace/organizations/dwan-golf-club`
- Rush Creek: `GET https://www.chronogolf.com/marketplace/organizations/rush-creek-golf-club`
- Anoka Greenhaven: `GET https://www.chronogolf.com/marketplace/organizations/greenhaven-golf-course`

For each discovered clubId, get courses via:
```
GET https://www.chronogolf.com/marketplace/clubs/{clubId}/courses
```

And get public affiliation type via:
```
GET https://www.chronogolf.com/marketplace/organizations/{clubId}/affiliation_types
```

**Majestic Oaks special case:** 45 holes — likely multiple courses. Create separate catalog entries for each bookable course the API returns (e.g., `"majestic-oaks-gold"`, `"majestic-oaks-platinum"`).

**Step 9: Add all Chronogolf courses to `courses.json`**

Add entries for Baker National (×2), Majestic Oaks (×N), Dwan, Rush Creek, Anoka Greenhaven. All with `"state": "MN"`, `"platform": "chronogolf"`.

**Step 10: Update smoke tests**

Replace stubs in `src/adapters/chronogolf.smoke.test.ts` with real live API smoke tests. Follow the pattern in `src/adapters/foreup.smoke.test.ts` (read it first for the exact pattern). Test against Baker National (clubId 8320, courseId 9602) since it's the best-documented course.

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

**Depends on:** Task 1 (needs `TeeTime` type), Task 3 (must complete before this to avoid `courses.json` conflicts)

**If running in parallel with Task 5:** Use a separate worktree. Do NOT modify `src/adapters/index.ts` — leave adapter registration for after merge. Note this in the commit message.

**Files:**
- Create: `src/adapters/eagle-club.ts`
- Create: `src/adapters/eagle-club.test.ts`
- Create: `src/test/fixtures/eagle-club-tee-times.json`
- Modify: `src/adapters/index.ts` (register adapter — skip if parallel with Task 5)
- Modify: `src/config/courses.json` (add Valleywood)
- Modify: `src/adapters/eagle-club.smoke.test.ts` (replace stubs)

This task requires **live API discovery**.

**Adapter requirements** (same constraints as Task 5):
- `platformId` MUST be `"eagle_club"` (matches `"platform"` field in courses.json)
- MUST use `AbortSignal.timeout(10000)` on all fetch calls
- MUST throw on HTTP errors — do NOT return empty array for errors
- MUST throw on missing `dbname` in config
- Tests MUST cover: platformId, parsing, error handling, missing config

**Step 1: Discover the Eagle Club API request/response format**

Use `WebFetch` to probe the API directly (do NOT try to use a browser or "observe network requests").

Try these requests in order:

1. Get course info (to understand the API shape):
   ```
   POST https://api.eagleclubsystems.online/api/online/OnlineCourseRetrieve
   Content-Type: application/json
   Body: {"BG":{"dbname":"mnvalleywood20250115"}}
   ```

2. Get tee times:
   ```
   POST https://api.eagleclubsystems.online/api/online/OnlineAppointmentRetrieve
   Content-Type: application/json
   Body: {"BG":{"dbname":"mnvalleywood20250115"}}
   ```
   If this needs a date parameter, try adding `"Date":"2026-04-15"` to the body or as a query param.

3. Get rate info (for prices):
   ```
   POST https://api.eagleclubsystems.online/api/online/OnlineTheRestRetrieve
   Content-Type: application/json
   Body: {"BG":{"dbname":"mnvalleywood20250115"}}
   ```

Document: the exact POST body format, response structure (especially `LstAppointment` fields: what represents time, slots, holes, price).

**Step 2: Create test fixture**

Based on the discovered response format, create `src/test/fixtures/eagle-club-tee-times.json` with the actual response structure (including the `.NET`-style `BG` wrapper and `LstAppointment` array).

**Step 3: Write failing tests**

Create `src/adapters/eagle-club.test.ts` following the pattern in `src/adapters/foreup.test.ts`. Required test cases:

- `it("has the correct platformId")` — assert `adapter.platformId === "eagle_club"`
- `it("parses tee times from LstAppointment response")` — assert full TeeTime shape
- `it("throws on HTTP error")` — mock 500, assert throws
- `it("throws on network error")` — mock rejection, assert throws
- `it("throws when dbname is missing")` — config with no dbname, assert throws
- `it("returns empty array when no appointments available")` — mock response with empty `LstAppointment`

**Step 4: Run tests to verify they fail**

```bash
npx vitest run src/adapters/eagle-club.test.ts
```

**Step 5: Implement the adapter**

Create `src/adapters/eagle-club.ts` implementing `PlatformAdapter`. Use POST requests (not GET like other adapters). The `platformConfig` shape:

```typescript
{
  dbname: string;  // e.g., "mnvalleywood20250115"
}
```

**Step 6: Run tests to verify they pass**

```bash
npx vitest run src/adapters/eagle-club.test.ts
```

**Step 7: Register adapter in `src/adapters/index.ts`**

```typescript
import { EagleClubAdapter } from "./eagle-club";
```

Add `new EagleClubAdapter()` to the `adapters` array.

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

Replace stubs in `src/adapters/eagle-club.smoke.test.ts` with real live API smoke tests. Follow the pattern in `src/adapters/foreup.smoke.test.ts`.

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

**Depends on:** ALL previous tasks must be complete.

**Files:**
- Potentially modify: `src/config/courses.json` (fix any config issues found)

**Scope:** Verify that every MN course in the catalog returns tee time data from the live API. Fix config issues found. Do NOT add new features, refactor code, or make changes beyond what's needed to fix config problems.

**Step 1: Verify CPS Golf MN courses**

For each CPS Golf course, call the adapter's `fetchTeeTimes` method (or use the smoke test pattern) with a date 1-2 days from now. CPS Golf courses in catalog:

- Theodore Wirth (`minneapolistheodorewirth`)
- Gross National (`minneapolisgrossnational`)
- Meadowbrook (`minneapolismeadowbrook`)
- Columbia (`minneapoliscolumbia`)
- Hiawatha (`minneapolishiawatha`)
- Phalen (`phalen`)
- Highland National (`highlandnationalmn`)
- Como Park (`como`)
- Edinburgh USA (`edinburghusa`)
- Chaska Town Course (`chaska`)
- Pioneer Creek (`pioneercreek`) — note: 7-day advance limit, so use a date within 6 days

If any CPS course returns 401 or fails, it may need `websiteId`/`courseIds` config discovered via:
```
GET https://{subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions
Headers: Authorization: Bearer {token}, x-apikey: a]fw@rd$2o2o!
```

**Step 2: Verify ForeUp MN courses**

Test Braemar (scheduleId 7829) and Bunker Hills (scheduleId 5010). For Bunker Hills, confirm the response includes `teesheet_side_name`/`reround_teesheet_side_name` values.

**Step 3: Verify TeeItUp MN courses**

Test Keller, Inver Wood, Bluff Creek. Use the discovered configs from Task 4.

**Step 4: Verify Chronogolf courses**

Test Baker National, Majestic Oaks, Dwan, Rush Creek, Anoka Greenhaven.

**Step 5: Verify Eagle Club**

Test Valleywood.

**Step 6: Run full CI suite**

```bash
npm test && npx tsc --noEmit && npm run lint
```

**Step 7: Fix any issues discovered and commit**

Only commit if changes were needed:
```
fix: resolve course config issues found during live verification
```

---

## Parallelization Notes (for subagent-driven development)

**Sequential dependencies:**
- Task 1 → Task 2 → Task 3 (foundation chain)
- Task 4 depends on Task 2 (needs `"state"` field convention)
- Tasks 5 and 6 depend on Task 1 (need `TeeTime.nines` type) and should run after Task 4 (to avoid `courses.json` conflicts)
- Task 7 depends on ALL previous tasks

**Recommended execution order:**
1. Tasks 1, 2, 3 sequentially (foundation — ~30 min total)
2. Task 4 sequentially (catalog additions — ~15 min)
3. Tasks 5 and 6 in parallel worktrees (independent adapters — ~45 min each)
   - After both complete, merge worktrees and resolve any `courses.json` / `adapters/index.ts` conflicts
4. Task 7 sequentially (verification — ~20 min)

**If NOT using parallel worktrees:** Run Tasks 5 and 6 sequentially. Both modify `courses.json` and `adapters/index.ts`, so sequential execution avoids merge conflicts entirely.
