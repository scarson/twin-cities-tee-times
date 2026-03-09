# Multi-Pass Bug Analysis Report

**Date:** 2026-03-09
**Scope:** `src/` directory + `worker.ts`
**Analyzer:** Claude (code-bug-hunter-multipass)

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 3     |
| Medium   | 5     |
| Low      | 4     |
| **Total** | **12** |

---

## Pass 1: Contract Violations

### [HIGH] BUG-01: SQL injection via string interpolation in rate-limit.ts

**File:** `src/lib/rate-limit.ts`, line 19
**Description:** The `COURSE_COOLDOWN_SECONDS` constant is interpolated directly into the SQL string using a template literal:
```ts
`SELECT polled_at FROM poll_log
 WHERE course_id = ? AND polled_at > datetime('now', '-${COURSE_COOLDOWN_SECONDS} seconds')
 ORDER BY polled_at DESC LIMIT 1`
```
While `COURSE_COOLDOWN_SECONDS` is currently a hard-coded numeric constant (30), this is a pattern violation: the query string is built via interpolation rather than parameterized binding. If the constant is ever refactored to come from config or user input, this becomes a real SQL injection vector. D1's `prepare()` contract expects all dynamic values to go through `.bind()`. This is not exploitable today, but it violates the parameterized query contract.

### [MEDIUM] BUG-02: `toDateStr()` uses UTC, creating date mismatch in negative-UTC-offset timezones

**File:** `src/components/date-picker.tsx`, line 13
**Description:** `toDateStr(d)` calls `d.toISOString().split("T")[0]`, which converts to UTC. When called late at night in a negative-UTC-offset timezone (like America/Chicago, UTC-5/6), the UTC date can be *tomorrow*. This means the "Today" quick button could show tomorrow's date after ~6/7pm local time.

The same pattern appears in `src/app/page.tsx` line 11 and `src/app/courses/[id]/page.tsx` line 14, where the initial date state is set using `new Date().toISOString().split("T")[0]`.

`fromDateStr()` (line 17) correctly uses local time (`new Date(s + "T00:00:00")`), but `toDateStr` uses UTC, creating an asymmetry: `toDateStr(fromDateStr("2026-03-15"))` may not return `"2026-03-15"` depending on timezone.

### [MEDIUM] BUG-03: `CpsGolfAdapter.formatCpsDate()` locale-dependent output

**File:** `src/adapters/cps-golf.ts`, lines 90-103
**Description:** The method uses `toLocaleDateString("en-US", ...)` which produces locale-formatted output. On Cloudflare Workers, `en-US` is generally available, but the exact format of `toLocaleDateString` is implementation-defined per the ECMAScript spec. The test (line 60) checks for URL-encoded format `\w{3}\+\w{3}\+\d{2}\+\d{4}` but doesn't validate that the day-of-month is zero-padded via `day: "2-digit"` vs the actual CPS API expectation. If CPS expects `"Wed Apr 5 2026"` (no padding) but the formatter produces `"Wed Apr 05 2026"`, or vice versa, single-digit days would fail silently (adapter returns `[]`).

### [MEDIUM] BUG-04: Courses list query performs unbounded full-table scan of poll_log

**File:** `src/app/api/courses/route.ts`, lines 16-17; `src/app/api/courses/[id]/route.ts`, lines 15-16
**Description:** The subquery `ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC)` scans the entire `poll_log` table to find the most recent poll per course. The `poll_log` table grows unboundedly (no cleanup/rotation). Over time this query will get progressively slower. The index `idx_poll_log_course_date` is on `(course_id, date, polled_at)` which helps somewhat, but the subquery doesn't filter by date, so it can't fully utilize the index.

---

## Pass 2: Pattern Deviations

### [LOW] BUG-05: Inconsistent error handling between adapters and API routes

**File:** `src/adapters/cps-golf.ts`, `src/adapters/foreup.ts`
**Description:** Both adapters silently swallow all errors (network failures, JSON parse errors, non-200 responses) by returning `[]`. This means `pollCourse()` in `src/lib/poller.ts` logs these as `"no_data"` rather than `"error"`, making it impossible to distinguish "the course has no tee times today" from "the API is down." The adapter's catch block (cps-golf.ts line 84, foreup.ts line 56) catches everything including JSON parse failures and returns `[]`, which the poller interprets as a successful fetch with no results.

### [LOW] BUG-06: `favorites.ts` missing ABOUTME comments

