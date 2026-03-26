# Remaining Courses Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Onboard 3 deferred courses (Brookview, Inver Wood, Ft. Snelling), add `display_notes` column for course-specific messages, and build TeeWire adapter.

**Architecture:** Brookview uses our existing CPS Golf adapter with a V4 auth flow fix. Inver Wood requires a new TeeWire adapter. Ft. Snelling is catalog-only with a display note (GolfNow API is not usable). The `display_notes` column stores user-facing messages shown on course detail pages.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers, D1/SQLite

**Research docs:**
- `dev/research/remaining-platforms-investigation.md` — Brookview/GolfNow sections
- `dev/research/teewire-platform-investigation.md` — full TeeWire API details

**Scope:** Do NOT modify any existing adapter's behavior for currently-working courses. Do NOT add features beyond what's specified. Every new `.ts`/`.tsx` file MUST start with two `// ABOUTME:` comment lines. New course entries MUST include a unique `"index"` field (check current max with `grep '"index"' src/config/courses.json | sort -t: -k2 -n | tail -1` before adding).

---

## Task 1: Add `display_notes` Column + Course Detail UI

**BEFORE starting work:**
1. Read `dev/testing-pitfalls-coverage-review.md`
2. Read `src/app/api/courses/[id]/route.ts` — the course detail API
3. Read `src/app/courses/[id]/page.tsx` — the course detail page
4. Read `src/types/index.ts` — the `CourseRow` type
5. Read `scripts/seed.ts` — the current seed script INSERT template
6. Read `src/test/d1-test-helper.ts` — the `seedCourse` helper
7. Follow TDD where applicable

**Depends on:** Nothing (first task)

**Files:**
- Create: `migrations/0008_add_display_notes.sql` (verify number with `ls migrations/`)
- Modify: `src/types/index.ts`
- Modify: `scripts/seed.ts`
- Modify: `src/test/d1-test-helper.ts`
- Modify: `src/app/api/courses/[id]/route.ts`
- Modify: `src/app/courses/[id]/page.tsx`
- Modify: `src/app/courses/page.tsx` (show disabled courses that have displayNotes)
- Modify: `src/app/courses/page.test.tsx` (add test for disabled-with-notes visibility)
- Modify: `src/lib/cron-handler.test.ts` (add `display_notes: null` to `makeCourseRow`)
- Modify: `src/lib/batch.test.ts` (add `display_notes: null` to `makeCourse`)
- Modify: `src/lib/poller.test.ts` (add `display_notes: null` to `mockCourse`)
- Modify: `src/lib/poller.integration.test.ts` (add `display_notes: null` to `makeCourseRow`)

**Step 1: Write migration**

```sql
-- User-facing notes displayed on the course detail page.
-- Set via seed data or automated processes (e.g., seasonal closure detection).
ALTER TABLE courses ADD COLUMN display_notes TEXT;
```

**Step 2: Update `CourseRow` in `src/types/index.ts`**

Add `display_notes: string | null;` after `disabled: number;`:

```typescript
  disabled: number;
  display_notes: string | null;
  last_had_tee_times: string | null;
```

**Step 3: Update seed script `scripts/seed.ts`**

Add `displayNotes?: string` to the `CourseEntry` interface after `disabled`:

```typescript
  disabled?: number;
  displayNotes?: string;
  platform: string;
```

Replace the existing `lines.push(...)` call in the `for` loop with:

```typescript
  const displayNotesVal = course.displayNotes ? `'${esc(course.displayNotes)}'` : "NULL";
  lines.push(
    `INSERT INTO courses (id, name, city, state, disabled, display_notes, platform, platform_config, booking_url) VALUES ('${esc(course.id)}', '${esc(course.name)}', '${esc(course.city)}', '${esc(course.state ?? "MN")}', ${course.disabled ?? 0}, ${displayNotesVal}, '${esc(course.platform)}', '${esc(JSON.stringify(course.platformConfig))}', '${esc(course.bookingUrl)}') ON CONFLICT(id) DO UPDATE SET name=excluded.name, city=excluded.city, state=excluded.state, disabled=excluded.disabled, display_notes=excluded.display_notes, platform=excluded.platform, platform_config=excluded.platform_config, booking_url=excluded.booking_url;`
  );
```

**Step 4: Update `seedCourse` in `src/test/d1-test-helper.ts`**

