# Core Library Test Coverage Review — PRs 42 & 43

**Date:** 2026-03-25
**Scope:** `cron-handler.ts`, `db.ts`, `areas.ts`, `types/index.ts` — changes related to `disabled` filter, `nines` column, `state` field, and new city mappings.

---

## 1. `src/lib/cron-handler.ts` + `src/lib/cron-handler.test.ts`

### `shouldRunThisCycle(now: Date)` — Lines 20–34

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | 5am–10am CT → return true | 30 | Tested ("runs every invocation during 5am-10am CT") | — |
| 2 | 10am–2pm CT → minute % 10 < 5 | 31 | Tested ("runs every 10 min during 10am-2pm CT") | — |
| 3 | 2pm–8pm CT → minute % 15 < 5 | 32 | Tested ("runs every 15 min during 2pm-8pm CT") | — |
| 4 | 8pm–5am CT → minute < 5 | 33 | Tested ("runs once per hour during 8pm-5am CT") | — |

### `runCronPoll(env, cronExpression)` — Lines 50–250

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | `shouldRunThisCycle` returns false → early return with `skipped: true` | 64–66 | GAP — no test asserts the early-return shape when `shouldRunThisCycle` is false. All tests use fake timers set to 7am. | nice-to-have |
| 2 | **`WHERE disabled = 0` filter** — disabled courses excluded from `allCourses` | 72–74 | GAP — `makeCourseRow` always sets `disabled: 0`. No test creates a `disabled: 1` course and asserts it is excluded from polling. The SQL filter is the ONLY defense preventing disabled courses from being polled AND from being auto-reactivated. If the `WHERE disabled = 0` clause were removed, disabled courses would be fetched, potentially polled as inactive, and auto-reactivated. | **security-critical** |
| 3 | Active/inactive split via `is_active` | 79–80 | Tested (active/inactive polling tests) | — |
| 4 | `shouldPollDate` returns false → `continue` (skip poll) | 115 | Tested ("does not consume budget for shouldPollDate=false skips") | — |
| 5 | Budget check: `budget < weight` → set `budgetExhausted`, break | 118–124 | Tested ("stops polling when budget is exhausted") | — |
| 6 | `pollCourse` returns "success" → UPDATE `last_had_tee_times` | 131–136 | GAP — no test verifies that `last_had_tee_times` is updated on success for active courses. The test for inactive auto-activation checks the log message but not the DB write. | correctness |
| 7 | `pollCourse` throws → log error, call `logPoll` with error message | 137–144 | Tested ("continues polling other courses after one throws") | — |
| 8 | `logPoll` inside catch throws (double-fault) → catch and log | 140–144 | Tested ("handles double-fault when logPoll throws inside catch block") — but only verifies no crash, doesn't verify the `console.error` message for the double-fault specifically | — |
| 9 | Budget decremented on error path | 146 | Tested ("decrements budget on error path") | — |
| 10 | `sleep(250)` between polls | 149 | No direct assertion — acceptable, not a logic path | — |
| 11 | Inactive probing: `probeDates = dates.slice(0, 2)` (today + tomorrow only) | 154 | Tested ("probes inactive courses with today and tomorrow only") | — |
| 12 | Inactive: `minutesSinceProbe < 60` → skip | 165 | Tested ("does not probe inactive courses if polled less than 1 hour ago") | — |
| 13 | Inactive: budget exhaustion during probing | 171–177 | GAP — there is a test for budget exhaustion during inactive probing ("decrements budget on inactive probe error"), but it doesn't verify the `console.warn` message from line 173–175. The `budgetExhausted` flag is asserted though. | nice-to-have |
| 14 | Inactive: `pollCourse` returns "success" → `foundTeeTimes = true` | 184–185 | Tested ("promotes inactive course to active when tee times found") | — |
| 15 | Inactive: probe throws → catch, continue to next course | 187–191 | Tested ("continues probing other inactive courses after one throws") | — |
| 16 | Inactive: `foundTeeTimes` true → UPDATE `is_active = 1` + `last_had_tee_times` | 196–202 | Tested (via console.log assertion) — but no assertion that the DB was actually written to. The mock DB `bind().run()` is a no-op mock. | correctness |
| 17 | Inactive: outer catch around per-course probe block | 203–205 | GAP — no test exercises the outer try/catch at line 203. This catch handles errors from the `pollTimeMap.get` / `minutesSinceProbe` calculation or from the `UPDATE ... SET is_active = 1` statement itself. | nice-to-have |
| 18 | Housekeeping: batch 0 runs `deactivateStaleCourses`, `cleanupOldPolls`, `cleanupExpiredSessions` | 209–236 | Tested ("runs cleanup tasks in batch 0") | — |
| 19 | Housekeeping: non-zero batch skips all cleanup | 417–434 | Tested ("skips cleanup tasks in non-zero batches") | — |
| 20 | Housekeeping: `deactivateStaleCourses` throws → caught, logged | 215–217 | GAP — no test verifies that a failing `deactivateStaleCourses` is caught and doesn't crash the handler | nice-to-have |
| 21 | Housekeeping: `cleanupOldPolls` throws → caught, logged | 222–226 | GAP — same as above | nice-to-have |
| 22 | Housekeeping: `cleanupExpiredSessions` throws → caught, logged | 228–235 | GAP — same as above | nice-to-have |
| 23 | Housekeeping: `deactivatedCount > 0` logs message | 212–214 | GAP — tested that the SQL is prepared, but not that the log fires when `changes > 0` | nice-to-have |
| 24 | Fatal error catch → return zeros | 246–249 | GAP — no test exercises the outer try/catch that wraps the entire function (e.g., `env.DB` being undefined) | nice-to-have |
| 25 | **Disabled courses excluded from auto-reactivation** — because `WHERE disabled = 0` excludes them from `allCourses`, they never appear in `inactiveCourses` and can never be auto-reactivated | 72–74, 80, 156–206 | GAP — this is the same root issue as #2 above. There is no test proving that a `disabled: 1` course with `is_active: 0` is NOT auto-reactivated even when its adapter would return tee times. This is the most important fail-closed property of the disabled filter. | **security-critical** |

