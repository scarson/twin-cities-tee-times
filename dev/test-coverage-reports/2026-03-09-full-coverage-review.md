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