Add `display_notes` to the overrides type, defaults object, INSERT SQL, and `.bind()` call. Follow the same pattern used for `state` and `disabled` (already present). Default: `null`.

**Step 5: Update test helpers in other test files**

Add `display_notes: null` to every `CourseRow` mock object:
- `src/lib/cron-handler.test.ts` — in `makeCourseRow`, add after `disabled: 0`
- `src/lib/batch.test.ts` — in `makeCourse`, add after `disabled: 0` (if present) or `is_active: 1`
- `src/lib/poller.test.ts` — in `mockCourse`, add after `disabled: 0`
- `src/lib/poller.integration.test.ts` — in `makeCourseRow`, add after `disabled: 0`

**Step 6: Update course detail API**

In `src/app/api/courses/[id]/route.ts`, add `c.display_notes` to the SELECT clause. Find the existing SELECT (starts with `SELECT c.id, c.name, c.city...`) and add `c.display_notes` after `c.is_active`:

```sql
SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active, c.display_notes,
```

**Step 7: Update course detail page**

In `src/app/courses/[id]/page.tsx`:

Add `display_notes: string | null;` to the `course` state type (find the `useState<{...}>` block around line 15).

Add this JSX after the `{course && <CourseHeader ... />}` block and before the `<div className="mt-4">` DatePicker div:

```tsx
{course?.display_notes && (
  <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
    {course.display_notes}
  </div>
)}
```

Do NOT change anything else in this component.

**Step 8: Update courses page filter**

In `src/app/courses/page.tsx`, change the `visibleCourses` filter from:

```typescript
const visibleCourses = (courseCatalog as CatalogCourse[]).filter((c) => {
  if (c.disabled) return false;
```

to:

```typescript
const visibleCourses = (courseCatalog as CatalogCourse[]).filter((c) => {
  if (c.disabled && !c.displayNotes) return false;
```

This shows disabled courses on the courses page if they have display notes (needed for Ft. Snelling). Add `displayNotes?: string` to the `CatalogCourse` interface.

**Step 9: Add test for disabled-with-notes visibility**

In `src/app/courses/page.test.tsx`, update the mock courses JSON to include a disabled course with displayNotes:

```typescript
{ id: "course-e", name: "Notes Course", city: "Minneapolis", bookingUrl: "https://example.com/e", disabled: 1, displayNotes: "Book on their website" },
```

Add test:

```typescript
it("shows disabled course with displayNotes", () => {
  render(<CoursesPage />);
  expect(screen.getByText("Notes Course")).toBeDefined();
});
```

**Step 10: Run tests**

```bash
npm test && npx tsc --noEmit
```

**Step 11: Commit**

```
feat: add display_notes column for course-specific messages (migration 0008)
```

**BEFORE marking this task complete:**
1. Verify migration number is correct (0008)
2. Verify ALL test helpers have `display_notes: null` added
3. Verify `npm test && npx tsc --noEmit` passes with zero errors

---

## Task 2: CPS Golf V4 Auth — Add Transaction Registration

**BEFORE starting work:**
1. Read `dev/testing-pitfalls-coverage-review.md`
2. Read `src/adapters/cps-golf.ts` — the V4 branch at lines 62-67
3. Read `src/adapters/cps-golf.test.ts` — the `describe("v4 auth mode")` section
4. Follow TDD: write failing test → implement → verify green

**Depends on:** Nothing (independent of Task 1)

**Files:**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/cps-golf.test.ts`

**What's wrong:** The V4 auth path skips transaction registration. Brookview's V4 endpoint requires a `transactionId` even with apiKey auth.

**Step 1: Update existing V4 tests**

In the `describe("v4 auth mode")` block:

The test "skips token and transaction, uses apiKey header directly" currently expects 1 fetch call. After the fix, V4 will make 2 calls (register + TeeTimes). Update it:
- Rename to `"skips token but registers transaction for v4 courses"`
- Add `new Response(JSON.stringify(true), { status: 200 })` as the FIRST mock (for RegisterTransactionId)
- Change `expect(fetchSpy).toHaveBeenCalledTimes(1)` to `2`
- Assert first call URL contains `/RegisterTransactionId`
- Assert first call has `x-apikey` header
- Assert second call URL contains `/TeeTimes?` and `transactionId=`

The test "routes v4 request through proxy when proxy config is set" currently expects 1 proxyFetch call. Update:
- Add a second `mockResolvedValueOnce` for the register call (returns `{ status: 200, headers: {}, body: JSON.stringify(true) }`) BEFORE the existing TeeTimes mock
- Change `expect(proxyFetch).toHaveBeenCalledTimes(1)` to `2`
- Assert first proxyFetch call URL contains `/RegisterTransactionId`
- Assert second proxyFetch call URL contains `/TeeTimes?` and `transactionId=`

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/adapters/cps-golf.test.ts
```