### Summary for `cron-handler.ts`
- **Security-critical gaps: 2** (both relate to the `disabled` filter — one for polling exclusion, one for auto-reactivation exclusion; they stem from the same missing test but are distinct failure modes)
- **Correctness gaps: 2** (`last_had_tee_times` UPDATE not asserted for active courses; auto-activation DB write not verified beyond log message)
- **Nice-to-have gaps: 8** (various error catch paths, housekeeping error isolation, fatal error catch, skipped cycle early return)

---

## 2. `src/lib/db.ts` + `src/lib/db.test.ts` + `src/lib/db.integration.test.ts`

### `upsertTeeTimes(db, courseId, date, teeTimes, fetchedAt)` — Lines 13–47

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | DELETE existing rows for course+date | 20–22 | Tested ("replaces old data on re-upsert") | — |
| 2 | Time extraction: `tt.time.includes("T")` → split and substring | 25–27 | Tested ("extracts HH:MM from ISO time") | — |
| 3 | Time pass-through: no T separator → use as-is | 25–27 | Tested ("stores time as-is when no T separator") | — |
| 4 | INSERT with 9 bind params including `nines` | 29–43 | GAP — the `nines` column binding (`tt.nines ?? null`) is never tested. No integration test passes a `TeeTime` with a `nines` value and verifies it is stored in the DB. No test verifies that `nines` defaults to `null` when omitted. | **correctness** |
| 5 | Empty teeTimes array → only DELETE, no INSERTs | 46 | Tested ("with empty array deletes existing rows") | — |
| 6 | Batch atomicity: constraint violation rolls back DELETE | 46 | Tested ("batch atomicity: constraint violation rolls back preceding DELETE") | — |
| 7 | FK enforcement: non-existent courseId | 46 | Tested ("FK enforcement: inserting tee time for non-existent course fails") | — |
| 8 | `tt.price` is null (nullable column) | 33 | GAP — no test inserts a tee time with `price: null` and verifies it round-trips | nice-to-have |

### `logPoll(db, courseId, date, status, teeTimeCount, errorMessage?)` — Lines 52–67

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | All three status values ("success", "error", "no_data") | 62–66 | Tested ("records entries with correct status values") | — |
| 2 | `errorMessage` provided | 65 | Tested (via "error" status with "API timeout") | — |
| 3 | `errorMessage` omitted → `null` | 65 | Tested (via "success" and "no_data" entries) | — |

