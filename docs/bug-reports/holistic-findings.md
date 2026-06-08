# Bug Hunt Report — Holistic Analysis

**Date:** 2026-03-09
**Analyst:** Claude (code-bug-hunter-holistic)

## Scope

Read every non-test source file in the project:

- **Adapters:** `src/adapters/cps-golf.ts`, `foreup.ts`, `index.ts`
- **API routes:** `src/app/api/courses/route.ts`, `[id]/route.ts`, `[id]/refresh/route.ts`, `tee-times/route.ts`
- **Components:** `nav.tsx`, `date-picker.tsx`, `time-filter.tsx`, `tee-time-list.tsx`, `course-header.tsx`
- **Lib:** `cron-handler.ts`, `db.ts`, `poller.ts`, `rate-limit.ts`, `favorites.ts`, `format.ts`
- **Types:** `src/types/index.ts`
- **Config:** `src/config/courses.json`
- **Worker:** `worker.ts`
- **Schema:** `migrations/0001_initial_schema.sql`
- **Env:** `env.d.ts`

Approach: Read all source, built a mental model of the data flow (cron → poller → adapter → db → API → components), then looked for contradictions, silent failures, incorrect logic, and data integrity issues.

## Bugs

### 1. CPS Golf courses without `apiKey` silently return empty results — Bunker Hills ForeUp course also missing `scheduleId`

**Location:** `src/config/courses.json:150-155` (Bunker Hills), `src/adapters/cps-golf.ts:25-27`, `src/adapters/foreup.ts:20-22`
**Severity:** significant
**Evidence:** In `courses.json`, Bunker Hills (foreup) has no `scheduleId` in its `platformConfig`. The ForeUp adapter at line 20-22 returns `[]` when `scheduleId` is missing. Similarly, 12 of 13 CPS Golf courses in the catalog have no `apiKey` in their `platformConfig` — only Theodore Wirth has one. The CPS adapter returns `[]` when `apiKey` is missing.

This means polling these courses produces `no_data` poll log entries, the cron handler dutifully re-polls them every cycle (since `shouldPollDate` returns true for today/tomorrow regardless of last poll time), and each poll burns a 250ms sleep. With 12 non-functional CPS courses + 1 non-functional ForeUp course, that's 13 courses × 2 always-poll dates = 26 wasted poll iterations (6.5 seconds of sleep) per cron cycle, plus unnecessary poll_log writes.

**Impact:** The cron handler wastes time and writes garbage `no_data` entries for courses that can never return data. The poll_log fills with noise. This is a known limitation per the memory notes ("only 3 can poll at launch"), but the code has no mechanism to distinguish "this course is properly configured" from "this course is missing config" — `is_active` is 1 for all of them. This is not a catastrophic bug but it degrades cron performance and pollutes diagnostic data.

### 2. `toDateStr` uses local timezone, creating date drift near midnight

**Location:** `src/components/date-picker.tsx:12-13`
**Severity:** significant
**Evidence:** `toDateStr` calls `d.toISOString().split("T")[0]`. `toISOString()` returns UTC. But dates are constructed via `new Date()` (local time) in `buildQuickDays` (line 22) and the home page (line 11). For a user browsing at 11 PM Central Time, `new Date()` is already the next day in UTC. So `toDateStr(new Date())` returns tomorrow's date, not today's.

The same pattern appears in `src/app/page.tsx:11` and `src/app/courses/[id]/page.tsx:14` — both use `new Date().toISOString().split("T")[0]` for the initial selected date.

Example: User opens the app at 11:30 PM CT on March 15. `new Date().toISOString()` → `"2026-03-16T05:30:00.000Z"`. The default selected date becomes "2026-03-16" (tomorrow), and the "Today" quick-day button also shows March 16.

**Impact:** Users in the Central Time zone see wrong dates for ~5 hours each night (after 7 PM CDT / 6 PM CST). The quick-day buttons and default date selection all shift forward by one day.

### 3. `fromDateStr` creates dates in local time, but `toDateStr` outputs UTC — roundtrip mismatch

**Location:** `src/components/date-picker.tsx:12-17`
**Severity:** minor
**Evidence:** `fromDateStr("2026-03-15")` creates `new Date("2026-03-15T00:00:00")` — midnight local time. If that Date is then passed through `toDateStr`, it calls `.toISOString()` which converts to UTC. For Central Time (UTC-6), midnight local = 6 AM UTC the same day, so the roundtrip `toDateStr(fromDateStr("2026-03-15"))` → `"2026-03-15"` works. BUT for timezones ahead of UTC (irrelevant for TC users but a latent issue) or during DST transitions, it could break.

More concretely: `datesInRange` (line 35-44) calls `d.setDate(d.getDate() + 1)` on a local-time Date, then `toDateStr` converts to UTC. During the spring-forward DST transition (March 8, 2026), `setDate` on a midnight-local Date may produce 11 PM the previous day in some engines after DST kicks in, which when converted to UTC could skip or duplicate a date.

**Impact:** Minor. The target audience is in Central Time so the `fromDateStr` → `toDateStr` roundtrip works for dates chosen in quick-day mode. The DST edge case in `datesInRange` could produce an off-by-one date in the calendar range picker during the spring-forward weekend.

### 4. `shouldPollDate` always returns true for today/tomorrow regardless of how recently polled

