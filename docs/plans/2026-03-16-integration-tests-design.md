# Integration Testing Infrastructure — Design Document

**Goal:** Add integration tests that catch real bugs our unit tests miss — broken SQL queries, stale API contracts, and data pipeline mismatches — without requiring manual verification.

**Motivation:** Multiple production bugs were only discovered through manual testing: the `no_data` freshness indicator bug (SQL query filtering), adapter breakages from API contract changes (ForeUp date format), and the `datetime()` vs `strftime()` comparison mismatch. All existing tests passed because they mock the database and HTTP layers.

---

## Architecture Overview

Three test categories, two execution modes:

| Category | What it tests | Runs when | Needs network |
|----------|--------------|-----------|---------------|
| **DB integration** | Real SQL queries against real SQLite | Every `npm test` | No |
| **Pipeline integration** | Fixture → adapter parse → real DB → real query | Every `npm test` | No |
| **API smoke + contract** | Real HTTP calls to booking platform APIs | PRs to main (path-filtered) | Yes |

**File naming convention:**
- `*.test.ts` — unit tests + DB/pipeline integration (all run in `npm test`)
- `*.smoke.test.ts` — API smoke tests (excluded from `npm test`, run via `npm run test:smoke`)

---

## Shared Infrastructure

### D1 Test Helper (`src/test/d1-test-helper.ts`)

A wrapper over `better-sqlite3` that matches D1's async chainable API. This lets integration tests pass a real SQLite database to our production code (which expects `D1Database`) without any code changes.

**D1 API surface to implement** (verified against `@cloudflare/workers-types` and Cloudflare docs):

| Method | D1 Return Type | Wrapper Behavior |
|--------|---------------|-----------------|
| `db.prepare(sql)` | `D1PreparedStatement` | Returns statement wrapper |
| `stmt.bind(...values)` | `D1PreparedStatement` (chainable) | Stores params, returns `this` |
| `stmt.first()` | `Promise<T \| null>` | Calls `better-sqlite3` `.get()`, coerces `undefined → null` |
| `stmt.all()` | `Promise<{ results: T[] }>` | Calls `.all()`, wraps in `{ results: [...] }` |
| `stmt.run()` | `Promise<{ meta: { changes } }>` | Calls `.run()`, wraps in `{ meta: { changes } }` |
| `db.batch(stmts[])` | `Promise<D1Result[]>` | Wraps all statements in a SQLite transaction |

**Critical: `PRAGMA foreign_keys = ON`** — D1 enforces foreign keys by default (per Cloudflare docs: "identical to setting `PRAGMA foreign_keys = on` for every transaction"). SQLite has them OFF by default. The wrapper MUST enable this pragma at database creation. Without it, CASCADE won't fire and FK violations will silently succeed, giving false confidence in FK-related tests.

**`createTestDb()` factory:**
1. Creates an in-memory `better-sqlite3` database (`:memory:`)
2. Enables `PRAGMA foreign_keys = ON`
3. Reads all files from `migrations/` directory, sorts by filename
4. Executes each migration in order
5. Returns the D1 wrapper (typed as `D1Database` via `as unknown as D1Database`)

Each test gets a fresh database via `beforeEach`.

**Seed helpers** (reduce boilerplate across test files):
- `seedCourse(db, overrides?)` — inserts a course with sensible defaults (id, name, city, platform, platform_config JSON, booking_url, is_active=1)
- `seedUser(db, overrides?)` — inserts a user with sensible defaults (id, google_id, email, name, created_at)

**Dependency:** `better-sqlite3` as devDependency. Ships prebuilt binaries for Linux x64 (CI) and Windows x64 (local dev) — verified on both platforms. If TypeScript types aren't bundled with the installed version, add `@types/better-sqlite3`.

**Note on `sqliteIsoNow()`:** This helper embeds `strftime()` expressions directly in SQL template literals. These execute natively in SQLite, so they work identically in `better-sqlite3` as in D1. No special handling needed.

---

## DB Integration Tests

Tests that run real SQL queries against real SQLite to verify query correctness. Each test mocks only `getCloudflareContext()` (same as existing unit tests) but passes the `better-sqlite3` wrapper instead of a mock D1. All SQL execution is real.

### File: `src/lib/db.integration.test.ts`

Tests for `upsertTeeTimes()`, `logPoll()`, and cross-cutting DB concerns.