**Step 3: Implement the fix**

In `src/adapters/cps-golf.ts`, in the `if (isV4)` block (around line 62), after `headers = this.buildV4Headers(...)`, add:

```typescript
  const transactionId = await this.registerTransaction(
    baseUrl,
    apiKey, // unused by registerTransaction — it only uses headers
    headers,
    proxy
  );
  params.set("transactionId", transactionId);
```

The `registerTransaction` method's second parameter (`token`) is unused — it only spreads the `headers` param into its fetch call. The V4 headers already contain `x-apikey`, so this works correctly.

**Step 4: Run tests**

```bash
npx vitest run src/adapters/cps-golf.test.ts
npm test && npx tsc --noEmit
```

**Step 5: Commit**

```
fix: add transaction registration to CPS Golf V4 auth flow
```

**BEFORE marking this task complete:**
1. Verify V5 tests are completely untouched
2. Verify both V4 tests and V4 proxy test pass with 2-call expectations
3. Run `npm test && npx tsc --noEmit` — all green

---

## Task 3: Add Brookview Courses to Catalog

**BEFORE starting work:**
1. Tasks 1 AND 2 must be complete
2. Read `src/config/courses.json` — entry format, find current max `"index"` value
3. Verify `"Golden Valley"` is mapped to `"South Metro"` in `src/config/areas.ts`

**Depends on:** Tasks 1 and 2

**Files:**
- Modify: `src/config/courses.json`

**Scope:** ONLY add catalog entries. Do NOT modify adapter code, test files, or areas.ts (Golden Valley should already be mapped).

**Step 1: Discover Brookview websiteId**

Use `WebFetch` to fetch `https://brookview.cps.golf/onlineresweb/Home/Configuration`. Extract the `websiteId` value from the JSON response. You MUST use the actual discovered value — do NOT commit a placeholder.

**Step 2: Add Brookview Regulation (18-hole)**

```json
{
  "index": NEXT_INDEX,
  "id": "brookview-regulation",
  "name": "Brookview Regulation",
  "city": "Golden Valley",
  "state": "MN",
  "address": "200 Brookview Pkwy, Golden Valley, MN 55426",
  "platform": "cps_golf",
  "platformConfig": {
    "subdomain": "brookview",
    "websiteId": "REPLACE_WITH_DISCOVERED_VALUE",
    "courseIds": "1,2",
    "authType": "v4"
  },
  "bookingUrl": "https://brookview.cps.golf/onlineresweb"
}
```

**Step 3: Add Brookview Par-3**

Same `websiteId`, courseIds = `"3"`.

```json
{
  "index": NEXT_INDEX + 1,
  "id": "brookview-par3",
  "name": "Brookview Par-3",
  "city": "Golden Valley",
  "state": "MN",
  "address": "200 Brookview Pkwy, Golden Valley, MN 55426",
  "platform": "cps_golf",
  "platformConfig": {
    "subdomain": "brookview",
    "websiteId": "SAME_DISCOVERED_VALUE",
    "courseIds": "3",
    "authType": "v4"
  },
  "bookingUrl": "https://brookview.cps.golf/onlineresweb"
}
```

**Step 4: Regenerate seed + test**

```bash
npx tsx scripts/seed.ts
npm test && npx tsc --noEmit
```

**Step 5: Commit**

```
feat: add Brookview Regulation and Par-3 to catalog (CPS Golf V4)
```

**BEFORE marking this task complete:**
1. Verify `websiteId` is a real UUID (not a placeholder)
2. Verify Golden Valley maps to "South Metro" in areas.ts
3. Run `npm test && npx tsc --noEmit` — all green

**After Tasks 1-3, review checkpoint:**
```
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (minimum three
rounds) until you're confident there aren't any more issues.
```

---

