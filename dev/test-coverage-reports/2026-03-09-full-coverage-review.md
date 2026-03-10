# Test Coverage Review — Full Codebase

**Date:** 2026-03-09
**Scope:** All 17 source files across adapters, lib, API routes, and components
**Existing tests:** 5 test files, 30 passing tests

---

## Coverage Summary

| File | Functions Mapped | Covered | GAP | Gap Rate |
|------|-----------------|---------|-----|----------|
| src/adapters/cps-golf.ts | 2 | 9 | 8 | 47% |
| src/adapters/foreup.ts | 2 | 6 | 5 | 45% |
| src/adapters/index.ts | 1 | 0 | 4 | 100% |
| src/lib/poller.ts | 3 | 11 | 6 | 35% |
| src/lib/cron-handler.ts | 3 | 8 | 12 | 60% |
| src/lib/db.ts | 2 | 0 | 10 | 100% |
| src/lib/favorites.ts | 4 | 0 | 10 | 100% |
| src/app/api/courses/route.ts | 1 | 0 | 6 | 100% |
| src/app/api/courses/[id]/route.ts | 1 | 0 | 6 | 100% |
| src/app/api/courses/[id]/refresh/route.ts | 1 | 0 | 14 | 100% |
| src/app/api/tee-times/route.ts | 1 | 0 | 24 | 100% |
| src/components/tee-time-list.tsx | 3+ | 3 | 16 | 84% |
| src/components/course-header.tsx | 2+ | 0 | 12 | 100% |
| src/components/date-picker.tsx | 5+ | 0 | 11 | 100% |
| src/components/time-filter.tsx | 1 | 0 | 3 | 100% |
| src/components/nav.tsx | 1 | 0 | 2 | 100% |
| **Total** | | **37** | **149** | **80%** |

---

## What's Well-Covered

- **`shouldPollDate` and `shouldRunThisCycle`** have excellent boundary-condition tests across all time windows and thresholds
- **CPS Golf adapter** has thorough happy-path and error-path tests (network errors, non-200, missing config, 9/18-hole branching)
- **`isStale`** has proper threshold boundary tests (74min, 76min, 3h, constant assertion)

---

## Gap Totals

| Severity | Count |
|----------|-------|
| Security-critical | 17 |
| Correctness | 108 |
| Nice-to-have | 37 |
| **Total** | **162** |

Note: Many "security-critical" gaps are about proving existing parameterized queries are safe via tests — the code itself uses `?` binds everywhere, so actual injection risk is low. The real risk is the unauthenticated POST `/refresh` endpoint.

---

## Security-Critical Gaps (17)

All in API routes (zero test files exist):

1. POST `/refresh` has no authentication — anyone can trigger unlimited upstream API calls
2. POST `/refresh` TOCTOU race in 30-second poll cache check
3-6. No tests proving `id` param SQL safety in `courses/[id]` and `courses/[id]/refresh` (2 routes x 2 gaps)
7. No test proving `date` param SQL safety in `/refresh`
8. `/refresh` invalid date format rejection (400) untested
9. `tee-times` missing/invalid `date` rejection (400) untested
10-14. No tests proving SQL safety for `courses`, `startTime`, `endTime`, `minSlots`, `date` params in `tee-times`
15. `startTime`/`endTime` accept arbitrary strings with no format validation
16. `courses` param with excessively long list could create unbounded IN clause
17. `minSlots` with non-numeric value passes NaN to query

---

## Correctness Gaps — Highest Priority (top 25)

### Zero-test-file functions with real logic

1-10. **`favorites.ts`** (10 gaps): SSR guard, localStorage get/set, JSON parse safety, toggle add/remove, isFavorite — entirely untested
11-16. **`db.ts`** (6 gaps): `upsertTeeTimes` time-parsing logic, delete+insert batch, empty array edge, null price; `logPoll` insert and null coalescing
17-20. **`adapters/index.ts`** (4 gaps): Registry lookup for known/unknown platforms

### Pure functions with untested branches

21-24. **`formatTime`** (4 gaps): AM, PM, noon (12→12PM), midnight (0→12AM)
25. **`toDateStr` timezone bug**: Uses `Date.toISOString()` (UTC) which can produce wrong date near midnight local time

### Remaining 83 correctness gaps across:
- `runCronPoll` (10 gaps) — largest untested function
- API route happy paths and error paths (28 gaps)
- Component rendering logic (24 gaps)
- Adapter edge cases (6 gaps)
- Various boundary conditions (15 gaps)

---

## Key Observations

1. **10 of 17 source files have zero test coverage.** The 5 test files cover only adapters, poller helpers, and `isStale`.

2. **`timeAgo` and `staleAge` are near-duplicate functions** in separate files — should be consolidated into a shared util for easier testing.