| # | Scenario | What it catches |
|---|----------|----------------|
| 1 | `upsertTeeTimes` inserts tee times, queryable afterward | Basic write-read correctness |
| 2 | `upsertTeeTimes` replaces old data on re-upsert for same course+date | Delete+insert atomicity |
| 3 | `upsertTeeTimes` with empty array deletes existing rows | Ghost tee time cleanup |
| 4 | `logPoll` records entries with correct status values (success, no_data, error) | Poll log write correctness |
| 5 | Time extraction: `2026-03-16T08:30:00` stored as `08:30` | ISO → HH:MM parsing in upsertTeeTimes |
| 22 | Batch atomicity: constraint violation in INSERT rolls back preceding DELETE | Data loss on partial batch failure (see `dev/testing-pitfalls.md` §4) |
| 23 | `sqliteIsoNow` boundary: poll at exactly 24 hours ago — included or excluded | Freshness boundary precision |
| 25 | Time field without ISO separator: `"08:30"` stored correctly as `"08:30"` | The `tt.time.includes("T")` branch in upsertTeeTimes |
| 28 | FK enforcement is active: inserting a tee time for non-existent course fails | Verifies PRAGMA foreign_keys = ON |

**Batch atomicity test (scenario 22) — how to construct:**
1. Seed course A, insert 3 tee times via `upsertTeeTimes`
2. Call `upsertTeeTimes` again for course A with a TeeTime where `time` is null
3. The batch should fail (NOT NULL constraint on `tee_times.time`)
4. Query `tee_times` — original 3 rows should still be there (transaction rolled back)

### File: `src/app/api/courses/route.integration.test.ts`

Tests for the courses list SQL query (ROW_NUMBER window function, freshness).

| # | Scenario | What it catches |
|---|----------|----------------|
| 6 | ROW_NUMBER returns only the most recent poll per course | Window function partitioning correctness |
| 7 | `no_data` status polls appear in freshness results | The freshness bug we fixed (IN ('success', 'no_data')) |
| 8 | Multiple courses with mixed poll statuses return correct per-course freshness | Cross-course result isolation |
| 9 | Polls older than 24 hours are excluded | `sqliteIsoNow('-24 hours')` works with real `strftime()` |
| 29 | Course with zero poll history appears with null freshness fields | LEFT JOIN doesn't exclude unpollled courses |

### File: `src/app/api/courses/[id]/route.integration.test.ts`

Tests for the course detail SQL query.

| # | Scenario | What it catches |
|---|----------|----------------|
| 10 | Course detail returns correct single-course freshness | Detail query correctness |
| 11 | Non-existent course ID returns null (not crash) | LEFT JOIN on empty poll_log |

### File: `src/app/api/tee-times/route.integration.test.ts`

Tests for the tee times query with dynamic filter building.

| # | Scenario | What it catches |
|---|----------|----------------|
| 12 | Date filter returns only matching date's tee times | Basic date filtering |
| 13 | Course filter (IN clause) works with multiple IDs | Dynamic IN clause construction |
| 14 | Time range filter (startTime/endTime) with HH:MM comparison | String-based time range filtering |
| 15 | Holes filter (9 vs 18) | Integer equality filter |
| 16 | Results ordered by time ASC | ORDER BY correctness |
| 17 | Multi-course, multi-date seed returns correct cross-section | Combined data isolation |
| 30 | Combined filters (date + courses + startTime + holes) all active simultaneously | Dynamic SQL builder produces valid SQL for combinations |
| 31 | minSlots filter returns only tee times with sufficient open slots | open_slots >= ? filter |

### File: `src/lib/db.integration.test.ts` (continued) or separate housekeeping file

Housekeeping SQL tests. **Note:** The housekeeping queries are currently embedded inside `runCronPoll()` in `cron-handler.ts`. The implementation plan should extract them into testable functions in `db.ts` (e.g., `cleanupOldPolls(db)`, `deactivateStaleCourses(db)`, `cleanupExpiredSessions(db)`). This is a minor refactoring that makes them directly testable without mocking the entire cron orchestrator.

| # | Scenario | What it catches |
|---|----------|----------------|
| 18 | Poll log cleanup deletes entries older than 7 days | Unbounded table growth (see `dev/testing-pitfalls.md` §4) |
| 19 | Auto-deactivation: course with `last_had_tee_times` > 30 days ago → `is_active = 0` | Stale course detection |
| 20 | Auto-deactivation: course with `last_had_tee_times IS NULL` is NOT deactivated | The bug from migration 0005 — NULL means "never checked", not "stale" |
| 24 | Session cleanup: expired sessions deleted, active sessions preserved | Session table hygiene |

