# SQLite Datetime Format Fix & Auto-Deactivation NULL Safety

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two production bugs: (1) SQLite `datetime()` format mismatch that breaks all time-based comparisons, and (2) auto-deactivation incorrectly targeting courses with NULL `last_had_tee_times`.

**Architecture:** Replace all `datetime('now', '...')` calls in SQL with a `sqliteIsoNow()` helper that generates `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '...')`, matching the ISO 8601 format produced by JavaScript's `new Date().toISOString()`. Fix auto-deactivation WHERE clause to require `last_had_tee_times IS NOT NULL`. Add migration to re-activate incorrectly deactivated courses.

**Tech Stack:** TypeScript, Vitest, Cloudflare D1 (SQLite), Next.js App Router

**Root Cause:** JavaScript's `toISOString()` produces `2026-03-11T07:50:00.000Z` (with `T` separator). SQLite's `datetime()` produces `2026-03-11 07:50:00` (with space separator). Since `T` (ASCII 84) > space (ASCII 32), lexicographic comparisons like `polled_at > datetime('now', '-30 seconds')` are **always true** (every stored ISO timestamp appears "greater than" the datetime result). This breaks rate limiting (always locked), poll_log cleanup (never deletes), and session cleanup (never deletes).

---

### Task 1: Add `sqliteIsoNow()` helper to `src/lib/db.ts`

**Files:**
- Modify: `src/lib/db.ts` (add export at end of file)
- Create: `src/lib/db.test.ts` (new test file)

**Context:** `src/lib/db.ts` currently exports `upsertTeeTimes` and `logPoll`. We're adding a third export: a pure function that returns a SQL fragment string. This is NOT a database query — it returns a string like `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 seconds')` that gets embedded into SQL queries in other files.

**Step 1: Write the failing test**

Create `src/lib/db.test.ts`:

```typescript
// ABOUTME: Tests for the sqliteIsoNow SQL fragment helper.
// ABOUTME: Verifies it produces strftime expressions matching JS ISO 8601 format.
import { describe, it, expect } from "vitest";
import { sqliteIsoNow } from "./db";

