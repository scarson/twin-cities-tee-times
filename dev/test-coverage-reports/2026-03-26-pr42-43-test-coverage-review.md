# Test Coverage Review: PRs 42 & 43 (MN Course Onboarding)

**Date:** 2026-03-26
**Scope:** All source files changed across PRs 42 (MN course onboarding) and 43 (disabled flag + Greenhaven fix)
**Files reviewed:** 12 source files across 3 subagent reviews

## What's Well-Covered
- Adapter happy paths: all 5 adapters have thorough parsing tests with realistic fixtures
- Adapter error handling: HTTP errors, network errors, and missing config all tested across CPS Golf, ForeUp, TeeItUp, Chronogolf, and Eagle Club
- ForeUp nines parsing: both-present and both-null cases tested with dedicated fixtures
- Area grouping: `groupByArea` thoroughly tested including edge cases (empty input, "Other" fallback, field preservation)

## Coverage Summary

| File | Paths Mapped | Covered | GAP | Gap Rate |
|------|-------------|---------|-----|----------|
| chronogolf.ts | 13 | 12 | 1 | 8% |
| eagle-club.ts | 17 | 14 | 3 | 18% |
| foreup.ts | 20 | 18 | 2 | 10% |
| index.ts | 6 | 5 | 1 | 17% |
| courses/route.ts | 8 | 5 | 3 | 38% |
| tee-times/route.ts | 21 | 13 | 8 | 38% |
| courses/page.tsx | 12 | 0 | 12 | 100% |
| tee-time-list.tsx | 18 | 1 | 17 | 94% |
| cron-handler.ts | 25 | 15 | 10 | 40% |
| db.ts | 9 | 7 | 2 | 22% |
| areas.ts | 25 | 11 | 14 | 56% |
| types/index.ts | 4 | 0 | 4 | 100% |
| **Total** | **178** | **101** | **77** | **43%** |

## Gap Severity Breakdown

| Severity | Count |
|----------|-------|
| Security-critical | 2 |
| Correctness | 32 |
| Nice-to-have | 34 |
| **Total** | **68** |

Note: 9 gaps from the type-only file overlap with gaps in other files. Deduplicated total is ~68.

---

## Security-Critical Gaps (2)

1. **`disabled` filter unverified in cron handler** — `cron-handler.ts:73` `WHERE disabled = 0` is the sole defense preventing disabled courses from being polled and auto-reactivated. No test creates a `disabled: 1` course and verifies it is excluded. If the clause were removed, disabled courses would silently resume polling and be auto-reactivated.

2. **`disabled` filter unverified for auto-reactivation** — Same root cause as #1 but distinct failure mode: a `disabled: 1, is_active: 0` course should never appear in the inactive probe loop. No test proves this. If `WHERE disabled = 0` were removed, such courses would be probed, find tee times (for SD courses), and be auto-reactivated — defeating the purpose of `disabled`.

---

## Correctness Gaps (32)

### High priority (should fix)

3. **Integration test SQL is stale** — Both `route.integration.test.ts` files have hardcoded SQL that is missing `WHERE c.disabled = 0`, `c.state as course_state`, and `ORDER BY c.state DESC` from the actual routes. Integration tests pass but do not test the real query behavior.

4. **`disabled` filtering untested in courses API** — `courses/route.ts:25` `WHERE c.disabled = 0` has no unit or integration test.

5. **`disabled` filtering untested in tee-times API** — `tee-times/route.ts:62` `AND c.disabled = 0` has no unit or integration test.

6. **`disabled` filtering untested in courses page** — `courses/page.tsx:57` `!c.disabled` filter has no test.

7. **`seedCourse` helper missing `state` and `disabled` columns** — `d1-test-helper.ts` INSERT doesn't include these columns, making it impossible to write integration tests for non-default values without raw SQL.

8. **`nines` column binding untested in `upsertTeeTimes`** — `db.ts:42` `tt.nines ?? null` is never tested. No integration test inserts a TeeTime with `nines` and verifies it round-trips.

9. **State-based sorting untested** — `ORDER BY c.state DESC` in both API routes has no test verifying MN courses sort before CA courses.

### Medium priority

10. **Eagle Club `StrExceptions.join` fallback** — `eagle-club.ts:86` only the `StrResult` branch is tested when `BoolSuccess=false`; the `StrExceptions.join("; ")` fallback is never exercised.

11. **Eagle Club non-numeric `EighteenFee`** — `eagle-club.ts:93` only empty string tested; a non-numeric non-empty string like "N/A" is not tested.

12. **ForeUp asymmetric null nines** — `foreup.ts:55` only both-null and both-truthy tested; one-truthy-one-null case never tested.

13. **`getAdapter("eagle_club")` not tested** — `index.ts` only 4 of 5 adapters have lookup tests.

14. **`minSlots` validation untested** — `tee-times/route.ts:43` validation for positive integer has no unit test (boundary: "0", "-1", "abc").

15. **`nines` display untested in UI** — `tee-time-list.tsx:131` the `tt.nines ? \`(${tt.nines})\` : ""` branch has no test for any of its three states (null, undefined, string).

16. **`last_had_tee_times` UPDATE not asserted** — `cron-handler.ts:131-136` no test verifies the DB write succeeds for active courses on "success" poll.

17. **Auto-activation DB write not verified** — `cron-handler.ts:196-202` test checks log message but not that the mock DB was called with correct args.

18–31. **14 city-to-area mappings lack specific assertions** — `areas.ts` `courses.json` guard only asserts `!= "Other"`, not the correct area. A misclassification (e.g., Bloomington → "North Metro") would go undetected. 2 cities (Inver Grove Heights, Golden Valley) have zero coverage.

---

## Nice-to-Have (34)

32–34. **`AbortSignal.timeout` not verified** — chronogolf.ts, eagle-club.ts, foreup.ts — no test asserts timeout option is passed to fetch.

35. **`price: null` round-trip** — db.ts — no test inserts null price and verifies it persists.

36–46. **11 courses/page.tsx paths** — entire page has no test file (localStorage, SSR guard, toggleArea, favorite button, etc.).

47–63. **17 tee-time-list.tsx rendering paths** — loading state, empty state, date grouping, price display, stale indicator, booking click beacon, etc.

64–68. **5 cron-handler error-catch paths** — housekeeping error isolation, fatal error catch, skipped cycle shape, inactive probe outer catch.

---

## Key Observations

**Stale integration tests are the biggest systemic risk.** Both route integration tests replicate the SQL queries from the source files, but neither was updated when the queries changed in PRs 42/43. This pattern means every future query change silently diverges the integration tests from reality. Consider having integration tests import or derive queries from the source rather than duplicating them.

**The `disabled` flag has zero test coverage despite being a fail-closed defense.** This is the most actionable gap — a single test creating a `disabled: 1` course and asserting it doesn't appear in cron polling, API results, or auto-reactivation would close both security-critical gaps.

**`seedCourse` helper is a testing bottleneck.** It doesn't support `state` or `disabled`, making it impossible to write integration tests for the new features without bypassing the helper. Updating it would unblock multiple gaps.

**City mapping tests are shallow.** The `courses.json` guard catches unmapped cities (→ "Other") but can't catch misclassified cities. This is a low-risk gap since misclassification only affects UI grouping, but it's 14 gaps that could be closed with one data-driven test.

---

## Evidence

Per-function tables are in the subagent reports:
- `dev/test-coverage-reports/subagent-adapters-findings.md`
- `dev/test-coverage-reports/subagent-api-ui-findings.md`
- `dev/test-coverage-reports/subagent-core-findings.md`
