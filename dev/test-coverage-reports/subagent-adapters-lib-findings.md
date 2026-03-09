# Test Coverage Review: Adapters & Lib Layers

**Date:** 2026-03-09
**Reviewer:** Claude (systematic coverage analysis)
**Scope:** `src/adapters/`, `src/lib/` — source + test files

---

## File: `src/adapters/cps-golf.ts` (104 lines)

### `CpsGolfAdapter.fetchTeeTimes` (lines 18-87)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 1 | Missing `apiKey` early return | 25-27 | Covered (`skips courses with missing apiKey`) | — |
| 2 | Successful fetch → parse TeeTimes array | 53-83 | Covered (`parses tee times from API response`) | — |
| 3 | Non-200 response → return `[]` | 70-72 | Covered (`returns empty array on non-200 response`) | — |
| 4 | Network/fetch error (catch) → return `[]` | 84-86 | Covered (`returns empty array on network error`) | — |
| 5 | `data.TeeTimes` is nullish → fallback `?? []` | 76 | GAP | correctness |
| 6 | `GreenFee` is nullish → fallback `?? null` | 79 | GAP | correctness |
| 7 | `Holes === 9` branch (9-hole mapping) | 80 | Covered (`handles 9-hole tee times`) | — |
| 8 | `Holes !== 9` branch (18-hole mapping) | 80 | Covered (fixture has 18-hole entries) | — |
| 9 | `Holes` is some other value (e.g. 27) → maps to 18 | 80 | GAP | nice-to-have |
| 10 | `websiteId` present → header included | 58 | Covered (mockConfig has websiteId, asserted in URL/headers test) | — |
| 11 | `websiteId` absent → header omitted | 58 | GAP | nice-to-have |
| 12 | `siteId` present → header included | 59 | GAP | nice-to-have |
| 13 | `siteId` absent → header omitted | 59 | Covered (mockConfig lacks siteId) | — |
| 14 | `terminalId` present → header included | 60 | GAP | nice-to-have |
| 15 | `terminalId` absent → header omitted | 60 | Covered (mockConfig lacks terminalId) | — |
| 16 | `courseIds` is nullish → fallback `?? ""` | 36 | GAP | nice-to-have |
| 17 | `response.json()` throws (malformed JSON) | 74 | GAP | correctness |

### `CpsGolfAdapter.formatCpsDate` (lines 90-103)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 18 | Normal ISO date → formatted CPS string | 90-103 | Covered (asserted in `builds the correct API URL and headers`) | — |
| 19 | Month/year boundary rollover (e.g. Dec 31) | 90-103 | GAP | correctness |

---

## File: `src/adapters/foreup.ts` (63 lines)

### `ForeUpAdapter.fetchTeeTimes` (lines 14-57)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 20 | Missing `scheduleId` early return | 20-22 | Covered (`skips courses with missing scheduleId`) | — |
| 21 | Successful fetch → parse array | 37-53 | Covered (`parses tee times from API response`) | — |
| 22 | Non-200 response → return `[]` | 40-42 | GAP | correctness |
| 23 | Network/fetch error (catch) → return `[]` | 54-56 | Covered (`returns empty array on error`) | — |
| 24 | `green_fee` is `null` → `price` is `null` | 49 | Covered (`handles null green_fee`) | — |
| 25 | `green_fee` is a string → `parseFloat` | 49 | Covered (fixture has string values) | — |
| 26 | `green_fee` is non-numeric string (e.g. `"free"`) → `parseFloat` returns NaN | 49 | GAP | correctness |
| 27 | `holes === 9` branch | 50 | Covered (fixture has 9-hole entry, asserted via `results[0].holes`) | — |
| 28 | `holes !== 9` branch (defaults to 18) | 50 | Covered (fixture has 18-hole entries) | — |
| 29 | `response.json()` throws (malformed JSON) | 44 | GAP | correctness |
| 30 | Empty API response (empty array `[]`) | 44-53 | Covered (`builds the correct API URL` uses empty array) | — |

