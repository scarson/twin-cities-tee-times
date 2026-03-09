# Bug Hunt Report — Exploratory Analysis

**Date:** 2026-03-09
**Analyst:** Claude (code-bug-hunter-exploratory)

## Scope

All non-test source files in `src/` plus `worker.ts`:

**Deep exploration (high-risk):**
- `src/lib/cron-handler.ts` — cron orchestrator coordinating polling across courses/dates
- `src/lib/poller.ts` — polling logic, date generation, adapter invocation
- `src/lib/db.ts` — D1 upsert transactions
- `src/adapters/cps-golf.ts` — CPS Golf API adapter
- `src/adapters/foreup.ts` — ForeUp API adapter
- `src/app/api/courses/[id]/refresh/route.ts` — user-triggered refresh endpoint
- `src/app/api/tee-times/route.ts` — main tee times query API
- `src/app/api/courses/route.ts` and `[id]/route.ts` — course listing/detail APIs
- `src/lib/rate-limit.ts` — rate limiting for refresh endpoint
- `src/components/date-picker.tsx` — date selection with timezone-sensitive logic
- `src/components/course-header.tsx` — refresh trigger UI
- `src/components/tee-time-list.tsx` — tee time display
- `src/lib/format.ts` — time/date formatting
- `src/lib/favorites.ts` — localStorage favorites
- `src/config/courses.json` — course catalog data

**Also reviewed:** `src/types/index.ts`, `src/adapters/index.ts`, `src/app/layout.tsx`, `src/components/nav.tsx`, `src/components/time-filter.tsx`, `worker.ts`, `env.d.ts`, `migrations/0001_initial_schema.sql`

## Bugs

### 1. CPS Golf adapter silently returns empty array on API errors instead of throwing

**Location:** `src/adapters/cps-golf.ts:70-72` and `src/adapters/cps-golf.ts:84-86`
**Severity:** significant
**Evidence:** When `response.ok` is false (e.g., 500, 403, rate-limited 429), the adapter returns `[]`. Similarly, the `catch` block on line 84 returns `[]`. The caller in `poller.ts:66` treats an empty array as `"no_data"` and logs it as such. This means API failures (rate limiting, server errors, auth failures) are silently recorded as "no data" rather than "error", and the `poll_log` will show `status = 'no_data'` with a misleading `tee_time_count = 0`.
**Impact:** Debugging becomes difficult because genuine "no tee times available" is indistinguishable from "API is down" or "rate-limited". The `shouldPollDate` freshness logic treats a failed poll the same as a successful one with no results, so it won't retry a failed course until the next polling window. The ForeUp adapter (`src/adapters/foreup.ts:40-42`, `56-58`) has the same issue.

### 2. CPS Golf courses missing `apiKey` will silently return empty results forever

**Location:** `src/adapters/cps-golf.ts:25-27` cross-referenced with `src/config/courses.json`
**Severity:** significant
**Evidence:** The CPS Golf adapter returns `[]` when `apiKey` is falsy (line 25-27). In `courses.json`, only Theodore Wirth (line 9) has an `apiKey` configured. The remaining 12 CPS Golf courses (Gross National, Meadowbrook, Columbia, Hiawatha, Phalen, Chaska Town Course, Edinburgh USA, Oak Glen, Highland National, Como Park, Victory Links, Gem Lake Hills) have no `apiKey` in their `platformConfig`. The adapter will return `[]` for all of them, the poller will log `"no_data"`, and they'll appear in the UI as courses with zero tee times indefinitely.
**Impact:** 12 of 13 CPS Golf courses in the catalog will never return tee times. This is effectively dead configuration. Unlike the ForeUp `scheduleId` check (which has a similar guard for Bunker Hills missing its `scheduleId`), there's no logging or indication that the course is misconfigured rather than simply having no availability.

### 3. Bunker Hills ForeUp course missing `scheduleId` — will never return tee times