### `sqliteIsoNow(modifier?)` — Lines 80–85

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | No modifier | 84 | Tested | — |
| 2 | With modifier | 81–83 | Tested (both "-30 seconds" and "-7 days") | — |

### `cleanupOldPolls(db)` — Lines 91–96

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Deletes entries older than 7 days | 93–94 | Tested (integration test) | — |
| 2 | Preserves recent entries | — | Tested (integration test checks remaining count) | — |
| 3 | Returns number of deleted rows | 95 | Tested (asserts `deleted === 1`) | — |

### `deactivateStaleCourses(db)` — Lines 103–113

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Deactivates course with old `last_had_tee_times` | 106–109 | Tested | — |
| 2 | Does NOT deactivate NULL `last_had_tee_times` | 108 | Tested | — |
| 3 | Does NOT deactivate already-inactive courses | 107 | Tested | — |
| 4 | Returns count of deactivated courses | 111 | Tested | — |

### `cleanupExpiredSessions(db)` — Lines 119–124

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Deletes expired sessions | 121 | Tested | — |
| 2 | Preserves active sessions | — | Tested | — |
| 3 | Returns count | 122 | Tested | — |

### Summary for `db.ts`
- **Correctness gaps: 1** (`nines` column binding never tested)
- **Nice-to-have gaps: 1** (`price: null` round-trip)

### Note on `seedCourse` test helper

The `seedCourse` helper in `src/test/d1-test-helper.ts` does NOT include `state` or `disabled` in its INSERT statement (lines 126–139). It inserts 8 columns but the `courses` table now has 10 (`state` added in migration 0006, `disabled` added in migration 0007). Both columns have `DEFAULT` values (`'MN'` and `0` respectively), so the INSERT succeeds, but the helper cannot be used to create courses with non-default `state` or `disabled` values. This is relevant because:
- No integration test can seed a `disabled: 1` course without raw SQL
- No integration test can seed a course with `state != 'MN'` without raw SQL

---

## 3. `src/config/areas.ts` + `src/config/areas.test.ts`

### `getArea(city)` — Lines 52–54

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Minneapolis → "Minneapolis" | 6 | Tested | — |
| 2 | St. Paul → "St. Paul" | 7 | Tested | — |
| 3 | Brooklyn Park → "North Metro" | 11 | GAP — no dedicated assertion. Covered only by the `courses.json` guard test which asserts `!= "Other"` but doesn't verify the SPECIFIC area. | correctness |
| 4 | Coon Rapids → "North Metro" | 12 | GAP — same as above | correctness |
| 5 | Blaine → "North Metro" | 13 | GAP — same as above | correctness |
| 6 | Roseville → "North Metro" | 14 | Tested ("maps Roseville to North Metro") | — |
| 7 | Ham Lake → "North Metro" | 15 | GAP — same as #3 | correctness |
| 8 | Anoka → "North Metro" | 16 | GAP — same as #3 | correctness |
| 9 | White Bear Lake → "East Metro" | 19 | GAP — same as #3 | correctness |
| 10 | Stillwater → "East Metro" | 20 | Tested ("maps Stillwater to East Metro") | — |
| 11 | Maplewood → "East Metro" | 21 | GAP — same as #3 | correctness |
| 12 | Inver Grove Heights → "East Metro" | 22 | GAP — listed in CITY_TO_AREA but NOT in `courses.json`, so the guard test doesn't cover it either | correctness |
| 13 | Edina → "South Metro" | 25 | Tested ("maps Edina to South Metro") | — |
| 14 | Chaska → "South Metro" | 26 | GAP — same as #3 | correctness |
| 15 | Hopkins → "South Metro" | 27 | Tested ("maps Hopkins to South Metro") | — |
| 16 | Apple Valley → "South Metro" | 28 | GAP — same as #3 | correctness |
| 17 | Bloomington → "South Metro" | 29 | GAP — same as #3 | correctness |
| 18 | Golden Valley → "South Metro" | 30 | GAP — listed in CITY_TO_AREA but NOT in `courses.json`. No test coverage at all. | correctness |
| 19 | Medina → "South Metro" | 31 | GAP — same as #3 | correctness |
| 20 | Maple Plain → "South Metro" | 32 | GAP — same as #3 | correctness |
| 21 | Maple Grove → "South Metro" | 33 | GAP — same as #3 | correctness |
| 22 | San Diego cities (6) | 35–41 | Tested ("maps SD cities to San Diego") | — |
| 23 | Unknown city → "Other" fallback | 53 | Tested ("returns Other for unknown cities") | — |
| 24 | All cities in courses.json map to a non-Other area | — | Tested ("covers every city in courses.json") | — |
| 25 | SD prefix invariant | — | Tested ("sd- prefix correctly identifies all and only SD test courses") | — |