## Task 4: TeeWire Adapter

**BEFORE starting work:**
1. Read `dev/research/teewire-platform-investigation.md` — full API details including response format
2. Read `src/adapters/foreup.ts` and `src/adapters/foreup.test.ts` — adapter pattern to follow
3. Read `dev/testing-pitfalls-coverage-review.md`
4. Follow TDD: write failing test → implement → verify green

**Depends on:** Nothing (independent of Tasks 1-3)

**Files:**
- Create: `src/adapters/teewire.ts`
- Create: `src/adapters/teewire.test.ts`
- Create: `src/test/fixtures/teewire-tee-times.json`
- Create: `src/adapters/teewire.smoke.test.ts`
- Modify: `src/adapters/index.ts` (register adapter)
- Modify: `src/adapters/index.test.ts` (add lookup test)

Create the smoke test file `src/adapters/teewire.smoke.test.ts` — follow the pattern in `src/adapters/foreup.smoke.test.ts`. Test against Inver Wood (tenant: `inverwood`, calendarId: `3`). Use a date ~5 days from now. Skip gracefully if the API returns no data (course may be closed for season).

**Adapter requirements:**
- `platformId` MUST be `"teewire"`
- MUST use `AbortSignal.timeout(10000)` on fetch call
- MUST set `User-Agent: TwinCitiesTeeTimes/1.0` header (Cloudflare blocks requests without it)
- MUST throw on HTTP errors (non-2xx) — do NOT return empty array for errors
- MUST throw on `success: false` in response
- MUST throw on missing `tenant` or `calendarId` in config
- MUST parse price from formatted string: `"$51.00"` → `51.00` using `parseFloat(price.replace(/[^0-9.]/g, ""))`
- MUST select the walking green fee rate: find the first rate where `rate_title` includes `"Walking"`
- MUST determine `holes` from the selected walking rate's `holes` field (9 or 18)
- MUST use `availability.available_spots` for `openSlots`
- MUST filter out slots with `available_spots <= 0`
- If no walking rate found, use `null` for price and first rate's `holes` for hole count
- Time conversion: `"09:00:00"` + date param `"2026-04-15"` → `"2026-04-15T09:00:00"`

**API endpoint:**
```
GET https://teewire.app/{tenant}/online/application/web/api/golf-api.php?action=tee-times&calendar_id={calendarId}&date={YYYY-MM-DD}
Headers: User-Agent: TwinCitiesTeeTimes/1.0
```

**platformConfig shape:** `{ tenant: string; calendarId: string; }`

**Step 1:** Create fixture `src/test/fixtures/teewire-tee-times.json`. Use the exact format from the research doc's "Tee Times Response" section. Include 3 slots: one with 18+9 hole rates (4 available), one with 18-only (2 available), one with 9-only (1 available).

**Step 2:** Write 12 failing tests in `src/adapters/teewire.test.ts`:
- platformId, parsing (full TeeTime shape), walking rate price selection, holes from walking rate, URL construction, User-Agent header, HTTP error, network error, missing tenant, missing calendarId, empty tee_times array, price string parsing

**Step 3:** Run tests, verify fail: `npx vitest run src/adapters/teewire.test.ts`

**Step 4:** Implement `src/adapters/teewire.ts`

**Step 5:** Run tests, verify pass

**Step 6:** Register in `src/adapters/index.ts` (add import + `new TeeWireAdapter()` to array). Add lookup test in `src/adapters/index.test.ts`.

**Step 7:** Run full suite: `npm test && npx tsc --noEmit`

**Step 8:** Commit: `feat: add TeeWire adapter`

**BEFORE marking this task complete:**
1. Review tests against `dev/testing-pitfalls-coverage-review.md`
2. Verify: error paths tested? Missing config? Price parsing from "$51.00"? Walking rate not found?
3. `npm test && npx tsc --noEmit` — all green

---

## Task 5: Add Inver Wood Courses to Catalog

**Depends on:** Task 4 (needs TeeWire adapter registered)

**Files:**
- Modify: `src/config/courses.json`

**Step 1:** Check max index, add Inver Wood Championship 18:

```json
{
  "index": NEXT_INDEX,
  "id": "inver-wood-18",
  "name": "Inver Wood Championship",
  "city": "Inver Grove Heights",
  "state": "MN",
  "address": "1850 70th St E, Inver Grove Heights, MN 55077",
  "platform": "teewire",
  "platformConfig": { "tenant": "inverwood", "calendarId": "3" },
  "bookingUrl": "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list"
}
```