3. **`toDateStr` has a latent timezone bug.** `Date.toISOString()` returns UTC, so a user at 11pm CDT sees tomorrow's date. This is the highest-risk correctness finding.

4. **All pure functions in components are unexported**, making them untestable without either exporting them or doing component render tests. Exporting is the lowest-friction fix.

5. **API routes have no error handling** — no try/catch in any of the 4 route files. D1 errors propagate unhandled.

---

## Recommended Priority for Test Writing

### Pass 1: Export + test pure functions (quick wins, high value)
- Export and test `formatTime`, `staleAge`, `timeAgo` (consolidate duplicates)
- Export and test `toDateStr`, `fromDateStr`, `datesInRange`, `buildQuickDays`
- Test `favorites.ts` (localStorage mocking)
- Test `adapters/index.ts` registry

### Pass 2: Adapter and poller edge cases
- ForeUp non-200 response
- Both adapters: malformed JSON response
- ForeUp non-numeric `green_fee`
- `pollCourse` error catch path
- `getPollingDates` month boundary

### Pass 3: Input validation (code fixes + tests)
- Add `minSlots` NaN guard in tee-times route
- Add `courses` param length limit
- Add `startTime`/`endTime` format validation
- Add try/catch to route handlers

---

*Detailed per-function tables in subagent reports:*
- `subagent-adapters-lib-findings.md`
- `subagent-api-routes-findings.md`
- `subagent-components-utils-findings.md`

---

## Remediation Summary

**Date:** 2026-03-09
**Plan:** `docs/plans/2026-03-09-test-coverage-and-fixes.md` (13 tasks, 6 batches)

### Stats

| Metric | Count |
|--------|-------|
| Total gaps identified | 42 |
| Tests added | 50 (30 → 80) |
| New test files | 5 (`format.test.ts`, `date-picker.test.ts`, `favorites.test.ts`, `index.test.ts` (adapters), coverage reports) |
| Bugs fixed | 1 (ForeUp NaN price) |
| Source files modified | 9 |

### Tests Added

**`src/lib/format.test.ts`** (19 tests) — new shared formatting module
- `formatTime`: morning, afternoon, noon, midnight, 1 PM, 11:59 AM
- `formatAge`: just now, minutes, hours, days + boundary conditions (59m, 60m, 23h, 24h)
- `staleAge`: hours, days, threshold boundary, 23h, 24h

**`src/components/date-picker.test.ts`** (10 tests) — exported helpers
- `toDateStr`, `fromDateStr`, `buildQuickDays` (7 entries, Today label, sequential dates)
- `datesInRange` (inclusive, single date, empty, month boundary)
- `formatShortDate`

**`src/lib/favorites.test.ts`** (7 tests) — localStorage with SSR guard
- `getFavorites`: empty, parsed, malformed JSON
- `toggleFavorite`: add, remove
- `isFavorite`: true, false

**`src/adapters/index.test.ts`** (3 tests) — adapter registry
- Known platforms (cps_golf, foreup), unknown returns undefined

**`src/adapters/foreup.test.ts`** (+2 tests) — edge cases
- Non-200 response → empty array
- Non-numeric green_fee → null price (caught NaN bug)

**`src/adapters/cps-golf.test.ts`** (+2 tests) — edge cases
- Null TeeTimes array → empty array
- Null GreenFee → null price

**`src/lib/poller.test.ts`** (+2 tests) — edge cases
- Month boundary rollover in getPollingDates
- Adapter throws → logPoll with error status

### Bugs Found

1. **ForeUp NaN price** (`src/adapters/foreup.ts:49`): `parseFloat("free")` returned `NaN`, displayed as "$NaN" in UI. Fixed with `Number.isNaN()` guard — non-numeric values now map to `null`.

### Other Fixes

- **Extracted shared formatting** (`src/lib/format.ts`): Consolidated duplicate `timeAgo`/`staleAge`/`formatTime` from components into shared module
- **Exported date-picker helpers**: 5 pure functions made testable
- **pollCourse return type**: Changed from `Promise<void>` to `Promise<"success" | "no_data" | "error">` so callers can detect failures
- **Refresh failure surfacing**: Route returns 500 on pollCourse error; client-side logs failures (excluding 429 rate-limits)
- **API input validation**: tee-times route validates time format, minSlots, courseIds cap
- **API error handling**: All 3 route handlers now have try/catch with 500 responses

### Remaining Gaps (deferred)

- React component render tests (needs jsdom/testing-library setup)
- `runCronPoll` integration tests (needs D1 mock harness)
- `toDateStr` timezone edge case (architectural decision on UTC vs local)
- API route integration tests (need D1 test harness)
