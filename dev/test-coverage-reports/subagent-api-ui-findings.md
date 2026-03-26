# Test Coverage Review: API Routes & UI Components (PRs 42/43)

Date: 2026-03-25

Files reviewed:
- `src/app/api/courses/route.ts`
- `src/app/api/tee-times/route.ts`
- `src/app/courses/page.tsx`
- `src/components/tee-time-list.tsx`

Test files found:
- `src/app/api/courses/route.test.ts` (unit, mocked D1)
- `src/app/api/courses/route.integration.test.ts` (real SQLite)
- `src/app/api/tee-times/route.test.ts` (unit, mocked D1)
- `src/app/api/tee-times/route.integration.test.ts` (real SQLite)
- `src/components/tee-time-list.test.ts` (isStale only)
- No test file for `src/app/courses/page.tsx`

---

## 1. `src/app/api/courses/route.ts` — GET /api/courses

### Code Paths

| # | Path (line) | Description | Test? | Severity |
|---|-------------|-------------|-------|----------|
| 1 | L7-8 | getCloudflareContext succeeds, DB obtained | Covered (route.test.ts "returns 200") | -- |
| 2 | L12-28 | SQL query executes successfully, returns courses | Covered (route.test.ts "returns 200") | -- |
| 3 | L25 | `WHERE c.disabled = 0` — disabled courses excluded from results | **GAP** | **correctness** |
| 4 | L26 | `ORDER BY c.state DESC, c.name ASC` — MN courses sort before non-MN (SD) | **GAP** | **correctness** |
| 5 | L31-36 | D1 query throws, returns 500 | Covered (route.test.ts "returns 500") | -- |
| 6 | L22-23 | poll_log 24-hour freshness filter | Covered (route.test.ts "query filters poll_log") | -- |
| 7 | L23 | `no_data` status included in poll_log filter | Covered (route.test.ts "query includes no_data") | -- |
| 8 | L8 | getCloudflareContext fails (throws before try/catch) | **GAP** | **nice-to-have** |

### Integration test drift

The integration test (`route.integration.test.ts`) has a **hardcoded SQL string** (lines 8-21) that does NOT match the actual route query:
- Integration SQL: `ORDER BY c.name` (line 21)
- Actual route SQL: `ORDER BY c.state DESC, c.name ASC` (line 26)
- Integration SQL: missing `WHERE c.disabled = 0`
- Actual route SQL: has `WHERE c.disabled = 0` (line 25)

This means the integration tests are testing a **stale version of the query**. All integration test results for sorting and filtering may be invalid.

### `seedCourse` helper gap

The `seedCourse` helper in `d1-test-helper.ts` does not insert `state` or `disabled` columns. Since `state` defaults to `'MN'` and `disabled` defaults to `0`, the defaults happen to make existing tests pass, but there are no tests that exercise non-default values (e.g., `state = 'CA'` or `disabled = 1`).

### Security Checklist

| Check | Status |
|-------|--------|
| Unauthenticated access | Public endpoint, no auth required (appropriate for course list) |
| SQL parameterization | No user input in query -- the SQL is static. Safe. |
| Fail-closed on missing context | `getCloudflareContext()` failure is uncaught outside try/catch -- would return uncontrolled 500. **GAP** (nice-to-have) |
| Input validation | No input parameters. N/A. |

---

## 2. `src/app/api/tee-times/route.ts` — GET /api/tee-times

### Code Paths