### File: `src/lib/db.integration.test.ts` (continued) — User data & constraints

| # | Scenario | What it catches |
|---|----------|----------------|
| 21 | Deleting a course cascades to user_favorites and booking_clicks | CASCADE FK behavior (validates "never hard-delete courses" rule) |
| 26 | Account lifecycle: create user → add favorites + booking clicks → delete user → all associated data gone | The promise made on the About page about account deletion |
| 27 | Account deletion preserves other users' data | CASCADE scoped to deleted user only |
| 32 | Duplicate favorite insert rejected by composite PK | `(user_id, course_id)` uniqueness |
| 33 | Duplicate booking click rejected by UNIQUE constraint | `(user_id, course_id, date, time)` uniqueness |

### File: `src/lib/rate-limit.integration.test.ts`

| # | Scenario | What it catches |
|---|----------|----------------|
| 34 | Per-course cooldown: poll within 30s rejected, poll after 30s allowed | `sqliteIsoNow('-30 seconds')` precision |
| 35 | Global rate cap: 21st poll within 60 seconds rejected | COUNT(*) + `sqliteIsoNow('-60 seconds')` |

---

## Pipeline Integration Tests

Test the full data flow: fixture → adapter parse → real DB write → real DB query → verify results. These exercise the seams between components rather than individual queries.

### File: `src/lib/poller.integration.test.ts`

**How they work:** Mock `globalThis.fetch` to return fixture data (same mocking as existing adapter unit tests), but pass the real `better-sqlite3` wrapper as the DB. The adapter parsing is real, the DB writes are real — only the HTTP layer is mocked.

The test constructs a `CourseRow` (with `platform_config` as a JSON string) matching a real course config. This exercises the `JSON.parse(course.platform_config)` seam inside `pollCourse()`.

**CPS Golf note:** Requires 3 sequential fetch mocks (token request, transaction registration, tee times). Use the same mock chain pattern as `src/adapters/cps-golf.test.ts`.

| # | Scenario | What it catches |
|---|----------|----------------|
| P1 | CPS Golf fixture → adapter parse → `upsertTeeTimes` → tee-times query → correct fields | Format mismatches between adapter output and DB storage |
| P2 | ForeUp fixture → same round-trip | Same |
| P3 | TeeItUp fixture → same round-trip | Same |
| P4 | Adapter returns tee times → `pollCourse` logs `success` → courses query shows freshness | Write path → read path consistency |
| P5 | Adapter returns empty → `pollCourse` logs `no_data` → courses query still shows freshness | The no_data freshness fix, tested end-to-end |
| P6 | Adapter throws → `pollCourse` logs `error` → courses query does NOT show error as freshness | Error polls excluded from freshness (only success/no_data qualify) |
| P7 | Poll twice for same course+date with different data → query returns only second set | Upsert replacement through full pipeline |
| P8 | Poll 3 courses (one per adapter) → unfiltered query returns all → filtered returns one | Multi-course data isolation |

**Future adapter stubs** (in the same file):

Each stub uses `describe.todo` with the platform name, course count, and reference to research docs:

```typescript
describe.todo('Chronogolf/Lightspeed pipeline (Mandatory: implement when adapter exists — 35 courses, see dev/research/remaining-platforms-investigation.md)');
describe.todo('GolfNow pipeline (Mandatory: implement when adapter exists — 6 courses, API research not yet conducted)');
describe.todo('Teesnap pipeline (Mandatory: implement when adapter exists — 3 courses, API research not yet conducted)');
describe.todo('Eagle Club Systems pipeline (Mandatory: implement when adapter exists — 1 course, see dev/research/remaining-platforms-investigation.md)');
describe.todo('EZLinks pipeline (Mandatory: implement when adapter exists — 1 course, API research not yet conducted)');
describe.todo('City/Custom pipeline (Mandatory: implement when adapter exists — 3 courses, API research not yet conducted)');
```

---

## API Smoke & Contract Tests

Hit real booking platform APIs to detect when external contracts change. These catch the class of bugs where our fixtures are stale, unit tests pass, but production adapters break.

### Test Courses

Hardcoded in test files, decoupled from `courses.json`. Each adapter has a primary and fallback course. If the primary returns no tee times (legitimate — course may be fully booked), the fallback is tried. If both return empty, smoke passes but contract validation is skipped with a logged warning.