### `ForeUpAdapter.toIso` (lines 60-62)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 31 | Normal conversion `"YYYY-MM-DD HH:MM"` → ISO | 60-62 | Covered (`converts time string to ISO 8601`) | — |
| 32 | Input with extra spaces or unexpected format | 60-62 | GAP | nice-to-have |

---

## File: `src/adapters/index.ts` (14 lines) — NO TEST FILE

### `getAdapter` (lines 12-14)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 33 | Known platformId (`"cps_golf"`) → returns adapter | 13 | GAP | correctness |
| 34 | Known platformId (`"foreup"`) → returns adapter | 13 | GAP | correctness |
| 35 | Unknown platformId → returns `undefined` | 13 | GAP | correctness |

### Module-level adapter registration (lines 5-10)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 36 | Map contains exactly 2 entries (cps_golf, foreup) | 5-10 | GAP | correctness |

---

## File: `src/lib/poller.ts` (78 lines)

### `shouldPollDate` (lines 11-25)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 37 | `dayOffset <= 1` → always `true` | 15-18 | Covered | — |
| 38 | `dayOffset <= 3` and `minutesSinceLastPoll >= 30` → `true` | 19-22 | Covered | — |
| 39 | `dayOffset <= 3` and `minutesSinceLastPoll < 30` → `false` | 19-22 | Covered | — |
| 40 | `dayOffset > 3` and `minutesSinceLastPoll >= 600` → `true` | 24 | Covered | — |
| 41 | `dayOffset > 3` and `minutesSinceLastPoll < 600` → `false` | 24 | Covered | — |
| 42 | Boundary: `dayOffset === 1` (exactly at boundary) | 15 | Covered (`shouldPollDate(1, 0)`) | — |
| 43 | Boundary: `dayOffset === 3` (falls into `<= 3` branch) | 19 | Covered (`shouldPollDate(3, 30)`) | — |
| 44 | Boundary: `minutesSinceLastPoll === 30` (exactly at threshold) | 21 | Covered (`shouldPollDate(3, 30)`) | — |
| 45 | Boundary: `minutesSinceLastPoll === 600` (exactly at threshold) | 24 | Covered (`shouldPollDate(4, 600)`) | — |

### `getPollingDates` (lines 30-38)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 46 | Normal 7-day generation | 30-38 | Covered | — |
| 47 | Month boundary rollover (e.g. "2026-04-28" → crosses into May) | 30-38 | GAP | correctness |
| 48 | Year boundary rollover (e.g. "2026-12-28") | 30-38 | GAP | nice-to-have |

### `pollCourse` (lines 43-78)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 49 | No adapter found → logs error | 50-53 | Covered (`logs error when adapter is not found`) | — |
| 50 | Adapter returns empty array → logs `no_data` | 66-69 | Covered (`logs no_data when adapter returns empty array`) | — |
| 51 | Adapter returns tee times → upsert + log success | 64-73 | Covered (`fetches tee times and writes to db on success`) | — |
| 52 | Adapter throws → catch logs error with message | 74-77 | GAP | correctness |
| 53 | Adapter throws non-Error (e.g. string) → `String(err)` branch | 75 | GAP | nice-to-have |
| 54 | `JSON.parse(course.platform_config)` throws (malformed JSON) | 59 | GAP | correctness |
| 55 | Verifies `upsertTeeTimes` receives correct `now` timestamp | 72 | GAP | nice-to-have |

---

## File: `src/lib/cron-handler.ts` (99 lines)

### `shouldRunThisCycle` (lines 15-29)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 56 | 5am-10am CT → always true | 25 | Covered | — |
| 57 | 10am-2pm CT, minute % 10 < 5 → true | 26 | Covered | — |
| 58 | 10am-2pm CT, minute % 10 >= 5 → false | 26 | Covered | — |
| 59 | 2pm-8pm CT, minute % 15 < 5 → true | 27 | Covered | — |
| 60 | 2pm-8pm CT, minute % 15 >= 5 → false | 27 | Covered | — |
| 61 | 8pm-5am CT, minute < 5 → true | 28 | Covered | — |
| 62 | 8pm-5am CT, minute >= 5 → false | 28 | Covered | — |
| 63 | Boundary: hour 5 exactly (start of peak) | 25 | Covered | — |
| 64 | Boundary: hour 10 exactly (transition to 10-min) | 26 | Covered | — |
| 65 | Boundary: hour 14 exactly (transition to 15-min) | 27 | Covered | — |
| 66 | Boundary: hour 20 exactly (transition to hourly) | 28 | GAP | nice-to-have |
| 67 | Midnight (hour 0) | 28 | GAP | nice-to-have |