**Location:** `src/adapters/foreup.ts:20-21` cross-referenced with `src/config/courses.json:150-155`
**Severity:** minor
**Evidence:** The ForeUp adapter returns `[]` when `scheduleId` is falsy. Bunker Hills in `courses.json` only has `facilityId: "20252"` with no `scheduleId`. Same silent failure pattern as Bug #2.
**Impact:** Bunker Hills will never show tee times. This is documented as a known gap in the project memory ("ForeUp adapter requires `scheduleId` (Bunker Hills needs discovery)"), so flagging as minor since it's a known incomplete configuration rather than a code error. But the silent failure mode is still a concern — there's no way for a user or operator to know this course is non-functional.

### 4. `toDateStr` in date-picker uses local timezone, creating date mismatches

**Location:** `src/components/date-picker.tsx:13`
**Severity:** significant
**Evidence:** `toDateStr` calls `d.toISOString().split("T")[0]`, which converts to UTC. But the Date objects it operates on are created from `new Date()` (line 25 in `buildQuickDays`, and line 13 in `page.tsx`). For a user browsing at 11pm Central Time, `new Date()` in UTC is already the next day. So `toISOString().split("T")[0]` returns tomorrow's date, not today's date. The "Today" button would show tomorrow's date, and all quick-pick days would be shifted forward by one day during evening hours.
**Impact:** Users browsing between ~7pm and midnight Central Time (UTC-5/6) would see incorrect dates. The "Today" button would actually query tomorrow's tee times. This same pattern appears in `page.tsx:11` where the initial date state is set.

### 5. `fromDateStr` creates ambiguous local-time Date objects

**Location:** `src/components/date-picker.tsx:17`
**Severity:** minor
**Evidence:** `fromDateStr` does `new Date(s + "T00:00:00")` without a timezone specifier. Per the ECMAScript spec, datetime strings without a timezone offset are parsed as local time. If a user's browser is in a timezone east of UTC (e.g., UTC+1 through UTC+14), `toDateStr(fromDateStr("2026-03-09"))` would still produce "2026-03-09" since midnight local won't cross into the previous UTC day. But for timezones west of UTC (the primary user base in Central Time), midnight local = 5-6am UTC, so `toISOString()` will still produce the correct date. This is fragile but not currently broken for the target audience. However, the inconsistency with `toDateStr` using UTC means roundtripping `toDateStr(fromDateStr(s))` could theoretically break for some timezone/date combinations around DST transitions.
**Impact:** Low immediate risk for Central Time users, but the local-vs-UTC mismatch between `fromDateStr` and `toDateStr` is a latent issue.

### 6. Refresh endpoint defaults to UTC date, not Central Time

**Location:** `src/app/api/courses/[id]/refresh/route.ts:28`
**Severity:** minor
**Evidence:** When no `date` query parameter is provided, the code falls back to `new Date().toISOString().split("T")[0]`. This produces a UTC date. The cron handler (`cron-handler.ts:57-59`) correctly uses `toLocaleDateString("en-CA", { timeZone: "America/Chicago" })` for Central Time. So between ~7pm and midnight Central, a manual refresh without a `date` param would refresh tomorrow's (UTC) data instead of today's (Central) data.
**Impact:** The course detail page always passes a date from the date picker, so the fallback rarely triggers. But if the API is called directly without a `date` param during evening hours, it would refresh the wrong date.

### 7. SQL injection surface in rate-limit query via string interpolation

**Location:** `src/lib/rate-limit.ts:19`
**Severity:** minor
**Evidence:** The query uses template literal interpolation: `` `-${COURSE_COOLDOWN_SECONDS} seconds'` ``. The value comes from the constant `COURSE_COOLDOWN_SECONDS = 30` on line 4. Since this is a module-level constant (not user input), there's no actual injection risk today. However, if this constant were ever derived from user input or configuration, it would become injectable. The `bind()` call on line 22 correctly parameterizes `courseId`, but the time interval is interpolated directly into the SQL string.
**Impact:** No immediate risk since the value is a hardcoded constant. Flagged as a design concern rather than an exploitable bug.

### 8. `poll_log` table grows unbounded — no cleanup mechanism