| # | Path (line) | Description | Test? | Severity |
|---|-------------|-------------|-------|----------|
| 1 | L13-18 | Missing date param returns 400 | Covered (route.test.ts "date is missing") | -- |
| 2 | L13-18 | Invalid date format returns 400 | Covered (route.test.ts "invalid date format") | -- |
| 3 | L29-34 | Invalid startTime format returns 400 | Covered (route.test.ts "invalid startTime") | -- |
| 4 | L35-40 | Invalid endTime format returns 400 | Covered (route.test.ts "invalid endTime") | -- |
| 5 | L43-48 | Invalid minSlots returns 400 | **GAP** | **correctness** |
| 6 | L43 | minSlots = "0" (boundary: positive integer check, 0 is < 1) | **GAP** | **correctness** |
| 7 | L43 | minSlots = "-1" (negative number) | **GAP** | **correctness** |
| 8 | L43 | minSlots = "abc" (non-numeric) | **GAP** | **correctness** |
| 9 | L51-56 | Too many course IDs (>50) returns 400 | Covered (route.test.ts "too many course IDs") | -- |
| 10 | L59 | `c.state as course_state` in SELECT | **GAP** | **correctness** |
| 11 | L62 | `WHERE ... AND c.disabled = 0` — disabled courses excluded | **GAP** | **correctness** |
| 12 | L66-69 | Course ID filter applied to query | Covered (route.test.ts "filters by course IDs") | -- |
| 13 | L72-75 | startTime filter applied | Covered (integration "time range filter") | -- |
| 14 | L77-79 | endTime filter applied | Covered (integration "time range filter") | -- |
| 15 | L82-85 | holes filter (only "9" or "18" accepted) | Covered (integration "holes filter") | -- |
| 16 | L82 | holes = "36" or other invalid value — silently ignored | **GAP** | **nice-to-have** |
| 17 | L87-89 | minSlots filter applied to query | Covered (integration "minSlots filter") | -- |
| 18 | L92 | `ORDER BY c.state DESC, t.time ASC` — state-based sorting | **GAP** | **correctness** |
| 19 | L94-99 | Successful query returns 200 with date + teeTimes | Covered (route.test.ts "returns 200") | -- |
| 20 | L100-105 | D1 query throws, returns 500 | Covered (route.test.ts "returns 500") | -- |
| 21 | L7-8 | getCloudflareContext fails before try/catch | **GAP** | **nice-to-have** |

### Integration test drift

The integration test (`route.integration.test.ts`) has a **replicated query builder** (lines 11-67) that does NOT match the actual route:
- Integration query: `SELECT t.*, c.name as course_name, c.city as course_city` (line 23)
- Actual route query: `SELECT t.*, c.name as course_name, c.city as course_city, c.state as course_state` (line 59)
- Integration query: missing `AND c.disabled = 0` in WHERE clause
- Actual route query: has `AND c.disabled = 0` (line 62)
- Integration query: `ORDER BY t.time ASC` (line 56)
- Actual route query: `ORDER BY c.state DESC, t.time ASC` (line 92)

This means the integration tests are testing a **stale version of the query**. The disabled filtering and state sorting are completely untested at the integration level.

### Security Checklist

| Check | Status |
|-------|--------|
| Unauthenticated access | Public endpoint, no auth required (appropriate for tee time lookup) |
| SQL parameterization | All user inputs bound via `?` placeholders. Safe. |
| Fail-closed on missing context | `getCloudflareContext()` failure uncaught outside try/catch. **GAP** (nice-to-have) |
| Input validation | date: regex validated. startTime/endTime: regex validated. minSlots: partial validation (missing from unit tests). courseIds: capped at 50. **holes has no validation** but only "9"/"18" are accepted, other values silently ignored (acceptable fail-closed behavior). |
| IN clause injection | Course IDs use parameterized placeholders. Safe. |

---

## 3. `src/app/courses/page.tsx` — /courses page

**No test file exists.**

### Code Paths

| # | Path (line) | Description | Test? | Severity |
|---|-------------|-------------|-------|----------|
| 1 | L23 | `typeof window === "undefined"` — SSR guard in getCollapsedAreas | **GAP** | **nice-to-have** |
| 2 | L25-26 | localStorage.getItem returns null — returns empty array | **GAP** | **nice-to-have** |
| 3 | L27-28 | localStorage.getItem returns valid JSON array | **GAP** | **nice-to-have** |
| 4 | L27-28 | localStorage.getItem returns non-array JSON — returns empty array | **GAP** | **nice-to-have** |
| 5 | L29-31 | localStorage.getItem throws — returns empty array | **GAP** | **nice-to-have** |
| 6 | L34-40 | saveCollapsedAreas writes to localStorage, catches errors | **GAP** | **nice-to-have** |
| 7 | L56-58 | `visibleCourses` filters out `c.disabled` courses | **GAP** | **correctness** |
| 8 | L60 | groupByArea groups courses by area | **GAP** | **nice-to-have** |
| 9 | L46-54 | toggleArea adds/removes areas from collapsed state | **GAP** | **nice-to-have** |
| 10 | L96 | isFavorite check per course | **GAP** | **nice-to-have** |
| 11 | L130-133 | toggleFavorite on star button click | **GAP** | **nice-to-have** |
| 12 | L109-118 | Optional address display with maps link | **GAP** | **nice-to-have** |

### Security Checklist