| Adapter | Primary | Fallback | Rationale |
|---------|---------|----------|-----------|
| CPS Golf | Encinitas Ranch (`jcgsc5`) | Twin Oaks (`jcgsc5`) | SD test courses, same subdomain, different courseIds |
| ForeUp | Torrey Pines (19347) | Balboa Park (19348) | High-traffic courses, likely to have availability |
| TeeItUp | Coronado | Lomas Santa Fe | SD test courses with known aliases |

**Date selection:** Use a date 5 days from now. Most courses have tee times available that far out.

**No secrets needed:** All three APIs are public (CPS Golf uses a discoverable API key, ForeUp uses `api_key=no_limits`, TeeItUp has no auth).

**CPS Golf proxy note:** The Lambda proxy (`FETCH_PROXY_URL`) is a workaround for Cloudflare Workers fetch restrictions. Smoke tests run in Node.js where direct fetch works. Don't set proxy env vars — let the adapter use direct fetch.

### Three Assertion Levels

#### Level 1 — Smoke (adapter doesn't throw)

```
Call adapter.fetchTeeTimes() with test course config and date 5 days out
Assert: returns TeeTime[] (possibly empty)
Assert: completes within 15 seconds
Assert: no unhandled exceptions
```

This catches: API URL changes, auth flow changes, server errors, DNS failures.

#### Level 2 — Contract (raw API response matches expected schema)

Capture raw HTTP responses using a recording fetch wrapper:

```typescript
// Install before adapter call:
const captured: { url: string; body: unknown }[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init?) => {
  const response = await originalFetch(input, init);
  const clone = response.clone();
  try {
    captured.push({ url: String(input), body: await clone.json() });
  } catch { /* non-JSON response, skip */ }
  return response;
};

// Call adapter.fetchTeeTimes() — it runs its real code path
// Inspect `captured` for contract validation
// MUST restore originalFetch in afterEach (not just at end of test)
```

**Clear the `captured` array between primary and fallback attempts** — otherwise you'd validate the wrong response.

For CPS Golf (3 sequential calls), validate the tee times response (identifiable by URL containing the tee times endpoint path). For ForeUp/TeeItUp (single call), validate the only captured response.

**Contract assertions per adapter:**

**CPS Golf:**
- Response has `TeeTimes` array
- Each entry has `TeeTimeStr` matching a date-time pattern
- Each entry has `Rates` array; each rate has `GreenFee` as number
- Each entry has `MinPlayer`, `MaxPlayer` as integers

**ForeUp:**
- Response is an array of objects
- Each entry has `time` matching `YYYY-MM-DD HH:MM` (catches date format drift)
- Each entry has `green_fee` as string or null
- Each entry has `available_spots` as number
- Each entry has `holes` as number

**TeeItUp:**
- Response has `teetimes` array
- Each entry has `teetime` as ISO 8601 UTC string
- Each entry has `rates` array; each rate has `greenFee` as integer (cents)
- Each entry has `maxPlayers` as integer

When contract validation fails, the error message must be specific and actionable:
> "ForeUp contract violation: `date` field expected format YYYY-MM-DD HH:MM, got '03-16-2026 08:30'"

#### Level 3 — Output Validation (parsed TeeTime objects have valid fields)

```
For each TeeTime in result:
  Assert: courseId === test course ID
  Assert: time matches /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
  Assert: new Date(time) is valid (not NaN)
  Assert: price is number or null (not NaN, not undefined)
  Assert: holes is exactly 9 or 18
  Assert: openSlots is a non-negative integer (≥ 0)
  Assert: bookingUrl is a non-empty string
```

### File Locations

One file per adapter, collocated with the adapter source:

- `src/adapters/cps-golf.smoke.test.ts`
- `src/adapters/foreup.smoke.test.ts`
- `src/adapters/teeitup.smoke.test.ts`

### Stub Files (future adapters)

Each stub contains ABOUTME comments, a reference to research docs, and `describe.todo` blocks:

```typescript
// ABOUTME: Smoke tests for [Platform] adapter (not yet implemented).
// ABOUTME: See dev/research/[file].md for API details. (or: API research not yet conducted)

describe.todo('[Platform] - live API smoke tests (Mandatory: implement when adapter exists — N courses)');
describe.todo('[Platform] - API contract validation (Mandatory: implement when adapter exists)');
describe.todo('[Platform] - parsed output validation (Mandatory: implement when adapter exists)');
```