### `sleep` (lines 34-36)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 68 | Resolves after `ms` milliseconds | 34-36 | GAP | nice-to-have |

### `runCronPoll` (lines 41-99)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 69 | `shouldRunThisCycle` returns false → skip, return `{ skipped: true }` | 48-49 | GAP | correctness |
| 70 | No active courses → return `{ pollCount: 0, courseCount: 0 }` | 52-55, 98 | GAP | correctness |
| 71 | Active courses exist, dates generated, poll loop runs | 52-98 | GAP | correctness |
| 72 | `shouldPollDate` returns false for a date → skips that date | 86 | GAP | correctness |
| 73 | `shouldPollDate` returns true → calls `pollCourse` + sleeps | 87-93 | GAP | correctness |
| 74 | `lastPolled` is undefined → `minutesSinceLast = Infinity` | 82-84 | GAP | correctness |
| 75 | `lastPolled` exists → calculates minutes correctly | 82-84 | GAP | correctness |
| 76 | Rate limiting sleep (250ms between calls) | 93 | GAP | nice-to-have |
| 77 | DB query for courses fails (exception) | 52-54 | GAP | correctness |
| 78 | DB query for poll_log fails (exception) | 63-70 | GAP | correctness |

---

## File: `src/lib/db.ts` (64 lines) — NO TEST FILE

### `upsertTeeTimes` (lines 11-44)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 79 | Normal upsert: delete + insert batch | 18-43 | GAP | correctness |
| 80 | `tt.time` contains "T" → splits and takes time portion | 23-24 | GAP | correctness |
| 81 | `tt.time` does NOT contain "T" → uses as-is | 23-25 | GAP | correctness |
| 82 | Empty `teeTimes` array → only delete runs (no inserts) | 22-43 | GAP | correctness |
| 83 | `tt.price` is `null` → binds null | 37 | GAP | correctness |
| 84 | `db.batch()` fails → exception propagates | 43 | GAP | nice-to-have |

### `logPoll` (lines 49-64)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 85 | Normal insert with all fields | 57-63 | GAP | correctness |
| 86 | `errorMessage` is `undefined` → binds `null` | 62 | GAP | correctness |
| 87 | `errorMessage` is a string → binds string | 62 | GAP | nice-to-have |
| 88 | `.run()` fails → exception propagates | 63 | GAP | nice-to-have |

---

## File: `src/lib/favorites.ts` (28 lines) — NO TEST FILE

### `getFavorites` (lines 3-11)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 89 | SSR guard: `typeof window === "undefined"` → return `[]` | 4 | GAP | correctness |
| 90 | `localStorage.getItem` returns `null` → return `[]` | 6-7 | GAP | correctness |
| 91 | `localStorage.getItem` returns valid JSON array → parsed | 6-7 | GAP | correctness |
| 92 | `localStorage.getItem` returns malformed JSON → catch → `[]` | 8-9 | GAP | correctness |
| 93 | `localStorage.getItem` throws (e.g. security error) → catch → `[]` | 8-9 | GAP | nice-to-have |

### `setFavorites` (lines 13-15)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 94 | Normal set to localStorage | 14 | GAP | correctness |

### `toggleFavorite` (lines 17-23)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 95 | Course is currently a favorite → removes it | 19 | GAP | correctness |
| 96 | Course is NOT a favorite → adds it | 20 | GAP | correctness |

### `isFavorite` (lines 26-28)