**Step 2:** Add Inver Wood Executive 9:

```json
{
  "index": NEXT_INDEX + 1,
  "id": "inver-wood-9",
  "name": "Inver Wood Executive",
  "city": "Inver Grove Heights",
  "state": "MN",
  "address": "1850 70th St E, Inver Grove Heights, MN 55077",
  "platform": "teewire",
  "platformConfig": { "tenant": "inverwood", "calendarId": "16" },
  "bookingUrl": "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=16&view=list"
}
```

**Step 3:** `npx tsx scripts/seed.ts && npm test && npx tsc --noEmit`

**Step 4:** Commit: `feat: add Inver Wood Championship and Executive to catalog (TeeWire)`

**After Tasks 4-5, review checkpoint:**
```
You MUST carefully review the batch of work from multiple perspectives.
Minimum three rounds. Update private journal.
```

---

## Task 6: Add Ft. Snelling to Catalog (Link-Only with Display Note)

**BEFORE starting work:**
1. Task 1 must be complete (needs `display_notes` column and courses page filter update)

**Depends on:** Task 1

**Files:**
- Modify: `src/config/courses.json`

**Context:** GolfNow's tee time API requires affiliate credentials or is behind Cloudflare bot management. Individual tee times are not accessible. Ft. Snelling is added with `disabled: 1` (prevents polling — no adapter exists) and `displayNotes` (shown on course detail page + makes it visible on courses page despite being disabled).

**Step 1:** Add Ft. Snelling:

```json
{
  "index": NEXT_INDEX,
  "id": "ft-snelling",
  "name": "Ft. Snelling",
  "city": "Minneapolis",
  "state": "MN",
  "address": "49 Hwy 5, St. Paul, MN 55111",
  "disabled": 1,
  "displayNotes": "Tee times for this course are available on GolfNow. Select 'Book Online' to view and book.",
  "platform": "golfnow",
  "platformConfig": { "facilityId": "18122" },
  "bookingUrl": "https://www.golfnow.com/tee-times/facility/18122-fort-snelling-golf-club-9-holes/search"
}
```

Key: `disabled: 1` prevents the cron handler from trying to poll (no GolfNow adapter exists). `displayNotes` makes it visible on the courses page despite being disabled (per the filter change in Task 1: `!c.disabled || c.displayNotes`).

**Step 2:** `npx tsx scripts/seed.ts && npm test && npx tsc --noEmit`

**Step 3:** Commit: `feat: add Ft. Snelling to catalog with GolfNow booking link`

---

## Task 7: Update Research Documentation

**Depends on:** All previous tasks

**Files:**
- Modify: `dev/research/remaining-platforms-investigation.md`

**Changes:**
- Brookview section: change "Status: Deferred" to "Status: Implemented". Replace the WAF concerns with: "`brookview.cps.golf` works with V4 apiKey auth — no proxy or WAF workaround needed."
- TeeWire section: change "Status: Deferred" to "Status: Implemented".
- GolfNow section: change "Status: Deferred" to "Status: Deferred (API requires affiliate credentials)". Add: "Individual tee times require affiliate API registration at `affiliate.gnsvc.com` or are behind Cloudflare bot management. Ft. Snelling added as catalog-only with GolfNow booking link."
- Update the Platform Comparison Summary table: add TeeWire row (Auth: User-Agent header only, API Style: REST GET/JSON, Complexity: Low, Status: Adapter built). Update GolfNow status to "Deferred (credentials required)".

**Commit:** `docs: update platform research with Brookview, TeeWire, and GolfNow status`

---

## Parallelization Notes

- **Task 1** (display_notes) and **Task 2** (V4 fix) are independent — can run in parallel
- **Task 3** (Brookview) depends on Tasks 1 + 2
- **Task 4** (TeeWire) is independent of Tasks 1-3 — can run in parallel with anything
- **Task 5** (Inver Wood) depends on Task 4
- **Task 6** (Ft. Snelling) depends on Task 1
- **Task 7** (docs) runs last

**Recommended execution:** Tasks 1+2+4 in parallel, then Tasks 3+5+6 after deps, then Task 7.