| Check | Status |
|-------|--------|
| User data handling | Client-side only, reads from static JSON catalog. No API calls. Safe. |
| XSS | Course data comes from static JSON, not user input. Safe. |

---

## 4. `src/components/tee-time-list.tsx` — TeeTimeList component

Existing test file (`tee-time-list.test.ts`) only covers `isStale()` and `STALE_THRESHOLD_MS`. No rendering tests exist.

### Code Paths

| # | Path (line) | Description | Test? | Severity |
|---|-------------|-------------|-------|----------|
| 1 | L44-48 | `loading === true` shows loading message | **GAP** | **nice-to-have** |
| 2 | L50-59 | `teeTimes.length === 0` shows empty state | **GAP** | **nice-to-have** |
| 3 | L63-71 | Grouping tee times by date (preserving input order) | **GAP** | **nice-to-have** |
| 4 | L66-67 | Same-date items appended to existing group | **GAP** | **nice-to-have** |
| 5 | L68-69 | New date starts a new group | **GAP** | **nice-to-have** |
| 6 | L73 | hasMultipleDates determines if date headers are shown | **GAP** | **nice-to-have** |
| 7 | L86 | isCollapsed check per date group | **GAP** | **nice-to-have** |
| 8 | L90-108 | Date header with toggle (only when multiple dates) | **GAP** | **nice-to-have** |
| 9 | L131 | `nines` display: `{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}` | **GAP** | **correctness** |
| 10 | L131 | nines is null — no parenthetical shown | **GAP** | **correctness** |
| 11 | L131 | nines is undefined — no parenthetical shown | **GAP** | **correctness** |
| 12 | L131 | nines is "Front 9" — shows "(Front 9)" | **GAP** | **correctness** |
| 13 | L133-134 | open_slots display: singular "spot" vs plural "spots" | **GAP** | **nice-to-have** |
| 14 | L135 | price display: null price hidden, non-null shown with $.toFixed(2) | **GAP** | **nice-to-have** |
| 15 | L136-138 | stale indicator shown when isStale returns true | **GAP** | **nice-to-have** |
| 16 | L145-155 | Booking click: sendBeacon fires only when isLoggedIn | **GAP** | **nice-to-have** |
| 17 | L173-175 | isStale function: threshold comparison | Covered (tee-time-list.test.ts) | -- |
| 18 | L29-38 | formatDateHeader parses YYYY-MM-DD correctly | **GAP** | **nice-to-have** |

### Security Checklist

| Check | Status |
|-------|--------|
| XSS | Data comes from API response, rendered by React (auto-escaped). Safe. |
| sendBeacon | Only fires when isLoggedIn, sends to same-origin /api/user/booking-clicks. Safe. |

---

## 5. Cron Handler (`src/lib/cron-handler.ts`) — disabled filter

| # | Path (line) | Description | Test? | Severity |
|---|-------------|-------------|-------|----------|
| 1 | L73 | `WHERE disabled = 0` — disabled courses excluded from polling | **GAP** — need to verify cron tests exercise this | **correctness** |

Note: The cron handler's `disabled = 0` filter was added in PR 43 but the cron handler tests were not part of this review scope. Flagging for awareness.

---

## Summary Counts

| Severity | Count |
|----------|-------|
| security-critical | 0 |
| correctness | 11 |
| nice-to-have | 21 |

---

## Top Findings

1. **Integration test queries are stale**: Both `route.integration.test.ts` files have hardcoded/replicated SQL that is missing `WHERE c.disabled = 0`, `c.state as course_state`, and `ORDER BY c.state DESC` from the actual routes. These tests pass but do not test the real query behavior added in PRs 42/43.

2. **`disabled` filtering is completely untested**: Neither the courses API nor the tee-times API has any test (unit or integration) verifying that courses with `disabled = 1` are excluded from results. The `seedCourse` helper doesn't even support inserting `disabled` or `state` columns.

3. **`nines` display logic has no tests**: The `tee-time-list.tsx` component's new `nines` display (`{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}`) has no test coverage for any of its three branches (null, undefined, string value).

4. **No tests for `minSlots` validation**: The tee-times route validates that `minSlots` is a positive integer (line 43) but no unit test exercises this validation path, including boundary cases like `"0"`, `"-1"`, or `"abc"`.

5. **Courses page has zero test coverage**: `src/app/courses/page.tsx` has no test file at all. The `!c.disabled` filter (line 57) that replaced the SD course filter is untested.