**File:** `src/lib/favorites.ts`
**Description:** Per project conventions, all code files must start with ABOUTME comments. This file lacks them. (Also missing from `src/types/index.ts`, `src/adapters/cps-golf.ts`, `src/adapters/foreup.ts`, `src/adapters/index.ts`, `src/lib/db.ts`, `src/lib/poller.ts`, `src/lib/cron-handler.ts`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/nav.tsx`, `src/components/tee-time-list.tsx`, and all API route files.)

### [MEDIUM] BUG-07: `shouldPollDate` off-by-one: day offsets 2-3 documented as "Days 3-4"

**File:** `src/lib/poller.ts`, lines 18-21
**Description:** The comment says "Days 3-4: every 30 minutes" but the code checks `dayOffset <= 3`, meaning offsets 2 and 3 (which are the 3rd and 4th days counting from 0). The *test* (poller.test.ts line 26) tests offset 2 and 3, confirming the code works as implemented. However, the comment is misleading: "Days 3-4" in human terms could mean offsets 2-3 or 3-4. The actual behavior is that offset 2 (day after tomorrow) gets 30-min polling, but offset 4 (5th day) gets 10-hour polling. This is a documentation/naming issue, not a logic bug, but could lead to incorrect future modifications.

---

## Pass 3: Failure Modes

### [HIGH] BUG-08: `upsertTeeTimes` deletes existing data even when insert will fail

**File:** `src/lib/db.ts`, lines 18-43
**Description:** The function uses `db.batch()` with a DELETE followed by INSERTs. D1's `batch()` is documented as executing statements sequentially but **not** as a true transaction with rollback. From Cloudflare's D1 docs: "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence." However, if the batch *partially* succeeds (e.g., DELETE succeeds but an INSERT fails due to a constraint violation or malformed data), the existing tee times for that course+date are lost. The `time.split("T")[1].substring(0, 5)` on line 23-24 will produce `undefined` if `tt.time` doesn't contain "T", leading to inserting `undefined` as the time value.

### [HIGH] BUG-09: Refresh endpoint has no error handling for `pollCourse` exceptions

**File:** `src/app/api/courses/[id]/refresh/route.ts`, line 45
**Description:** The `pollCourse(db, course, date)` call on line 45 is not wrapped in a try/catch. While `pollCourse` itself catches adapter errors, if `logPoll` or `upsertTeeTimes` throws (e.g., D1 connection issue), the exception propagates unhandled and the API returns a generic 500 with no structured error response. The `pollCourse` function *does* have internal try/catch, but the catch block itself calls `logPoll` which could also throw, creating an unhandled double-fault scenario.

### [MEDIUM] BUG-10: `buildQuickDays` uses local `new Date()` but `toDateStr` uses UTC

**File:** `src/components/date-picker.tsx`, lines 20-33
**Description:** `buildQuickDays()` creates dates via `new Date()` and mutates with `setDate()` (local time), then converts with `toDateStr()` which uses `.toISOString()` (UTC). If the local-time date and UTC date differ (e.g., at 11pm Central time, UTC is already the next day), the quick-day buttons will show incorrect dates. This is the same root cause as BUG-02 but manifests differently: the quick buttons could show a gap or duplicate in the 7-day sequence.

---

## Pass 4: Concurrency Issues

### [LOW] BUG-11: Cron handler has no protection against overlapping executions

**File:** `src/lib/cron-handler.ts`, `worker.ts`
**Description:** If a cron cycle takes longer than 5 minutes (many courses, slow APIs, rate-limit sleeps), the next cron trigger fires and starts a new `runCronPoll` execution. Both executions will poll the same courses, doubling API load and potentially causing race conditions in `upsertTeeTimes` (one execution deletes rows that another just inserted). With 19 courses x 7 dates x 250ms sleep = ~33 seconds minimum, this is unlikely today but becomes a risk as the course catalog grows toward the planned ~80 courses (~140 seconds minimum, plus API latency).

The `shouldPollDate` check using `minutesSinceLastPoll` provides *some* natural deduplication, but there's a TOCTOU window: both executions read `poll_log` before either writes to it.

---

## Pass 5: Error Propagation

### [LOW] BUG-12: Home page `fetch` errors silently clear all tee times

**File:** `src/app/page.tsx`, lines 45-46
**Description:** If any fetch in `Promise.all` fails (network error, server error), the catch block sets `setTeeTimes([])`, wiping the previously-displayed results. A partial failure (e.g., one of multiple date fetches fails) is treated the same as total failure. Consider: if the user has tee times displayed for Monday and adds Tuesday, a failure fetching Tuesday's data wipes Monday's results too.

The same pattern exists in `src/app/courses/[id]/page.tsx` lines 37-38.

---

## Notes

- Several of these findings (BUG-02/BUG-10 timezone issues, BUG-08 batch atomicity) are latent bugs that may not manifest in typical usage but represent real failure modes under specific conditions.
- The codebase is generally well-structured with good separation of concerns. Most issues are edge cases rather than fundamental design flaws.
- BUG-06 (missing ABOUTME comments) is widespread but low-impact; listed for completeness since it's a project convention violation.