describe("sqliteIsoNow", () => {
  it("returns strftime expression with no modifier", () => {
    expect(sqliteIsoNow()).toBe("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });

  it("returns strftime expression with a modifier", () => {
    expect(sqliteIsoNow("-30 seconds")).toBe(
      "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 seconds')"
    );
  });

  it("returns strftime expression with days modifier", () => {
    expect(sqliteIsoNow("-7 days")).toBe(
      "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')"
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/db.test.ts`
Expected: FAIL — `sqliteIsoNow` is not exported from `./db`

**Step 3: Write minimal implementation**

Add to the end of `src/lib/db.ts` (after the `logPoll` function, before the final newline):

```typescript
/**
 * SQL fragment for ISO 8601 "now" timestamps compatible with JS toISOString().
 *
 * SQLite's datetime() returns "YYYY-MM-DD HH:MM:SS" (space separator) but
 * JS toISOString() returns "YYYY-MM-DDTHH:MM:SS.sssZ" (T separator).
 * Lexicographic comparisons between these formats produce wrong results
 * because 'T' (ASCII 84) > ' ' (ASCII 32).
 *
 * This helper returns a strftime() expression that produces ISO 8601 format,
 * ensuring correct comparisons with stored JS timestamps.
 */
export function sqliteIsoNow(modifier?: string): string {
  if (modifier) {
    return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${modifier}')`;
  }
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/db.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat: add sqliteIsoNow() helper for ISO 8601 SQL timestamps"
```

---

### Task 2: Fix datetime calls in `src/lib/cron-handler.ts`

**Files:**
- Modify: `src/lib/cron-handler.ts` (4 `datetime()` calls + 1 `IS NULL` fix)
- Modify: `src/lib/cron-handler.test.ts` (update existing assertions + add new tests)

**Context:** `src/lib/cron-handler.ts` has 4 uses of `datetime()` and one incorrect `IS NULL` in the auto-deactivation clause. All `datetime()` calls must be replaced with `sqliteIsoNow()`. The `IS NULL` must be removed and replaced with `IS NOT NULL`.

**There are two bugs to fix in this file:**

1. **datetime format mismatch** — All 4 `datetime()` calls produce space-separated timestamps that compare incorrectly against ISO timestamps stored by `logPoll()`.

2. **NULL auto-deactivation** — Line 166: `AND (last_had_tee_times IS NULL OR last_had_tee_times < datetime('now', '-30 days'))` deactivates courses that have NEVER had tee times (NULL). The correct semantics is: only deactivate courses that STOPPED having tee times (have a timestamp, but it's old). Courses with NULL should be left alone — they haven't been proven inactive yet.

**Step 1: Write/update failing tests**

In `src/lib/cron-handler.test.ts`, make these changes:

**(a)** Add import for `sqliteIsoNow`:

At the top of the file, after the existing imports, add:
```typescript
import { sqliteIsoNow } from "@/lib/db";
```

**(b)** Update the session cleanup assertion (around line 86-88):

Change:
```typescript
    expect(sessionCleanup).toBe(
      "DELETE FROM sessions WHERE expires_at < datetime('now')"
    );
```
To:
```typescript
    expect(sessionCleanup).toBe(
      `DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`
    );
```

**(c)** Add new test for poll_log cleanup format in the "runCronPoll cleanup" describe block (after the "does not error when sessions table is empty" test):

```typescript
  it("uses ISO format for poll_log cleanup", async () => {
    await runCronPoll(mockDb as unknown as D1Database);

    const pollLogCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM poll_log")
    );
    expect(pollLogCleanup).toBe(
      `DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`
    );
  });
```

**(d)** Add new test for batch poll query format in the "runCronPoll cleanup" describe block:

```typescript
  it("uses ISO format for recent polls batch query", async () => {
    await runCronPoll(mockDb as unknown as D1Database);

    const batchQuery = preparedStatements.find(
      (sql) => sql.includes("MAX(polled_at)") && sql.includes("poll_log")
    );
    expect(batchQuery).toContain(sqliteIsoNow("-24 hours"));
  });
```

**(e)** Add new test in the "runCronPoll auto-active management" describe block for NULL safety:

```typescript
  it("does not deactivate courses with NULL last_had_tee_times", async () => {
    const courseWithNull = {
      ...activeCourse,
      id: "test-null-lhtt",
      last_had_tee_times: null,
    };
    const db = makeMockDb([courseWithNull]);
    await runCronPoll(db as unknown as D1Database);

    const deactivateSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 0")
    );
    // The deactivation SQL must require IS NOT NULL — courses with NULL
    // last_had_tee_times have never been proven inactive and must not
    // be deactivated.
    expect(deactivateSql).toContain("last_had_tee_times IS NOT NULL");
    expect(deactivateSql).not.toContain("IS NULL OR");
  });
```

**(f)** Update the existing deactivation test assertion (around line 236-239) to also verify ISO format:

Change:
```typescript
    const deactivateSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 0") && sql.includes("-30 days")
    );
    expect(deactivateSql).toBeDefined();
```
To:
```typescript
    const deactivateSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 0") && sql.includes("-30 days")
    );
    expect(deactivateSql).toBeDefined();
    expect(deactivateSql).toContain(sqliteIsoNow("-30 days"));
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: Multiple FAILs — tests expect `strftime(...)` but code still uses `datetime(...)`

**Step 3: Update `src/lib/cron-handler.ts`**

**(a)** Add import at the top of the file, after the existing imports:

```typescript
import { sqliteIsoNow } from "@/lib/db";
```

**(b)** Replace line 78 (inside the batch poll query):

Change:
```
       WHERE polled_at > datetime('now', '-24 hours')
```
To:
```
       WHERE polled_at > ${sqliteIsoNow("-24 hours")}
```

The full query string on lines 76-80 becomes a template literal. Change the backtick-quoted SQL from:
```typescript
      `SELECT course_id, date, MAX(polled_at) as last_polled
       FROM poll_log
       WHERE polled_at > datetime('now', '-24 hours')
       GROUP BY course_id, date`
```
To:
```typescript
      `SELECT course_id, date, MAX(polled_at) as last_polled
       FROM poll_log
       WHERE polled_at > ${sqliteIsoNow("-24 hours")}
       GROUP BY course_id, date`
```

**(c)** Replace lines 164-166 (auto-deactivation query):

Change:
```typescript
        `UPDATE courses SET is_active = 0
         WHERE is_active = 1
           AND (last_had_tee_times IS NULL OR last_had_tee_times < datetime('now', '-30 days'))`
```
To:
```typescript
        `UPDATE courses SET is_active = 0
         WHERE is_active = 1
           AND last_had_tee_times IS NOT NULL
           AND last_had_tee_times < ${sqliteIsoNow("-30 days")}`
```

**(d)** Replace line 179 (poll_log cleanup):

Change:
```typescript
      .prepare("DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')")
```
To:
```typescript
      .prepare(`DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`)
```

**(e)** Replace line 188 (session cleanup):

Change:
```typescript
      .prepare("DELETE FROM sessions WHERE expires_at < datetime('now')")
```
To:
```typescript
      .prepare(`DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`)
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "fix: use ISO format in cron SQL queries, fix NULL auto-deactivation"
```

---

### Task 3: Fix datetime calls in `src/lib/rate-limit.ts`

**Files:**
- Modify: `src/lib/rate-limit.ts` (2 `datetime()` calls)
- Modify: `src/lib/rate-limit.test.ts` (update assertions)

**Context:** `src/lib/rate-limit.ts` has 2 uses of `datetime()` in SQL queries: one for per-course cooldown (line 22) and one for global rate limit (line 36). Both must use `sqliteIsoNow()` instead. The existing tests check that the SQL contains the interval strings (e.g. `-30 seconds`), which will still be true after the fix — but we should also verify the strftime format is used.

**Step 1: Update tests**

In `src/lib/rate-limit.test.ts`:

**(a)** Add import at the top, after existing imports:
```typescript
import { sqliteIsoNow } from "@/lib/db";
```

**(b)** Update the "queries use correct cooldown intervals" test (around lines 51-63). Add strftime format checks after the existing assertions. Change:

```typescript
  it("queries use correct cooldown intervals", async () => {
    const db = mockDb({ courseRecent: false, globalCount: 0 });
    await checkRefreshAllowed(db, "sd-oceanside");

    // First prepare call: per-course cooldown query
    const courseQuery = db.prepare.mock.calls[0][0] as string;
    expect(courseQuery).toContain(`-${COURSE_COOLDOWN_SECONDS} seconds`);
    expect(courseQuery).not.toContain("date =");

    // Second prepare call: global rate limit query
    const globalQuery = db.prepare.mock.calls[1][0] as string;
    expect(globalQuery).toContain("-60 seconds");
  });
```

To:

```typescript
  it("queries use correct cooldown intervals", async () => {
    const db = mockDb({ courseRecent: false, globalCount: 0 });
    await checkRefreshAllowed(db, "sd-oceanside");

    // First prepare call: per-course cooldown query
    const courseQuery = db.prepare.mock.calls[0][0] as string;
    expect(courseQuery).toContain(
      sqliteIsoNow(`-${COURSE_COOLDOWN_SECONDS} seconds`)
    );
    expect(courseQuery).not.toContain("date =");

    // Second prepare call: global rate limit query
    const globalQuery = db.prepare.mock.calls[1][0] as string;
    expect(globalQuery).toContain(sqliteIsoNow("-60 seconds"));
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/rate-limit.test.ts`
Expected: FAIL — test expects `strftime(...)` but code still uses `datetime(...)`

**Step 3: Update `src/lib/rate-limit.ts`**

**(a)** Add import at top of file, between the ABOUTME comments and the `export const COURSE_COOLDOWN_SECONDS` line:

```typescript
import { sqliteIsoNow } from "@/lib/db";
```

**(b)** Update the comment above the query (lines 16-18) and replace the query (line 22):

Find this block:
```typescript
  // Per-course cooldown: any date
  // Note: COURSE_COOLDOWN_SECONDS is interpolated (not bound) because SQLite's
  // datetime() modifier string cannot accept parameter bindings. The value is a
  // module-level constant, not user input.
  const recentPoll = await db
    .prepare(
      `SELECT polled_at FROM poll_log
       WHERE course_id = ? AND polled_at > datetime('now', '-${COURSE_COOLDOWN_SECONDS} seconds')
       ORDER BY polled_at DESC LIMIT 1`
    )
```
Replace with:
```typescript
  // Per-course cooldown: any date
  // Note: COURSE_COOLDOWN_SECONDS is interpolated (not bound) because SQLite's
  // strftime() modifier string cannot accept parameter bindings. The value is a
  // module-level constant, not user input.
  const recentPoll = await db
    .prepare(
      `SELECT polled_at FROM poll_log
       WHERE course_id = ? AND polled_at > ${sqliteIsoNow(`-${COURSE_COOLDOWN_SECONDS} seconds`)}
       ORDER BY polled_at DESC LIMIT 1`
    )
```

The only change in the comment is `datetime()` → `strftime()` on line 17. The query change is `datetime('now', '...')` → `${sqliteIsoNow(...)}`.

**(c)** Replace line 36 (global rate limit query):

Change:
```typescript
      `SELECT COUNT(*) as cnt FROM poll_log
       WHERE polled_at > datetime('now', '-60 seconds')`
```
To:
```typescript
      `SELECT COUNT(*) as cnt FROM poll_log
       WHERE polled_at > ${sqliteIsoNow("-60 seconds")}`
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rate-limit.test.ts`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/rate-limit.test.ts
git commit -m "fix: use ISO format in rate-limit SQL queries"
```

---

### Task 4: Fix datetime calls in API route files

**Files:**
- Modify: `src/app/api/courses/route.ts` (1 `datetime()` call)
- Modify: `src/app/api/courses/[id]/route.ts` (1 `datetime()` call)

**Context:** Both API routes use `datetime('now', '-24 hours')` in a subquery that finds the most recent successful poll. These are read-only display queries (for showing "last polled" status), but they still need the format fix so the 24-hour window filter works correctly.

These files have no existing test files. We will NOT create tests for these — the queries are simple SQL and the datetime fix is mechanical. The regression guard test in Task 5 scans all non-test `.ts` files under `src/` for `datetime('now` and fails if any are found, which prevents future reintroduction of the broken pattern in these or any other files.

**Step 1: Update `src/app/api/courses/route.ts`**

**(a)** Add import at top of file, after the existing imports:

```typescript
import { sqliteIsoNow } from "@/lib/db";
```

**(b)** Replace `datetime('now', '-24 hours')` in the SQL query (line 21):

Change:
```
           WHERE polled_at > datetime('now', '-24 hours')
```
To:
```
           WHERE polled_at > ${sqliteIsoNow("-24 hours")}
```

The query is already a template literal (backtick string), so the interpolation will work.

**Step 2: Update `src/app/api/courses/[id]/route.ts`**

**(a)** Add import at top of file, after the existing imports:

```typescript
import { sqliteIsoNow } from "@/lib/db";
```

**(b)** Replace `datetime('now', '-24 hours')` in the SQL query (line 25):

Change:
```
           WHERE polled_at > datetime('now', '-24 hours')
```
To:
```
           WHERE polled_at > ${sqliteIsoNow("-24 hours")}
```

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS (no tests directly cover these routes, but ensures nothing broke)

**Step 4: Commit**

```bash
git add src/app/api/courses/route.ts src/app/api/courses/\[id\]/route.ts
git commit -m "fix: use ISO format in course API SQL queries"
```

---

### Task 5: Add regression guard and comparison verification tests

**Depends on:** Tasks 2, 3, and 4 must be completed first. The regression guard test scans source files for `datetime('now` — if those files haven't been fixed yet, the test will fail.

**Files:**
- Modify: `src/lib/db.test.ts` (add regression guard + comparison tests)

**Context:** We need tests that prevent reintroduction of `datetime('now` in SQL and verify that the strftime output format sorts correctly against `toISOString()` output.

**Step 1: Add regression and format tests**

Append these tests to `src/lib/db.test.ts` (after the existing `describe("sqliteIsoNow", ...)` block):

```typescript
describe("sqliteIsoNow format verification", () => {
  it("produces format that lexicographically sorts with toISOString()", () => {
    // The strftime format '%Y-%m-%dT%H:%M:%fZ' produces e.g. "2026-03-11T12:00:00.000Z"
    // JS toISOString() produces e.g. "2026-03-11T12:00:00.000Z"
    // Both use 'T' separator and 'Z' suffix, so lexicographic comparison works.
    const jsTimestamp = new Date("2026-03-11T12:00:00Z").toISOString();
    // Simulate what strftime would produce for the same instant
    const strftimeOutput = "2026-03-11T12:00:00.000Z";
    expect(jsTimestamp).toBe(strftimeOutput);
  });

  it("T-separated timestamps sort correctly (unlike space-separated)", () => {
    const jsTimestamp = "2026-03-11T12:00:00.000Z"; // from toISOString()
    const sqliteDatetime = "2026-03-11 12:30:00";    // from datetime()
    const sqliteStrftime = "2026-03-11T12:30:00.000Z"; // from strftime ISO

    // BUG: space-separated datetime is ALWAYS less than T-separated JS timestamp
    // because space (ASCII 32) < 'T' (ASCII 84). This means:
    //   "polled_at > datetime('now', '-30 seconds')" is ALWAYS TRUE
    expect(jsTimestamp > sqliteDatetime).toBe(true); // always true = broken

    // FIX: strftime ISO format sorts correctly
    expect(jsTimestamp > sqliteStrftime).toBe(false); // 12:00 < 12:30 = correct
    expect(jsTimestamp < sqliteStrftime).toBe(true);  // 12:00 < 12:30 = correct
  });
});

describe("regression guard: no raw datetime('now in SQL", () => {
  it("no source files use datetime('now' in SQL queries", async () => {
    const fs = await import("fs");
    const path = await import("path");

    // Recursively find all .ts files under src/, excluding test files
    function findTsFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...findTsFiles(full));
        } else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          files.push(full);
        }
      }
      return files;
    }

    const srcDir = path.resolve(process.cwd(), "src");
    const tsFiles = findTsFiles(srcDir);
    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes("datetime('now")) {
        violations.push(path.relative(srcDir, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/db.test.ts`
Expected: ALL tests PASS (at this point, all source files should be using `sqliteIsoNow`)

**Step 3: Commit**

```bash
git add src/lib/db.test.ts
git commit -m "test: add regression guard against datetime() and format verification"
```

---

### Task 6: Add migration to re-activate incorrectly deactivated courses

**Files:**
- Create: `migrations/0005_reactivate_courses.sql`

**Context:** Migration 0003 added `last_had_tee_times` column (defaulting to NULL) and set `is_active = 1` for all courses. But the first cron cycle's auto-deactivation query had `last_had_tee_times IS NULL`, immediately deactivating every course. This migration re-activates all courses so cron can repopulate `last_had_tee_times` correctly.

Note: This is an idempotent migration — running it when courses are already active is harmless (sets `is_active = 1` on rows that already have `is_active = 1`).

**Step 1: Create migration file**

Create `migrations/0005_reactivate_courses.sql`:

```sql
-- Re-activate all courses that were incorrectly deactivated.
-- Bug: auto-deactivation WHERE clause included "last_had_tee_times IS NULL",
-- which deactivated courses on their first cron cycle before they had a chance
-- to record any tee times. Combined with the datetime() format mismatch bug,
-- this deactivated every course in production.
UPDATE courses SET is_active = 1;
```

**Step 2: Commit**

```bash
git add migrations/0005_reactivate_courses.sql
git commit -m "fix: migration to re-activate incorrectly deactivated courses"
```

---

### Task 7: Update CLAUDE.md with datetime convention

**Files:**
- Modify: `CLAUDE.md` (add gotcha entry)

**Context:** `CLAUDE.md` has a "Gotchas" section with project-specific warnings. We need to add a gotcha about never using `datetime()` in SQL when comparing against JS timestamps.

**Step 1: Add gotcha**

In `CLAUDE.md`, find the line:
```
- **Cookie prefix `tct-`**: All app cookies use this prefix (`tct-session`, `tct-refresh`, `tct-oauth-state`, `tct-oauth-verifier`).
```

Add the following new entry **immediately after** that line (it becomes the next bullet point in the Gotchas list):

```markdown
- **Never use `datetime()` in SQL comparisons**: SQLite's `datetime()` returns space-separated timestamps (`2026-03-11 12:00:00`), but JS `toISOString()` returns `T`-separated (`2026-03-11T12:00:00.000Z`). Lexicographic comparison between these formats is always wrong. Use `sqliteIsoNow()` from `src/lib/db.ts` instead — it returns a `strftime()` expression that produces ISO 8601 format.
```

Using the Edit tool, the `old_string` is:
```
- **Cookie prefix `tct-`**: All app cookies use this prefix (`tct-session`, `tct-refresh`, `tct-oauth-state`, `tct-oauth-verifier`).
```
And the `new_string` is:
```
- **Cookie prefix `tct-`**: All app cookies use this prefix (`tct-session`, `tct-refresh`, `tct-oauth-state`, `tct-oauth-verifier`).
- **Never use `datetime()` in SQL comparisons**: SQLite's `datetime()` returns space-separated timestamps (`2026-03-11 12:00:00`), but JS `toISOString()` returns `T`-separated (`2026-03-11T12:00:00.000Z`). Lexicographic comparison between these formats is always wrong. Use `sqliteIsoNow()` from `src/lib/db.ts` instead — it returns a `strftime()` expression that produces ISO 8601 format.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add datetime() gotcha to CLAUDE.md"
```

---

### Task 8: Run full verification

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Run linter**

Run: `npm run lint`
Expected: No lint errors

**Step 4: Verify no remaining `datetime('now` in source files**

This is already covered by the regression guard test in Task 5 (which runs as part of `npx vitest run` in Step 1). If Step 1 passed, this check is already verified. No additional action needed.

**Step 5: Commit any remaining changes (if any)**

If verification revealed issues that required fixes, those should have been committed as part of fixing them. At this point the working tree should be clean.