**Location:** `src/lib/poller.ts:11-18`
**Severity:** minor
**Evidence:** For `dayOffset <= 1`, `shouldPollDate` ignores `minutesSinceLastPoll` and always returns `true`. The time-of-day throttling in `shouldRunThisCycle` gates whether the cron runs at all, but once it runs, every course polls today and tomorrow unconditionally. Combined with Bug #1 (misconfigured courses), this means the cron handler re-fetches 13 broken courses + 6 working courses = 19 courses × 2 dates = 38 API calls minimum per cron cycle during peak hours.

For properly-configured courses this is acceptable (the design intends high-frequency polling during 5-10 AM). But it means `lastPolled` tracking for today/tomorrow is written but never read — the code path for "skip if recently polled" is dead code for these offsets.

**Impact:** Wasted API calls during each cron cycle for courses that were just polled 5 minutes ago. For 6 working courses at peak, this is 12 calls per 5 minutes — manageable. But it means the `minutesSinceLastPoll` parameter has no effect for 2 of 7 dates, which could surprise someone trying to add per-course-per-date deduplication.

### 5. Rate limiter uses string interpolation in SQL instead of parameterized binding

**Location:** `src/lib/rate-limit.ts:18-19`
**Severity:** significant
**Evidence:** The query reads:
```
`SELECT polled_at FROM poll_log
 WHERE course_id = ? AND polled_at > datetime('now', '-${COURSE_COOLDOWN_SECONDS} seconds')`
```
`COURSE_COOLDOWN_SECONDS` is a module constant (`30`), so this isn't a SQL injection vulnerability in practice. However, this is a D1 prepared statement where the string is interpolated at statement preparation time. The concern is that if `COURSE_COOLDOWN_SECONDS` were ever derived from user input, or if the pattern were copied for other parameters, it would be a SQL injection vector.

More practically: D1 may or may not cache prepared statement plans. If it does, changing `COURSE_COOLDOWN_SECONDS` between deployments while a cached plan exists could produce stale behavior.

**Impact:** Not exploitable today since the value is a hardcoded constant. But it's a code smell that violates the principle of parameterized queries consistently. Low real-world impact.

### 6. Refresh endpoint uses server UTC for default date, not Central Time

**Location:** `src/app/api/courses/[id]/refresh/route.ts:28`
**Severity:** minor
**Evidence:** When no `date` query parameter is provided:
```ts
const date = dateParam ?? new Date().toISOString().split("T")[0];
```
This uses UTC. A user hitting "Refresh" at 8 PM Central (2 AM UTC next day) without passing a date gets tomorrow's UTC date, not today's Central date. However, the `CourseHeader` component always passes `dates` explicitly (line 40-42), so this path is only triggered by direct API calls without a `date` param.

**Impact:** Low — the UI always sends a date. Only affects direct API consumers who omit the date parameter during late evening CT hours.

### 7. `upsertTeeTimes` and `logPoll` are not atomic — poll log written after tee times

**Location:** `src/lib/poller.ts:71-73`
**Severity:** minor
**Evidence:** In `pollCourse`:
```ts
await upsertTeeTimes(db, course.id, date, teeTimes, now);
await logPoll(db, course.id, date, "success", teeTimes.length, undefined);
```
`upsertTeeTimes` uses `db.batch()` (a D1 transaction) for the delete+insert. But `logPoll` is a separate `db.run()` call. If the worker times out or crashes between the two, tee times are updated but no poll log entry exists. The cron handler's `pollTimeMap` uses `poll_log` to determine freshness, so it would re-poll this course+date on the next cycle (thinking it hasn't been polled recently), duplicating work but not causing data corruption.

**Impact:** Minor — at worst a course gets polled twice. No data loss or corruption.

### 8. `formatCpsDate` produces locale-dependent output on non-US runtimes

**Location:** `src/adapters/cps-golf.ts:90-103`
**Severity:** minor
**Evidence:** `toLocaleDateString("en-US", ...)` with `weekday: "short", month: "short"` may produce slightly different output across JavaScript engines. The code assumes the format `"Wed, Apr 15, 2026"` and strips commas to get `"Wed Apr 15 2026"`. Most engines produce this format for `en-US`, and Cloudflare Workers use V8, which does. This is robust in the deployed environment but fragile if the code were run in a different JS engine.

**Impact:** Negligible in production (Cloudflare Workers = V8). But if tests run in a different environment that formats differently, the adapter could produce incorrect date strings.

## Design Concerns

### Silent failure pattern in adapters
Both adapters return `[]` on any error (network failure, invalid JSON, HTTP error). The caller (`pollCourse`) logs `"no_data"` for empty results, which is indistinguishable from "the course has no tee times today" vs "the API is down" vs "our config is wrong". This makes debugging production issues harder than it needs to be — you'd need to correlate with external logs to distinguish these cases.

### No poll_log cleanup
`poll_log` grows unbounded. The cron handler queries `WHERE polled_at > datetime('now', '-24 hours')` so old rows don't affect correctness, but D1 storage has limits. With 19 courses × 7 dates × ~12 polls/hour (peak), that's ~1,596 rows/day or ~48K rows/month. Not critical yet, but will be a scaling concern.

### Client-side date logic depends on system clock
The home page, course page, and date picker all use `new Date()` to determine "today." If a user's device clock is wrong, they'll see and request wrong dates. This is standard web app behavior, not unique to this project, but worth noting since the app is time-sensitive.

### `any` types in course page
`src/app/courses/[id]/page.tsx` uses `any` for course state and tee times arrays (lines 16-17). This bypasses TypeScript's protection against accessing properties that don't exist on the API response. If the API response shape changes, these pages will fail silently at runtime.