**Note on severity for items #3–21:** These are all `correctness` severity, not `nice-to-have`. The `courses.json` guard test only asserts `!= "Other"` — it cannot catch a city mapped to the WRONG area (e.g., if someone accidentally mapped "Bloomington" to "North Metro" instead of "South Metro"). A dedicated assertion per city would catch misclassification. Items #12 and #18 (Inver Grove Heights, Golden Valley) are worse — they have zero test coverage because they're not yet in `courses.json`.

### `AREA_ORDER` — Lines 43–50

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Contains all 6 areas in order | 43–50 | Tested ("lists areas in display order") | — |

### `groupByArea(courses)` — Lines 57–82

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Groups courses by area | 60–67 | Tested | — |
| 2 | Sorts alphabetically within group | 69–71 | Tested | — |
| 3 | AREA_ORDER ordering | 74–77 | Tested (implicitly via group order assertion) | — |
| 4 | "Other" appended at end | 78–79 | Tested ("puts unmapped cities in Other at the end") | — |
| 5 | Areas with no courses omitted | 74–77 | Tested ("omits areas with no courses") | — |
| 6 | Empty input → empty output | 60 | Tested ("returns empty array for empty input") | — |
| 7 | Preserves extra fields on T | 62–67 | Tested ("preserves extra fields on course objects") | — |

### `mapsUrl(address)` — Lines 84–86

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Encodes address into Google Maps URL | 85 | Tested | — |
| 2 | Special characters encoded | 85 | Tested | — |

### Summary for `areas.ts`
- **Correctness gaps: 14** (12 cities only covered by the `courses.json` not-equal-to-Other guard, 2 cities with zero coverage)

---

## 4. `src/types/index.ts` — Type Changes

Type-only changes (no runtime code paths). Coverage assessment:

| # | Change | Used in tests? | Notes |
|---|--------|---------------|-------|
| 1 | `TeeTime.nines?: string` | `makeTeeTime` helper uses spread so `nines` can be passed, but no test does | Relates to db.ts gap #4 |
| 2 | `TeeTimeRow.nines: string \| null` | No test reads back a `nines` value from the DB | Relates to db.ts gap #4 |
| 3 | `CourseRow.state: string` | `makeCourseRow` in cron tests includes `state: "MN"`, but `seedCourse` helper does not include `state` | No runtime gap since column has DEFAULT |
| 4 | `CourseRow.disabled: number` | `makeCourseRow` includes `disabled: 0`, `seedCourse` does NOT include `disabled` | Relates to cron-handler gap #2 |

---

## Totals

| Severity | Count |
|----------|-------|
| Security-critical | 2 |
| Correctness | 17 |
| Nice-to-have | 10 |

---

## Top Findings

1. **[Security-critical]** The `WHERE disabled = 0` filter in `cron-handler.ts` (line 73) is the sole defense preventing disabled courses from being polled and auto-reactivated, but no test creates a `disabled: 1` course to verify exclusion. If the clause were accidentally removed, disabled courses would silently resume polling.

2. **[Correctness]** The `nines` column added to `upsertTeeTimes` (line 42: `tt.nines ?? null`) has zero test coverage — no integration test inserts a TeeTime with a `nines` value and verifies it persists in the database.

3. **[Correctness]** 14 of 22 city-to-area mappings in `areas.ts` lack dedicated assertions testing the SPECIFIC area they map to — the `courses.json` guard only proves they aren't "Other", not that they map to the correct region, so a misclassification bug would go undetected.