**Location:** `src/lib/db.ts:49-63`, `migrations/0001_initial_schema.sql:29-39`
**Severity:** significant
**Evidence:** Every poll attempt inserts a row into `poll_log`. The cron handler polls up to 7 dates per course per cycle. With 19 courses, 7 dates, and polling every 5 minutes during peak hours, this generates ~133 rows per cycle. Over 16 peak-hours daily, that's roughly 25,000+ rows/day. There is no TTL, cleanup query, or scheduled purge anywhere in the codebase. The `cron-handler.ts:67` query filters with `WHERE polled_at > datetime('now', '-24 hours')`, so it only reads recent data, but old rows accumulate forever.
**Impact:** D1 free tier has a 5GB storage limit. While individual rows are small (~200 bytes), at 25K rows/day, the table would reach millions of rows within months. Query performance on the unfiltered `ROW_NUMBER()` subquery in `courses/route.ts:16-19` will degrade as the table grows, since it scans the entire `poll_log` table to find the most recent poll per course.

### 9. Courses list API uses unbounded `ROW_NUMBER()` over entire poll_log table

**Location:** `src/app/api/courses/route.ts:14-19`
**Severity:** minor
**Evidence:** The query computes `ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC)` across the entire `poll_log` table without any `WHERE` filter on the subquery. As the `poll_log` table grows (see Bug #8), this subquery scans every row in the table to compute the window function, even though only the most recent row per course is needed. The same pattern appears in `courses/[id]/route.ts:18-23`.
**Impact:** Performance degradation over time. For a small number of courses this won't matter initially, but combined with Bug #8 (unbounded growth), this query will become slow. A simple `WHERE polled_at > datetime('now', '-24 hours')` in the subquery would bound the scan.

### 10. Cron handler has no error isolation between courses

**Location:** `src/lib/cron-handler.ts:79-96`
**Severity:** significant
**Evidence:** The cron handler loops through courses sequentially (line 79), calling `pollCourse` for each course+date. While `pollCourse` itself catches adapter errors (poller.ts:75-78), if `logPoll` or `upsertTeeTimes` throws a D1 error (e.g., database connection issue, batch transaction failure), the exception propagates up through `pollCourse` uncaught, which kills the entire cron handler loop. All remaining courses in the iteration would be skipped.
**Impact:** A transient D1 error on one course would prevent all subsequent courses from being polled in that cycle. The `scheduled()` handler in `worker.ts:16` uses `ctx.waitUntil()`, so the error would be swallowed at the top level with no notification. Given that D1 has known occasional transient errors, this could result in silent partial polling failures.

## Design Concerns

### Adapter error reporting is structurally flawed
Both adapters return `[]` for all failure modes (network error, HTTP error, auth failure, rate limiting). The `PlatformAdapter` interface (`types/index.ts:22-23`) returns `Promise<TeeTime[]>`, making it impossible for callers to distinguish "no tee times exist" from "the API call failed." The poller's error-vs-no_data distinction (poller.ts:66-68 vs 75-78) only works if adapters throw on errors, but both adapters catch internally and return `[]`. This means the poller's try/catch error path is effectively dead code for adapter failures.

### Timezone handling is inconsistent across the codebase
Three different timezone strategies are used:
1. **Cron handler** (`cron-handler.ts:57-59`): Correctly uses `toLocaleDateString("en-CA", { timeZone: "America/Chicago" })` for Central Time dates
2. **Refresh endpoint** (`refresh/route.ts:28`): Uses UTC via `toISOString().split("T")[0]`
3. **Client-side** (`page.tsx:11`, `date-picker.tsx:13`): Uses `toISOString().split("T")[0]` which is UTC

This means the cron handler and the client/API can disagree about what "today" means during evening hours in Central Time. The cron handler would poll today's tee times while the client would request tomorrow's.

### No validation of `platform_config` JSON structure
`poller.ts:59` does `JSON.parse(course.platform_config)` with no validation. If the JSON is malformed or missing expected keys, the adapter will get `undefined` values and silently fail (returning `[]`). There's no schema validation, no error reporting, and no way to detect misconfigured courses except by noticing they never return tee times.

### Cooldown timer leak in CourseHeader
`src/components/course-header.tsx:54` sets a 30-second `setTimeout` stored in a ref, but there's no cleanup on unmount. If the user navigates away from the course page during the cooldown, the timer fires after unmount. In React 18+ with concurrent features, this could cause a "setState on unmounted component" warning. The `setInterval`/`setTimeout` should be cleaned up via `useEffect` return.