| # | Code Path | Lines | Test Status | Severity |
|---|-----------|-------|-------------|----------|
| 97 | Course is in favorites → returns `true` | 27 | GAP | correctness |
| 98 | Course is NOT in favorites → returns `false` | 27 | GAP | correctness |

---

## Summary

### What's Well-Covered

- **CPS Golf adapter** has thorough happy-path and error-path tests including network errors, non-200 responses, missing config, and 9/18-hole branching.
- **ForeUp adapter** covers all major paths including null `green_fee`, missing `scheduleId`, network errors, and time format conversion.
- **`shouldPollDate`** and **`shouldRunThisCycle`** have excellent boundary-condition testing across all time windows and thresholds.

### Gap Counts by Severity

| Severity | Count |
|----------|-------|
| security-critical | 0 |
| correctness | 38 |
| nice-to-have | 20 |
| **Total** | **58** |

### Gaps Grouped by Severity

#### Correctness (38 gaps)

- **`src/lib/db.ts`** (6 gaps): Entirely untested. `upsertTeeTimes` time-parsing logic (lines 23-25), delete+insert batch, null price binding, empty array edge case. `logPoll` insert and null coalescing. (#79-86)
- **`src/lib/favorites.ts`** (10 gaps): Entirely untested. SSR guard, localStorage interactions, JSON parse safety, toggle add/remove, isFavorite. (#89-98)
- **`src/lib/cron-handler.ts` `runCronPoll`** (10 gaps): Only `shouldRunThisCycle` is tested. The main `runCronPoll` function has zero tests covering: skip path, no-courses path, poll loop, date filtering, minutesSinceLast calculation, DB query failures. (#69-78)
- **`src/adapters/index.ts`** (4 gaps): No test file. Adapter registry lookup for known and unknown platformIds untested. (#33-36)
- **`src/adapters/cps-golf.ts`** (3 gaps): Nullish `TeeTimes` array fallback, nullish `GreenFee` fallback, malformed JSON response. (#5, 6, 17)
- **`src/adapters/foreup.ts`** (3 gaps): Non-200 response path, non-numeric `green_fee` string producing NaN, malformed JSON response. (#22, 26, 29)
- **`src/lib/poller.ts`** (2 gaps): Adapter throw path in `pollCourse` (catch block), malformed `platform_config` JSON. Month boundary in `getPollingDates`. (#47, 52, 54)

#### Nice-to-Have (20 gaps)

- CPS Golf optional header presence/absence for `siteId`/`terminalId`/`websiteId` (#11, 12, 14)
- Unusual `Holes` values, `courseIds` nullish fallback (#9, 16)
- ForeUp `toIso` with unexpected input format (#32)
- `shouldRunThisCycle` at hour 20 and midnight boundaries (#66, 67)
- `sleep` helper, rate limiting sleep, year boundary in `getPollingDates` (#48, 68, 76)
- `pollCourse` non-Error throw branch, timestamp verification (#53, 55)
- `db.ts` batch/run failure propagation (#84, 88)
- `favorites.ts` localStorage security error (#93)
- `logPoll` with string errorMessage (#87)

### Key Observations

1. **Three files have zero test coverage**: `db.ts`, `favorites.ts`, and `adapters/index.ts`. Together they account for 20 correctness gaps. `db.ts` is particularly concerning because it contains the time-parsing logic (line 23-25) that silently transforms data.

2. **`runCronPoll` is the largest untested function in the codebase** (58 lines, 10 correctness gaps). It orchestrates the entire polling pipeline but has no dedicated tests — only its helper `shouldRunThisCycle` is tested.

3. **Both adapters lack tests for malformed API responses** (invalid JSON from `response.json()`). These would be caught by the catch block, but the specific behavior (returning `[]` vs. propagating) is unverified. The ForeUp adapter also has no test for non-200 HTTP responses, unlike CPS Golf which does.

4. **Cross-cutting pattern**: Error paths that return `[]` silently (adapters) or propagate exceptions (db.ts) create a fail-silent vs. fail-loud inconsistency that is only partially tested. The `pollCourse` catch block (line 74-77) is the bridge between these two patterns and is itself untested.