Stub files:
- `src/adapters/chronogolf.smoke.test.ts` — 35 courses, see `dev/research/remaining-platforms-investigation.md`
- `src/adapters/golfnow.smoke.test.ts` — 6 courses, API research not yet conducted
- `src/adapters/teesnap.smoke.test.ts` — 3 courses, API research not yet conducted
- `src/adapters/eagle-club.smoke.test.ts` — 1 course, see `dev/research/remaining-platforms-investigation.md`
- `src/adapters/ezlinks.smoke.test.ts` — 1 course, API research not yet conducted
- `src/adapters/city-custom.smoke.test.ts` — 3 courses, API research not yet conducted

---

## CI Wiring & Configuration

### Vitest Configuration

**`vitest.config.ts`** (existing, modified):

Add an exclude so smoke tests don't run in `npm test`:
```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/*.test.{ts,tsx}"],
  exclude: ["src/**/*.smoke.test.{ts,tsx}"], // Run via: npm run test:smoke
  pool: "forks",
},
```

**`vitest.smoke.config.ts`** (new):
```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/*.smoke.test.{ts,tsx}"],
  testTimeout: 30000,  // 30 seconds — real API calls can be slow
  pool: "forks",
  poolOptions: { forks: { singleFork: true } },  // Sequential — don't hammer APIs
},
resolve: {
  alias: { "@": path.resolve(__dirname, "src") },
},
```

### npm Scripts

```json
"test": "vitest run",                                          // unchanged
"test:watch": "vitest watch",                                  // unchanged
"test:smoke": "vitest run --config vitest.smoke.config.ts"     // new
```

### CI Workflows

**`.github/workflows/ci.yml`** (existing, unchanged):

The existing `test` job runs `npm test`, which now includes DB and pipeline integration tests alongside unit tests. `better-sqlite3` installs via `npm ci`. Integration tests use in-memory SQLite and add negligible time (~10-20 seconds).

**`.github/workflows/smoke-tests.yml`** (new):

```yaml
name: API Smoke Tests

on:
  pull_request:
    branches: [main]
    paths:
      - 'src/adapters/**'
      - 'src/lib/proxy-fetch.ts'
      - 'src/types/**'
      - 'package.json'
      - 'package-lock.json'
      - 'vitest.smoke.config.ts'
      - '.github/workflows/smoke-tests.yml'

jobs:
  smoke-test:
    name: Adapter Smoke Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run test:smoke
```

**Not a required status check** — transient API outages shouldn't block PR merges. The check appears on PRs when relevant paths change, and the PR author investigates failures.

### New Dependency

`better-sqlite3` as devDependency. Ships prebuilt binaries for both CI (Linux x64) and local dev (Windows x64). If TypeScript types aren't bundled with the installed version, also add `@types/better-sqlite3`.

### Summary: What Runs Where

| Command | What runs | When | Network |
|---------|-----------|------|---------|
| `npm test` | Unit tests + DB/pipeline integration | Every push, every PR, local dev | No |
| `npm run test:smoke` | API smoke + contract tests | PRs to main (path-filtered) | Yes |
| `npm run test:watch` | Unit + integration in watch mode | Local dev | No |

---

## Implementation Notes

### Housekeeping SQL Extraction

The housekeeping queries (poll_log cleanup, auto-deactivation, session cleanup) are currently embedded inside `runCronPoll()` in `src/lib/cron-handler.ts`. Extract them into named functions in `src/lib/db.ts`:

- `cleanupOldPolls(db: D1Database): Promise<number>` — deletes poll_log entries older than 7 days, returns count
- `deactivateStaleCourses(db: D1Database): Promise<number>` — deactivates courses with no tee times for 30 days, returns count
- `cleanupExpiredSessions(db: D1Database): Promise<number>` — deletes expired sessions, returns count

Then call these from `runCronPoll()`. This is a minor refactoring — the SQL and behavior are unchanged, but the functions become directly testable.

### Recording Fetch Wrapper

The fetch interception pattern for Level 2 contract validation:

1. `beforeEach`: save `originalFetch = globalThis.fetch`
2. Before adapter call: install recording wrapper, initialize empty `captured` array
3. Call `adapter.fetchTeeTimes()` — wrapper records raw responses
4. Validate `captured` responses against schema
5. `afterEach`: **always** restore `globalThis.fetch = originalFetch` (even on test failure)

Clear `captured` between primary and fallback course attempts.

### TypeScript Typing for the Wrapper

The wrapper class won't extend `D1Database` (it's an abstract class in `@cloudflare/workers-types`). Use type assertion: `return wrapper as unknown as D1Database`. This is safe because the wrapper implements the exact API surface our code uses.

### Test Isolation

Each test gets a fresh in-memory database via `beforeEach(() => { db = createTestDb(); })`. Tests cannot interfere with each other. No cleanup needed — the in-memory DB is garbage collected when the reference is released.

---

## Test Scenario Index

Total: 35 DB integration + 8 pipeline integration + 3×3 smoke test levels + 6 pipeline stubs + 6 smoke stubs.

### DB Integration (35 scenarios)

| # | File | Scenario |
|---|------|----------|
| 1 | db.integration | upsertTeeTimes inserts, queryable afterward |
| 2 | db.integration | upsertTeeTimes replaces on re-upsert |
| 3 | db.integration | upsertTeeTimes with empty array deletes existing |
| 4 | db.integration | logPoll records correct status values |
| 5 | db.integration | Time extraction: ISO → HH:MM |
| 6 | courses/route.integration | ROW_NUMBER returns most recent poll per course |
| 7 | courses/route.integration | no_data polls appear in freshness |
| 8 | courses/route.integration | Multi-course mixed statuses, correct per-course freshness |
| 9 | courses/route.integration | Polls older than 24h excluded |
| 10 | courses/[id]/route.integration | Course detail returns correct freshness |
| 11 | courses/[id]/route.integration | Non-existent course returns null |
| 12 | tee-times/route.integration | Date filter |
| 13 | tee-times/route.integration | Course filter (IN clause) |
| 14 | tee-times/route.integration | Time range filter |
| 15 | tee-times/route.integration | Holes filter |
| 16 | tee-times/route.integration | ORDER BY time ASC |
| 17 | tee-times/route.integration | Multi-course multi-date cross-section |
| 18 | db.integration (housekeeping) | Poll log cleanup (> 7 days) |
| 19 | db.integration (housekeeping) | Auto-deactivation (> 30 days no tee times) |
| 20 | db.integration (housekeeping) | NULL last_had_tee_times NOT deactivated |
| 21 | db.integration (cascade) | Course delete cascades to favorites + clicks |
| 22 | db.integration (atomicity) | Batch constraint violation rolls back DELETE |
| 23 | db.integration (boundary) | sqliteIsoNow 24-hour boundary precision |
| 24 | db.integration (housekeeping) | Session cleanup: expired deleted, active preserved |
| 25 | db.integration | Time field without T separator stored correctly |
| 26 | db.integration (lifecycle) | Account lifecycle: create → favorites + clicks → delete → all gone |
| 27 | db.integration (lifecycle) | Account deletion preserves other users' data |
| 28 | db.integration (FK) | FK enforcement active: tee time for non-existent course fails |
| 29 | courses/route.integration | Course with zero poll history has null freshness |
| 30 | tee-times/route.integration | Combined filters produce valid SQL |
| 31 | tee-times/route.integration | minSlots filter |
| 32 | db.integration (constraint) | Duplicate favorite rejected by PK |
| 33 | db.integration (constraint) | Duplicate booking click rejected by UNIQUE |
| 34 | rate-limit.integration | Per-course cooldown (30s window) |
| 35 | rate-limit.integration | Global rate cap (20 per 60s) |

### Pipeline Integration (8 scenarios + 6 stubs)

| # | Scenario |
|---|----------|
| P1 | CPS Golf fixture → full round-trip |
| P2 | ForeUp fixture → full round-trip |
| P3 | TeeItUp fixture → full round-trip |
| P4 | Success poll → freshness visible |
| P5 | Empty poll → no_data freshness visible |
| P6 | Error poll → excluded from freshness |
| P7 | Re-poll replaces data |
| P8 | Multi-course isolation |
| — | 6 future adapter stubs (Chronogolf, GolfNow, Teesnap, Eagle Club, EZLinks, City/Custom) |

### API Smoke (3 adapters × 3 levels + 6 stubs)

| Adapter | Level 1 (Smoke) | Level 2 (Contract) | Level 3 (Output) |
|---------|----------------|-------------------|-----------------|
| CPS Golf | ✓ | ✓ | ✓ |
| ForeUp | ✓ | ✓ | ✓ |
| TeeItUp | ✓ | ✓ | ✓ |
| Chronogolf | stub | stub | stub |
| GolfNow | stub | stub | stub |
| Teesnap | stub | stub | stub |
| Eagle Club | stub | stub | stub |
| EZLinks | stub | stub | stub |
| City/Custom | stub | stub | stub |
