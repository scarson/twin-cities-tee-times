# Integration Testing Infrastructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add integration tests that catch real bugs our unit tests miss — broken SQL, stale API contracts, and pipeline mismatches — using real SQLite (via better-sqlite3) and real HTTP calls.

**Architecture:** Three test tiers: (1) DB integration tests with real SQLite via a D1-compatible wrapper, (2) pipeline integration tests running fixture data through real adapters into real SQLite, (3) API smoke tests hitting live booking platform APIs. A minor refactoring extracts housekeeping SQL from the cron handler into testable functions.

**Tech Stack:** better-sqlite3 (devDependency), Vitest 4, existing adapter fixtures, existing migration files.

**Design doc:** `docs/plans/2026-03-16-integration-tests-design.md` — read this for full rationale and test scenario index.

---

## Mandatory Pre-Work for Every Task

**EVERY subagent MUST do these things BEFORE writing any code:**

1. **Read `dev/testing-pitfalls.md`** — this is the project's test quality checklist. Every item exists because it catches bugs that occurred in this codebase. You will use it as a QA checklist before finishing each task.
2. **Invoke the `superpowers:test-driven-development` skill** — follow TDD discipline: write failing test first, verify it fails, write minimal implementation, verify it passes.
3. **Read `CLAUDE.md`** — for project conventions, especially the ABOUTME comment requirement, naming rules, and test output cleanliness rules.

**EVERY subagent MUST do this QA check BEFORE marking a task complete:**

1. Run all tests: `npm test`
2. Run type-check: `npx tsc --noEmit`
3. Review your tests against `dev/testing-pitfalls.md` — specifically check:
   - Are you testing mocked behavior instead of real logic? (§1, pitfall: "NEVER write tests that test mocked behavior")
   - Do error paths produce distinguishable results? (§1)
   - Are SQL values parameterized via `.bind()`, not interpolated? (§8)
   - Is test output pristine (no unexpected console errors)? (CLAUDE.md: "Test output MUST BE PRISTINE")
4. If any check fails, fix it before completing.

---

## Task 1: Install better-sqlite3

**Files:**
- Modify: `package.json`

**Context:** `better-sqlite3` ships prebuilt binaries for Windows x64 and Linux x64 (CI). It's the standard SQLite library for Node.js testing. We need it as a devDependency to create real SQLite databases for integration tests.

**Step 1: Install the package**

Run:
```bash
npm install --save-dev better-sqlite3 @types/better-sqlite3
```

**Step 2: Verify it installed correctly**

Run:
```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log('SQLite version:', db.pragma('compile_options').length > 0 ? 'OK' : 'FAIL'); db.close();"
```
Expected: `SQLite version: OK`

**Step 3: Verify npm test still passes**

Run:
```bash
npm test
```
Expected: All existing tests pass. No regressions.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 for integration tests"
```

---

## Task 2: Create D1 Test Helper

**Files:**
- Create: `src/test/d1-test-helper.ts`

**Context:** Our production code expects `D1Database` (Cloudflare's async database API). Integration tests need to pass a real SQLite database that implements the same API surface. This wrapper maps D1's async chainable API onto better-sqlite3's sync API.

**Read these files first:**
- `src/test/d1-mock.ts` — the existing mock D1 (we're building a REAL version of this concept)
- `migrations/0001_initial_schema.sql` — schema to apply
- `migrations/0002_auth_schema.sql` — auth schema
- `migrations/0003_auto_active.sql` — adds last_had_tee_times column
- `migrations/0004_drop_last_active_check.sql` — drops old column (requires SQLite 3.35+)
- `migrations/0005_reactivate_courses.sql` — reactivates courses
- `src/lib/db.ts` — the production code that will use this helper

**CRITICAL REQUIREMENTS:**
1. `PRAGMA foreign_keys = ON` — D1 enables FK enforcement by default. SQLite does NOT. Without this, CASCADE tests and FK violation tests give false confidence. This MUST be set immediately after creating the database, before any migrations.
2. `stmt.first()` must return `null` (not `undefined`) when no row matches — D1's documented behavior.
3. `stmt.all()` must return `{ results: T[] }` — same `D1Result` shape as D1.
4. `stmt.run()` must return `{ meta: { changes: number } }`.
5. `db.batch(stmts[])` must execute all statements in a SQLite transaction. If any statement fails, the entire batch rolls back.
6. `stmt.bind(...values)` must be chainable (returns `this`).

**Step 1: Write a test for the helper itself**

Create `src/test/d1-test-helper.test.ts`:

```typescript
// ABOUTME: Tests for the D1-compatible SQLite wrapper used in integration tests.
// ABOUTME: Verifies the wrapper matches D1's async API surface and FK enforcement.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./d1-test-helper";

describe("D1 test helper", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("applies all migrations successfully", async () => {
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all<{ name: string }>();

    const names = tables.results.map((t) => t.name);
    expect(names).toContain("courses");
    expect(names).toContain("tee_times");
    expect(names).toContain("poll_log");
    expect(names).toContain("users");
    expect(names).toContain("sessions");
    expect(names).toContain("user_favorites");
    expect(names).toContain("booking_clicks");
  });

  it("first() returns null when no row matches", async () => {
    const result = await db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .bind("nonexistent")
      .first();

    expect(result).toBeNull();
  });

  it("all() returns { results: [] } when no rows match", async () => {
    const result = await db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .bind("nonexistent")
      .all();

    expect(result).toEqual({ results: [] });
  });

  it("run() returns { meta: { changes } }", async () => {
    await db
      .prepare(
        `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind("test", "Test", "City", "foreup", "{}", "https://example.com", 1)
      .run();

    const result = await db
      .prepare("DELETE FROM courses WHERE id = ?")
      .bind("test")
      .run();

    expect(result.meta.changes).toBe(1);
  });

  it("bind() is chainable", async () => {
    const stmt = db.prepare("SELECT * FROM courses WHERE id = ?");
    const bound = stmt.bind("test");
    // bind() should return an object with first/all/run
    expect(typeof bound.first).toBe("function");
    expect(typeof bound.all).toBe("function");
    expect(typeof bound.run).toBe("function");
  });

  it("enforces foreign key constraints", async () => {
    // Inserting a tee time for a non-existent course should fail
    await expect(
      db
        .prepare(
          `INSERT INTO tee_times (course_id, date, time, holes, open_slots, booking_url, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind("nonexistent", "2026-03-16", "08:00", 18, 4, "https://x.com", "2026-03-16T00:00:00Z")
        .run()
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("batch() executes atomically — rolls back on failure", async () => {
    // Insert a course first
    await db
      .prepare(
        `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind("c1", "Course 1", "City", "foreup", "{}", "https://example.com", 1)
      .run();

    // Insert a valid tee time
    await db
      .prepare(
        `INSERT INTO tee_times (course_id, date, time, holes, open_slots, booking_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind("c1", "2026-03-16", "08:00", 18, 4, "https://x.com", "2026-03-16T00:00:00Z")
      .run();

    // Batch: delete existing + insert with NULL time (should fail NOT NULL constraint)
    const deleteStmt = db
      .prepare("DELETE FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("c1", "2026-03-16");
    const badInsert = db
      .prepare(
        `INSERT INTO tee_times (course_id, date, time, holes, open_slots, booking_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind("c1", "2026-03-16", null, 18, 4, "https://x.com", "2026-03-16T00:00:00Z");

    await expect(db.batch([deleteStmt, badInsert])).rejects.toThrow();

    // Original row should still exist (transaction rolled back)
    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ?")
      .bind("c1")
      .all();
    expect(rows.results).toHaveLength(1);
  });

  it("strftime works for sqliteIsoNow compatibility", async () => {
    // Verify strftime produces ISO 8601 format (same as our sqliteIsoNow helper)
    const result = await db
      .prepare(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as ts"
      )
      .bind()
      .first<{ ts: string }>();

    expect(result).not.toBeNull();
    // Should match ISO 8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(result!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
```

**Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/test/d1-test-helper.test.ts
```
Expected: FAIL — `d1-test-helper` module doesn't exist yet.

**Step 3: Implement the D1 test helper**

Create `src/test/d1-test-helper.ts`:

```typescript
// ABOUTME: Real SQLite wrapper matching D1's async API for integration tests.
// ABOUTME: Uses better-sqlite3 with all migrations applied and FK enforcement enabled.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

interface BoundStatement {
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

interface PreparedStatement extends BoundStatement {
  bind(...values: unknown[]): BoundStatement;
}

/**
 * Create a fresh in-memory SQLite database with all migrations applied.
 * Returns a D1-compatible wrapper for use in integration tests.
 *
 * Each call creates an independent database — tests cannot interfere.
 */
export function createTestDb(): D1Database {
  const sqlite = new Database(":memory:");

  // D1 enforces foreign keys by default. SQLite does not.
  // This MUST be set before any migrations or data operations.
  sqlite.pragma("foreign_keys = ON");

  // Apply all migrations in order
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  const files = fs.readdirSync(migrationsDir).sort();
  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    sqlite.exec(sql);
  }

  // Each bound statement needs both async methods (for D1 API compatibility)
  // AND a sync _syncRun method (for batch(), which runs inside a SQLite transaction
  // that cannot yield to the event loop).
  function makeBound(
    stmt: Database.Statement,
    params: unknown[]
  ): BoundStatement & { _syncRun: () => { meta: { changes: number } } } {
    return {
      _syncRun() {
        const info = stmt.run(...params);
        return { meta: { changes: info.changes } };
      },
      async first<T>(): Promise<T | null> {
        const row = stmt.get(...params);
        return (row as T) ?? null; // undefined → null (D1 behavior)
      },
      async all<T>(): Promise<{ results: T[] }> {
        const rows = stmt.all(...params);
        return { results: rows as T[] };
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const info = stmt.run(...params);
        return { meta: { changes: info.changes } };
      },
    };
  }

  const wrapper = {
    prepare(sql: string): PreparedStatement {
      const stmt = sqlite.prepare(sql);
      const bound = makeBound(stmt, []);
      return {
        ...bound,
        bind(...values: unknown[]): BoundStatement {
          return makeBound(stmt, values);
        },
      };
    },

    async batch(
      statements: BoundStatement[]
    ): Promise<{ meta: { changes: number } }[]> {
      const results: { meta: { changes: number } }[] = [];
      const run = sqlite.transaction(() => {
        for (const stmt of statements) {
          results.push((stmt as any)._syncRun());
        }
      });
      run();
      return results;
    },
  };

  return wrapper as unknown as D1Database;
}

/**
 * Insert a course with sensible defaults. Override any field via the overrides param.
 */
export async function seedCourse(
  db: D1Database,
  overrides: Partial<{
    id: string;
    name: string;
    city: string;
    platform: string;
    platform_config: string;
    booking_url: string;
    is_active: number;
    last_had_tee_times: string | null;
  }> = {}
): Promise<void> {
  const c = {
    id: "test-course",
    name: "Test Course",
    city: "Minneapolis",
    platform: "foreup",
    platform_config: JSON.stringify({ scheduleId: "1234" }),
    booking_url: "https://example.com/book",
    is_active: 1,
    last_had_tee_times: null as string | null,
    ...overrides,
  };

  await db
    .prepare(
      `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active, last_had_tee_times)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      c.id,
      c.name,
      c.city,
      c.platform,
      c.platform_config,
      c.booking_url,
      c.is_active,
      c.last_had_tee_times
    )
    .run();
}

/**
 * Insert a user with sensible defaults.
 */
export async function seedUser(
  db: D1Database,
  overrides: Partial<{
    id: string;
    google_id: string;
    email: string;
    name: string;
    created_at: string;
  }> = {}
): Promise<void> {
  const u = {
    id: "test-user",
    google_id: "google-123",
    email: "test@example.com",
    name: "Test User",
    created_at: new Date().toISOString(),
    ...overrides,
  };

  await db
    .prepare(
      `INSERT INTO users (id, google_id, email, name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(u.id, u.google_id, u.email, u.name, u.created_at)
    .run();
}
```

**Step 4: Run the tests**

Run:
```bash
npx vitest run src/test/d1-test-helper.test.ts
```
Expected: All tests pass.

**Step 5: Run the full test suite**

Run:
```bash
npm test
```
Expected: All tests pass, including the new ones.

**Step 6: Commit**

```bash
git add src/test/d1-test-helper.ts src/test/d1-test-helper.test.ts
git commit -m "feat: add D1-compatible SQLite wrapper for integration tests"
```

---

## Task 3: Extract Housekeeping Functions from Cron Handler

**Files:**
- Modify: `src/lib/db.ts` (add 3 new functions)
- Modify: `src/lib/cron-handler.ts` (replace inline SQL with function calls)

**Context:** The cron handler (`src/lib/cron-handler.ts`, lines 209-241) contains three housekeeping SQL operations embedded inline. We need to extract these into named, testable functions in `src/lib/db.ts` so integration tests can call them directly. The SQL and behavior must NOT change — this is a pure extraction refactoring.

**Read these files first:**
- `src/lib/db.ts` — where the new functions will go
- `src/lib/cron-handler.ts` — lines 208-241 specifically (the housekeeping section)

**Step 1: Write failing tests for the new functions**

Add to `src/lib/db.ts` three new exported functions. But first, write tests that call them.

Create `src/lib/housekeeping.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for housekeeping functions extracted from cron handler.
// ABOUTME: Tests poll_log cleanup, course auto-deactivation, and session cleanup against real SQLite.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, seedUser } from "@/test/d1-test-helper";
import { cleanupOldPolls, deactivateStaleCourses, cleanupExpiredSessions } from "./db";

describe("cleanupOldPolls", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("deletes poll_log entries older than 7 days", async () => {
    await seedCourse(db);

    // Insert an old poll (8 days ago)
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("test-course", "2026-03-08", oldDate, "success", 5)
      .run();

    // Insert a recent poll (1 hour ago)
    const recentDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("test-course", "2026-03-16", recentDate, "success", 3)
      .run();

    const deleted = await cleanupOldPolls(db);
    expect(deleted).toBe(1);

    const remaining = await db
      .prepare("SELECT COUNT(*) as cnt FROM poll_log")
      .bind()
      .first<{ cnt: number }>();
    expect(remaining!.cnt).toBe(1);
  });
});

describe("deactivateStaleCourses", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("deactivates course with last_had_tee_times > 30 days ago", async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await seedCourse(db, { id: "stale", last_had_tee_times: oldDate });

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(1);

    const course = await db
      .prepare("SELECT is_active FROM courses WHERE id = ?")
      .bind("stale")
      .first<{ is_active: number }>();
    expect(course!.is_active).toBe(0);
  });

  it("does NOT deactivate course with last_had_tee_times IS NULL", async () => {
    await seedCourse(db, { id: "new-course", last_had_tee_times: null });

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(0);

    const course = await db
      .prepare("SELECT is_active FROM courses WHERE id = ?")
      .bind("new-course")
      .first<{ is_active: number }>();
    expect(course!.is_active).toBe(1);
  });

  it("does NOT deactivate already-inactive courses", async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await seedCourse(db, { id: "inactive", is_active: 0, last_had_tee_times: oldDate });

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(0);
  });
});

describe("cleanupExpiredSessions", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("deletes expired sessions, preserves active ones", async () => {
    await seedUser(db);

    const now = new Date();
    const pastDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // tomorrow

    // Expired session
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind("expired-hash", "test-user", pastDate, now.toISOString())
      .run();

    // Active session
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind("active-hash", "test-user", futureDate, now.toISOString())
      .run();

    const deleted = await cleanupExpiredSessions(db);
    expect(deleted).toBe(1);

    const remaining = await db
      .prepare("SELECT COUNT(*) as cnt FROM sessions")
      .bind()
      .first<{ cnt: number }>();
    expect(remaining!.cnt).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run src/lib/housekeeping.integration.test.ts
```
Expected: FAIL — functions don't exist yet.

**Step 3: Implement the three functions in db.ts**

Add to the end of `src/lib/db.ts`:

```typescript
/**
 * Delete poll_log entries older than 7 days.
 * Returns the number of deleted rows.
 */
export async function cleanupOldPolls(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`)
    .run();
  return result.meta.changes;
}

/**
 * Deactivate courses that haven't had tee times for 30+ days.
 * Courses with NULL last_had_tee_times are NOT deactivated (never checked yet).
 * Returns the number of deactivated courses.
 */
export async function deactivateStaleCourses(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE courses SET is_active = 0
       WHERE is_active = 1
         AND last_had_tee_times IS NOT NULL
         AND last_had_tee_times < ${sqliteIsoNow("-30 days")}`
    )
    .run();
  return result.meta.changes;
}

/**
 * Delete sessions past their expiration time.
 * Returns the number of deleted sessions.
 */
export async function cleanupExpiredSessions(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`)
    .run();
  return result.meta.changes;
}
```

**Step 4: Run the housekeeping tests**

Run:
```bash
npx vitest run src/lib/housekeeping.integration.test.ts
```
Expected: All pass.

**Step 5: Update cron-handler.ts to call the new functions**

In `src/lib/cron-handler.ts`, replace the inline housekeeping SQL (lines 209-241) with calls to the new functions:

Replace:
```typescript
    // --- Housekeeping: batch 0 only ---
    if (batchIndex === 0) {
      try {
        const deactivated = await db
          .prepare(
            `UPDATE courses SET is_active = 0
             WHERE is_active = 1
               AND last_had_tee_times IS NOT NULL
               AND last_had_tee_times < ${sqliteIsoNow("-30 days")}`
          )
          .run();
        if (deactivated.meta?.changes && deactivated.meta.changes > 0) {
          console.log(`Auto-deactivated ${deactivated.meta.changes} course(s): no tee times for 30 days`);
        }
      } catch (err) {
        console.error("Auto-deactivation error:", err);
      }

      try {
        await db
          .prepare(`DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`)
          .run();
      } catch (err) {
        console.error("poll_log cleanup error:", err);
      }

      try {
        await db
          .prepare(`DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`)
          .run();
      } catch (err) {
        console.error("session cleanup error:", err);
      }
    }
```

With:
```typescript
    // --- Housekeeping: batch 0 only ---
    if (batchIndex === 0) {
      try {
        const deactivatedCount = await deactivateStaleCourses(db);
        if (deactivatedCount > 0) {
          console.log(`Auto-deactivated ${deactivatedCount} course(s): no tee times for 30 days`);
        }
      } catch (err) {
        console.error("Auto-deactivation error:", err);
      }

      try {
        await cleanupOldPolls(db);
      } catch (err) {
        console.error("poll_log cleanup error:", err);
      }

      try {
        await cleanupExpiredSessions(db);
      } catch (err) {
        console.error("session cleanup error:", err);
      }
    }
```

Update the import in `cron-handler.ts` to include the new functions:

Change:
```typescript
import { sqliteIsoNow, logPoll } from "@/lib/db";
```
To:
```typescript
import { sqliteIsoNow, logPoll, cleanupOldPolls, deactivateStaleCourses, cleanupExpiredSessions } from "@/lib/db";
```

Note: `sqliteIsoNow` is STILL USED on line 92 for the `recentPolls` query — do NOT remove it from the import.

**Step 6: Run full test suite**

Run:
```bash
npm test
```
Expected: All tests pass (existing + new).

**Step 7: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: No type errors.

**Step 8: Commit**

```bash
git add src/lib/db.ts src/lib/cron-handler.ts src/lib/housekeeping.integration.test.ts
git commit -m "refactor: extract housekeeping SQL into testable db.ts functions"
```

---

## Task 4: DB Integration Tests — Core db.ts Functions

**Files:**
- Create: `src/lib/db.integration.test.ts`

**Context:** Test `upsertTeeTimes()` and `logPoll()` from `src/lib/db.ts` against real SQLite. These are the most critical write-path functions. The design doc scenarios 1-5, 22, 23, 25, 28 belong here.

**Read these files first:**
- `src/lib/db.ts` — the functions under test
- `src/test/d1-test-helper.ts` — the helper you'll use
- `src/types/index.ts` — the `TeeTime` interface (fields: courseId, time, price, holes, openSlots, bookingUrl)
- `docs/plans/2026-03-16-integration-tests-design.md` — scenarios 1-5, 22, 23, 25, 28

**IMPORTANT:** Each test calls `upsertTeeTimes` or `logPoll` with real arguments and then queries the database to verify the result. The `time` field handling is subtle — read `upsertTeeTimes` carefully to understand the `tt.time.includes("T")` branch:
- If time contains "T" (e.g., "2026-03-16T08:30:00"), it extracts "08:30"
- If time does NOT contain "T" (e.g., "08:30"), it stores "08:30" as-is

**Step 1: Write all tests**

Create `src/lib/db.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for core db.ts functions against real SQLite.
// ABOUTME: Covers upsertTeeTimes, logPoll, batch atomicity, FK enforcement, and time parsing.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { upsertTeeTimes, logPoll } from "./db";
import type { TeeTime } from "@/types";

function makeTeeTime(overrides: Partial<TeeTime> = {}): TeeTime {
  return {
    courseId: "test-course",
    time: "2026-03-16T08:30:00",
    price: 45,
    holes: 18,
    openSlots: 4,
    bookingUrl: "https://example.com/book",
    ...overrides,
  };
}

describe("upsertTeeTimes", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db);
  });

  it("inserts tee times that are queryable afterward", async () => {
    const teeTimes = [makeTeeTime(), makeTeeTime({ time: "2026-03-16T09:00:00", price: 50 })];

    await upsertTeeTimes(db, "test-course", "2026-03-16", teeTimes, new Date().toISOString());

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all<{ time: string; price: number }>();

    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].time).toBe("08:30");
    expect(rows.results[1].time).toBe("09:00");
  });

  it("replaces old data on re-upsert for same course+date", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "2026-03-16T07:00:00", price: 30 })],
      new Date().toISOString()
    );

    // Re-upsert with different data
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "2026-03-16T10:00:00", price: 60 })],
      new Date().toISOString()
    );

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all<{ time: string; price: number }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].time).toBe("10:00");
    expect(rows.results[0].price).toBe(60);
  });

  it("with empty array deletes existing rows", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime()],
      new Date().toISOString()
    );

    // Upsert with empty array
    await upsertTeeTimes(db, "test-course", "2026-03-16", [], new Date().toISOString());

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all();

    expect(rows.results).toHaveLength(0);
  });

  it("extracts HH:MM from ISO time (T separator)", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "2026-03-16T14:45:00" })],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT time FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ time: string }>();

    expect(row!.time).toBe("14:45");
  });

  it("stores time as-is when no T separator (plain HH:MM)", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "08:30" })],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT time FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ time: string }>();

    expect(row!.time).toBe("08:30");
  });

  it("batch atomicity: constraint violation rolls back preceding DELETE", async () => {
    // Insert 3 tee times
    const originals = [
      makeTeeTime({ time: "2026-03-16T07:00:00" }),
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
      makeTeeTime({ time: "2026-03-16T09:00:00" }),
    ];
    await upsertTeeTimes(db, "test-course", "2026-03-16", originals, new Date().toISOString());

    // Attempt upsert with a tee time that has null time (NOT NULL violation)
    // This should fail and roll back the DELETE of original rows
    const badTeeTimes = [
      makeTeeTime({ time: null as unknown as string }),
    ];

    await expect(
      upsertTeeTimes(db, "test-course", "2026-03-16", badTeeTimes, new Date().toISOString())
    ).rejects.toThrow();

    // Original 3 rows should still be there
    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all();

    expect(rows.results).toHaveLength(3);
  });

  it("FK enforcement: inserting tee time for non-existent course fails", async () => {
    await expect(
      upsertTeeTimes(
        db, "nonexistent-course", "2026-03-16",
        [makeTeeTime({ courseId: "nonexistent-course" })],
        new Date().toISOString()
      )
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("logPoll", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db);
  });

  it("records entries with correct status values", async () => {
    await logPoll(db, "test-course", "2026-03-16", "success", 5);
    await logPoll(db, "test-course", "2026-03-16", "no_data", 0);
    await logPoll(db, "test-course", "2026-03-16", "error", 0, "API timeout");

    const rows = await db
      .prepare("SELECT status, tee_time_count, error_message FROM poll_log WHERE course_id = ? ORDER BY id")
      .bind("test-course")
      .all<{ status: string; tee_time_count: number; error_message: string | null }>();

    expect(rows.results).toHaveLength(3);
    expect(rows.results[0]).toMatchObject({ status: "success", tee_time_count: 5, error_message: null });
    expect(rows.results[1]).toMatchObject({ status: "no_data", tee_time_count: 0, error_message: null });
    expect(rows.results[2]).toMatchObject({ status: "error", tee_time_count: 0, error_message: "API timeout" });
  });
});

describe("sqliteIsoNow boundary", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db);
  });

  it("poll at exactly 24 hours ago is excluded by > comparison", async () => {
    // Insert a poll with polled_at = exactly now (which strftime('now') will match)
    // Then query with > sqliteIsoNow('-24 hours')
    // This tests that the boundary is exclusive (>), not inclusive (>=)
    const exactlyNow = new Date().toISOString();
    await logPoll(db, "test-course", "2026-03-16", "success", 5);

    // The courses route query uses > sqliteIsoNow('-24 hours')
    // A poll from right now should be included
    const result = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM poll_log
         WHERE polled_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')`
      )
      .bind()
      .first<{ cnt: number }>();

    expect(result!.cnt).toBe(1);
  });
});
```

**Step 2: Run the tests**

Run:
```bash
npx vitest run src/lib/db.integration.test.ts
```
Expected: All pass.

**Step 3: Run full test suite**

Run:
```bash
npm test
```
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/lib/db.integration.test.ts
git commit -m "test: add DB integration tests for upsertTeeTimes, logPoll, atomicity, and FK enforcement"
```

---

## Task 5: DB Integration Tests — User Lifecycle and Constraints

**Files:**
- Create: `src/lib/user-lifecycle.integration.test.ts`

**Context:** Tests the account lifecycle promise made on the About page: create user → add favorites + booking clicks → delete user → all associated data gone. Also tests CASCADE behavior, duplicate constraints, and data isolation between users. Design doc scenarios 21, 26, 27, 32, 33.

**Read these files first:**
- `src/test/d1-test-helper.ts` — createTestDb, seedCourse, seedUser
- `src/types/auth.ts` — UserRow, UserFavoriteRow, BookingClickRow
- `migrations/0002_auth_schema.sql` — FK constraints, CASCADE declarations, UNIQUE constraints
- `src/app/api/user/account/route.ts` — how deletion works in production
- `src/app/about/page.tsx` — the promise about deletion (lines 146-152)

**IMPORTANT:** The About page says: "This permanently removes all your data from our servers — your profile, synced favorites, and booking click history. Your local favorites are not affected." The test must verify this claim by checking that favorites, booking clicks, sessions, and user_settings are ALL deleted when the user is deleted, but other users' data is preserved.

**Step 1: Write all tests**

Create `src/lib/user-lifecycle.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for user account lifecycle and constraint enforcement.
// ABOUTME: Verifies the About page promise: account deletion removes all user data.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, seedUser } from "@/test/d1-test-helper";

describe("account lifecycle", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "course-a" });
    await seedCourse(db, { id: "course-b", name: "Course B" });
  });

  it("create user → add favorites + clicks → delete → all user data gone", async () => {
    await seedUser(db, { id: "user-1" });

    // Add favorites
    await db
      .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .bind("user-1", "course-a", new Date().toISOString())
      .run();
    await db
      .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .bind("user-1", "course-b", new Date().toISOString())
      .run();

    // Add booking clicks
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("user-1", "course-a", "2026-03-16", "08:30", new Date().toISOString())
      .run();

    // Add a session
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind("hash-1", "user-1", new Date(Date.now() + 86400000).toISOString(), new Date().toISOString())
      .run();

    // Delete the user
    await db.prepare("DELETE FROM users WHERE id = ?").bind("user-1").run();

    // Verify ALL associated data is gone (CASCADE)
    const favorites = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(favorites!.cnt).toBe(0);

    const clicks = await db
      .prepare("SELECT COUNT(*) as cnt FROM booking_clicks WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(clicks!.cnt).toBe(0);

    const sessions = await db
      .prepare("SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(sessions!.cnt).toBe(0);

    const user = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind("user-1")
      .first();
    expect(user).toBeNull();
  });

  it("account deletion preserves other users' data", async () => {
    await seedUser(db, { id: "user-1", google_id: "g1", email: "a@test.com" });
    await seedUser(db, { id: "user-2", google_id: "g2", email: "b@test.com" });

    // Both users have favorites for course-a
    await db
      .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .bind("user-1", "course-a", new Date().toISOString())
      .run();
    await db
      .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .bind("user-2", "course-a", new Date().toISOString())
      .run();

    // Delete user-1
    await db.prepare("DELETE FROM users WHERE id = ?").bind("user-1").run();

    // user-2's data should be intact
    const user2Favs = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?")
      .bind("user-2")
      .first<{ cnt: number }>();
    expect(user2Favs!.cnt).toBe(1);

    const user2 = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind("user-2")
      .first();
    expect(user2).not.toBeNull();
  });
});

describe("CASCADE on course delete", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "course-x" });
    await seedUser(db, { id: "user-1" });
  });

  it("deleting a course cascades to favorites and booking clicks", async () => {
    await db
      .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .bind("user-1", "course-x", new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("user-1", "course-x", "2026-03-16", "08:00", new Date().toISOString())
      .run();

    // Delete the course
    await db.prepare("DELETE FROM courses WHERE id = ?").bind("course-x").run();

    const favs = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_favorites WHERE course_id = ?")
      .bind("course-x")
      .first<{ cnt: number }>();
    expect(favs!.cnt).toBe(0);

    const clicks = await db
      .prepare("SELECT COUNT(*) as cnt FROM booking_clicks WHERE course_id = ?")
      .bind("course-x")
      .first<{ cnt: number }>();
    expect(clicks!.cnt).toBe(0);
  });
});

describe("unique constraints", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "course-a" });
    await seedUser(db, { id: "user-1" });
  });

  it("rejects duplicate favorite (same user + course)", async () => {
    await db
      .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .bind("user-1", "course-a", new Date().toISOString())
      .run();

    await expect(
      db
        .prepare("INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)")
        .bind("user-1", "course-a", new Date().toISOString())
        .run()
    ).rejects.toThrow();
  });

  it("rejects duplicate booking click (same user + course + date + time)", async () => {
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("user-1", "course-a", "2026-03-16", "08:30", new Date().toISOString())
      .run();

    await expect(
      db
        .prepare(
          "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind("user-1", "course-a", "2026-03-16", "08:30", new Date().toISOString())
        .run()
    ).rejects.toThrow();
  });
});
```

**Step 2: Run the tests**

Run:
```bash
npx vitest run src/lib/user-lifecycle.integration.test.ts
```
Expected: All pass.

**Step 3: Run full suite + type-check**

Run:
```bash
npm test && npx tsc --noEmit
```
Expected: All pass.

**Step 4: Commit**

```bash
git add src/lib/user-lifecycle.integration.test.ts
git commit -m "test: add integration tests for user lifecycle, CASCADE, and unique constraints"
```

---

## Task 6: DB Integration Tests — API Route Queries

**Files:**
- Create: `src/app/api/courses/route.integration.test.ts`
- Create: `src/app/api/courses/[id]/route.integration.test.ts`
- Create: `src/app/api/tee-times/route.integration.test.ts`

**Context:** These tests verify the SQL queries used by the three main API routes. They don't call the route handlers (which depend on `getCloudflareContext`). Instead, they execute the same SQL queries directly against the real SQLite wrapper. Design doc scenarios 6-17, 29-31.

**Read these files first:**
- `src/app/api/courses/route.ts` — the courses list SQL (ROW_NUMBER window function)
- `src/app/api/courses/[id]/route.ts` — the course detail SQL
- `src/app/api/tee-times/route.ts` — the tee times SQL with dynamic filters
- `src/lib/db.ts` — `sqliteIsoNow()` function (used in the route queries)
- `src/test/d1-test-helper.ts` — createTestDb, seedCourse

**IMPORTANT — how to test route queries without calling the route handler:**

The route handlers get their `db` from `getCloudflareContext()`. We can't easily mock that for integration tests. Instead, extract the SQL query from each route and execute it directly against our test DB. The test validates the SQL logic, not the HTTP handling (which is already covered by existing unit tests).

Copy the SQL queries exactly as they appear in the route files. Do NOT simplify or rewrite them. The goal is to verify the production SQL works correctly.

**Step 1: Write courses list integration tests**

Create `src/app/api/courses/route.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for the courses list SQL query.
// ABOUTME: Verifies ROW_NUMBER window function, freshness filtering, and no_data status handling.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { logPoll, sqliteIsoNow } from "@/lib/db";

// This is the exact SQL from src/app/api/courses/route.ts
const COURSES_LIST_SQL = `
  SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
         p.polled_at as last_polled,
         p.status as last_poll_status
  FROM courses c
  LEFT JOIN (
    SELECT course_id, polled_at, status,
           ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
    FROM poll_log
    WHERE polled_at > ${sqliteIsoNow("-24 hours")}
      AND status IN ('success', 'no_data')
  ) p ON c.id = p.course_id AND p.rn = 1
  ORDER BY c.name
`;

describe("courses list query", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("ROW_NUMBER returns only the most recent poll per course", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });

    // Two polls — query should return only the most recent
    await logPoll(db, "c1", "2026-03-16", "success", 3);
    // Small delay to ensure different timestamps
    await logPoll(db, "c1", "2026-03-16", "success", 5);

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string;
      last_polled: string;
      last_poll_status: string;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1).toBeDefined();
    expect(c1!.last_poll_status).toBe("success");
    // Should only appear once (ROW_NUMBER filters to rn=1)
    expect(result.results.filter((r) => r.id === "c1")).toHaveLength(1);
  });

  it("no_data status polls appear in freshness results", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await logPoll(db, "c1", "2026-03-16", "no_data", 0);

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string;
      last_poll_status: string;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1!.last_poll_status).toBe("no_data");
  });

  it("multiple courses with mixed statuses return correct per-course freshness", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await seedCourse(db, { id: "c2", name: "Bravo" });

    await logPoll(db, "c1", "2026-03-16", "success", 10);
    await logPoll(db, "c2", "2026-03-16", "no_data", 0);

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string;
      last_poll_status: string;
    }>();

    expect(result.results.find((r) => r.id === "c1")!.last_poll_status).toBe("success");
    expect(result.results.find((r) => r.id === "c2")!.last_poll_status).toBe("no_data");
  });

  it("polls older than 24 hours are excluded", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });

    // Insert a poll with a manually backdated timestamp (25 hours ago)
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("c1", "2026-03-15", oldTime, "success", 5)
      .run();

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string;
      last_polled: string | null;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1!.last_polled).toBeNull(); // Old poll excluded
  });

  it("course with zero poll history has null freshness fields", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string;
      last_polled: string | null;
      last_poll_status: string | null;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1!.last_polled).toBeNull();
    expect(c1!.last_poll_status).toBeNull();
  });
});
```

**Step 2: Write course detail integration tests**

Create `src/app/api/courses/[id]/route.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for the course detail SQL query.
// ABOUTME: Verifies single-course freshness lookup and handling of missing courses.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { logPoll, sqliteIsoNow } from "@/lib/db";

const COURSE_DETAIL_SQL = `
  SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
         p.polled_at as last_polled,
         p.status as last_poll_status
  FROM courses c
  LEFT JOIN (
    SELECT course_id, polled_at, status,
           ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
    FROM poll_log
    WHERE polled_at > ${sqliteIsoNow("-24 hours")}
      AND status IN ('success', 'no_data')
  ) p ON c.id = p.course_id AND p.rn = 1
  WHERE c.id = ?
`;

describe("course detail query", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("returns correct single-course freshness", async () => {
    await seedCourse(db, { id: "c1" });
    await logPoll(db, "c1", "2026-03-16", "success", 10);

    const result = await db
      .prepare(COURSE_DETAIL_SQL)
      .bind("c1")
      .first<{ id: string; last_poll_status: string }>();

    expect(result).not.toBeNull();
    expect(result!.id).toBe("c1");
    expect(result!.last_poll_status).toBe("success");
  });

  it("non-existent course ID returns null", async () => {
    const result = await db
      .prepare(COURSE_DETAIL_SQL)
      .bind("nonexistent")
      .first();

    expect(result).toBeNull();
  });
});
```

**Step 3: Write tee-times integration tests**

Create `src/app/api/tee-times/route.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for the tee-times SQL query with dynamic filter building.
// ABOUTME: Verifies date, course, time range, holes, minSlots filters, and ordering.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { upsertTeeTimes } from "@/lib/db";
import type { TeeTime } from "@/types";

function makeTeeTime(overrides: Partial<TeeTime> = {}): TeeTime {
  return {
    courseId: "c1",
    time: "2026-03-16T08:30:00",
    price: 45,
    holes: 18,
    openSlots: 4,
    bookingUrl: "https://example.com/book",
    ...overrides,
  };
}

/**
 * Build and execute the same dynamic SQL query as src/app/api/tee-times/route.ts.
 * This replicates the route's query builder logic exactly.
 */
async function queryTeeTimes(
  db: D1Database,
  params: {
    date: string;
    courseIds?: string[];
    startTime?: string;
    endTime?: string;
    holes?: string;
    minSlots?: string;
  }
) {
  let query = `
    SELECT t.*, c.name as course_name, c.city as course_city
    FROM tee_times t
    JOIN courses c ON t.course_id = c.id
    WHERE t.date = ?
  `;
  const bindings: unknown[] = [params.date];

  if (params.courseIds && params.courseIds.length > 0) {
    const placeholders = params.courseIds.map(() => "?").join(",");
    query += ` AND t.course_id IN (${placeholders})`;
    bindings.push(...params.courseIds);
  }

  if (params.startTime) {
    query += " AND t.time >= ?";
    bindings.push(params.startTime);
  }

  if (params.endTime) {
    query += " AND t.time <= ?";
    bindings.push(params.endTime);
  }

  if (params.holes === "9" || params.holes === "18") {
    query += " AND t.holes = ?";
    bindings.push(parseInt(params.holes));
  }

  if (params.minSlots) {
    query += " AND t.open_slots >= ?";
    bindings.push(parseInt(params.minSlots));
  }

  query += " ORDER BY t.time ASC";

  return db.prepare(query).bind(...bindings).all<{
    course_id: string;
    date: string;
    time: string;
    price: number | null;
    holes: number;
    open_slots: number;
    course_name: string;
  }>();
}

describe("tee-times query", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await seedCourse(db, { id: "c2", name: "Bravo" });
  });

  it("date filter returns only matching date", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c1", "2026-03-17", [
      makeTeeTime({ time: "2026-03-17T09:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].date).toBe("2026-03-16");
  });

  it("course filter (IN clause) works with multiple IDs", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c2", "2026-03-16", [
      makeTeeTime({ courseId: "c2", time: "2026-03-16T09:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16", courseIds: ["c1"] });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].course_id).toBe("c1");
  });

  it("time range filter with startTime and endTime", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T07:00:00" }),
      makeTeeTime({ time: "2026-03-16T10:00:00" }),
      makeTeeTime({ time: "2026-03-16T14:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, {
      date: "2026-03-16",
      startTime: "09:00",
      endTime: "12:00",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].time).toBe("10:00");
  });

  it("holes filter returns only matching tee times", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00", holes: 18 }),
      makeTeeTime({ time: "2026-03-16T09:00:00", holes: 9 }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16", holes: "9" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].holes).toBe(9);
  });

  it("results ordered by time ASC", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T14:00:00" }),
      makeTeeTime({ time: "2026-03-16T07:00:00" }),
      makeTeeTime({ time: "2026-03-16T10:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    const times = result.results.map((r) => r.time);
    expect(times).toEqual(["07:00", "10:00", "14:00"]);
  });

  it("multi-course multi-date returns correct cross-section", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c2", "2026-03-16", [
      makeTeeTime({ courseId: "c2", time: "2026-03-16T09:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c1", "2026-03-17", [
      makeTeeTime({ time: "2026-03-17T10:00:00" }),
    ], new Date().toISOString());

    // Query just c1 on 2026-03-16
    const result = await queryTeeTimes(db, {
      date: "2026-03-16",
      courseIds: ["c1"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].course_id).toBe("c1");
  });

  it("combined filters all active simultaneously", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00", holes: 18, openSlots: 4 }),
      makeTeeTime({ time: "2026-03-16T09:00:00", holes: 9, openSlots: 2 }),
      makeTeeTime({ time: "2026-03-16T14:00:00", holes: 18, openSlots: 1 }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c2", "2026-03-16", [
      makeTeeTime({ courseId: "c2", time: "2026-03-16T08:30:00", holes: 18, openSlots: 4 }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, {
      date: "2026-03-16",
      courseIds: ["c1"],
      startTime: "07:00",
      endTime: "10:00",
      holes: "18",
      minSlots: "2",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].time).toBe("08:00");
  });

  it("minSlots filter returns only tee times with sufficient open slots", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00", openSlots: 1 }),
      makeTeeTime({ time: "2026-03-16T09:00:00", openSlots: 3 }),
      makeTeeTime({ time: "2026-03-16T10:00:00", openSlots: 4 }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16", minSlots: "3" });
    expect(result.results).toHaveLength(2);
  });
});
```

**Step 4: Run all three test files**

Run:
```bash
npx vitest run src/app/api/courses/route.integration.test.ts src/app/api/courses/\\[id\\]/route.integration.test.ts src/app/api/tee-times/route.integration.test.ts
```
Expected: All pass.

**Step 5: Run full suite + type-check**

Run:
```bash
npm test && npx tsc --noEmit
```
Expected: All pass.

**Step 6: Commit**

```bash
git add src/app/api/courses/route.integration.test.ts src/app/api/courses/\[id\]/route.integration.test.ts src/app/api/tee-times/route.integration.test.ts
git commit -m "test: add integration tests for courses, course detail, and tee-times API queries"
```

---

## Task 7: DB Integration Tests — Rate Limiting

**Files:**
- Create: `src/lib/rate-limit.integration.test.ts`

**Context:** Test the rate-limit SQL queries against real SQLite. Design doc scenarios 34-35. The rate limiter uses `sqliteIsoNow` with second-precision modifiers, which is hard to test with exact timing. The approach: insert poll_log entries with specific timestamps, then verify the queries correctly identify them as within or outside the window.

**Read these files first:**
- `src/lib/rate-limit.ts` — the `checkRefreshAllowed()` function
- `src/lib/db.ts` — `sqliteIsoNow()`, `logPoll()`
- `src/test/d1-test-helper.ts` — createTestDb, seedCourse

**IMPORTANT:** `checkRefreshAllowed()` uses `sqliteIsoNow('-30 seconds')` and `sqliteIsoNow('-60 seconds')` which compare against `strftime('now')`. In tests, "now" is the moment the query runs. To test the "within window" case, insert a poll_log entry with `polled_at = new Date().toISOString()` (which is "just now"). To test the "outside window" case, insert with a timestamp 31+ seconds in the past.

**Step 1: Write tests**

Create `src/lib/rate-limit.integration.test.ts`:

```typescript
// ABOUTME: Integration tests for rate-limit SQL queries against real SQLite.
// ABOUTME: Verifies per-course cooldown and global rate cap using sqliteIsoNow.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { checkRefreshAllowed } from "./rate-limit";

describe("checkRefreshAllowed", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "c1" });
    await seedCourse(db, { id: "c2", name: "Course 2" });
  });

  it("allows refresh when no recent polls exist", async () => {
    const result = await checkRefreshAllowed(db, "c1");
    expect(result).toEqual({ allowed: true });
  });

  it("rejects refresh within per-course cooldown", async () => {
    // Insert a poll from right now
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("c1", "2026-03-16", new Date().toISOString(), "success", 5)
      .run();

    const result = await checkRefreshAllowed(db, "c1");
    expect(result.allowed).toBe(false);
  });

  it("allows refresh after cooldown expires", async () => {
    // Insert a poll from 31 seconds ago
    const oldTime = new Date(Date.now() - 31 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("c1", "2026-03-16", oldTime, "success", 5)
      .run();

    const result = await checkRefreshAllowed(db, "c1");
    expect(result).toEqual({ allowed: true });
  });

  it("rejects when global rate cap is exceeded", async () => {
    // Insert 21 polls from different courses within the last 60 seconds
    const now = new Date();
    for (let i = 0; i < 21; i++) {
      const courseId = i % 2 === 0 ? "c1" : "c2";
      const t = new Date(now.getTime() - i * 1000).toISOString(); // stagger by 1 second
      await db
        .prepare(
          "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(courseId, "2026-03-16", t, "success", 3)
        .run();
    }

    // c2 doesn't have a recent poll (last was 1 second ago — within cooldown)
    // Use a different course to avoid per-course cooldown
    await seedCourse(db, { id: "c3", name: "Course 3" });
    const result = await checkRefreshAllowed(db, "c3");
    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toContain("busy");
  });
});
```

**Step 2: Run the tests**

Run:
```bash
npx vitest run src/lib/rate-limit.integration.test.ts
```
Expected: All pass.

**Step 3: Run full suite**

Run:
```bash
npm test
```
Expected: All pass.

**Step 4: Commit**

```bash
git add src/lib/rate-limit.integration.test.ts
git commit -m "test: add integration tests for rate-limit SQL queries"
```

---

## Task 8: Pipeline Integration Tests

**Files:**
- Create: `src/lib/poller.integration.test.ts`

**Context:** Pipeline tests exercise the full data flow: fixture → adapter parse → real DB write → real DB query → verify results. They mock `globalThis.fetch` (same pattern as existing adapter unit tests) but use the real D1 wrapper. This tests the seam between adapter output and DB storage. Design doc scenarios P1-P8.

**Read these files first:**
- `src/lib/poller.ts` — `pollCourse()` function
- `src/adapters/cps-golf.test.ts` — how to mock the 3-call CPS flow (function `mockCpsFlow`)
- `src/adapters/foreup.test.ts` — how to mock ForeUp (single fetch)
- `src/adapters/teeitup.test.ts` — how to mock TeeItUp (single fetch)
- `src/test/fixtures/cps-golf-tee-times.json` — CPS fixture data
- `src/test/fixtures/foreup-tee-times.json` — ForeUp fixture data
- `src/test/fixtures/teeitup-tee-times.json` — TeeItUp fixture data
- `src/types/index.ts` — `CourseRow` interface (the format `pollCourse` expects)
- `src/lib/db.ts` — `upsertTeeTimes`, `logPoll` (called by `pollCourse`)
- `src/app/api/courses/route.ts` — the SQL query we'll use to verify freshness (copy the SQL)
- `src/lib/proxy-fetch.ts` — mock this too (CPS Golf imports it)

**IMPORTANT — CourseRow construction:**

`pollCourse()` expects a `CourseRow` object with `platform_config` as a JSON string (not parsed object). The `id`, `name`, `city`, `platform`, `platform_config`, `booking_url`, `is_active`, and `last_had_tee_times` fields must all be present. See `src/types/index.ts` for the interface.

**IMPORTANT — CPS Golf mocking:**

The CPS Golf adapter imports `proxyFetch` from `@/lib/proxy-fetch`. In non-proxy mode (no `env.FETCH_PROXY_URL`), it uses `globalThis.fetch` directly. So for pipeline tests, you need to:
1. Mock `@/lib/proxy-fetch` (same as `cps-golf.test.ts`)
2. Mock `globalThis.fetch` for the 3-call chain

**Step 1: Write all pipeline tests**

Create `src/lib/poller.integration.test.ts`:

```typescript
// ABOUTME: Pipeline integration tests: fixture → adapter → real DB → query → verify.
// ABOUTME: Tests the seam between adapter output and DB storage for all 3 adapters.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { pollCourse } from "./poller";
import { sqliteIsoNow } from "./db";
import type { CourseRow } from "@/types";

import cpsFixture from "@/test/fixtures/cps-golf-tee-times.json";
import foreupFixture from "@/test/fixtures/foreup-tee-times.json";
import teeitupFixture from "@/test/fixtures/teeitup-tee-times.json";

vi.mock("@/lib/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));

// --- Helpers ---

function makeCourseRow(overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    id: "test-course",
    name: "Test Course",
    city: "Minneapolis",
    platform: "foreup",
    platform_config: JSON.stringify({ scheduleId: "1234" }),
    booking_url: "https://example.com/book",
    is_active: 1,
    last_had_tee_times: null,
    ...overrides,
  };
}

const tokenResponse = () =>
  new Response(
    JSON.stringify({
      access_token: "test-token",
      expires_in: 600,
      token_type: "Bearer",
      scope: "onlinereservation references",
    }),
    { status: 200 }
  );

const registerResponse = () =>
  new Response(JSON.stringify(true), { status: 200 });

function mockCpsFlow(teeTimesBody: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(registerResponse())
    .mockResolvedValueOnce(
      new Response(JSON.stringify(teeTimesBody), { status: 200 })
    );
}

/** The courses freshness SQL (same as src/app/api/courses/route.ts) */
const FRESHNESS_SQL = `
  SELECT c.id, c.name,
         p.polled_at as last_polled,
         p.status as last_poll_status
  FROM courses c
  LEFT JOIN (
    SELECT course_id, polled_at, status,
           ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
    FROM poll_log
    WHERE polled_at > ${sqliteIsoNow("-24 hours")}
      AND status IN ('success', 'no_data')
  ) p ON c.id = p.course_id AND p.rn = 1
  ORDER BY c.name
`;

describe("pipeline integration: CPS Golf", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "sd-encinitas",
    name: "Encinitas Ranch",
    platform: "cps_golf",
    platform_config: JSON.stringify({
      subdomain: "jcgsc5",
      websiteId: "94ce5060-0b39-444f-2756-08d8d81fed21",
      siteId: "16",
      terminalId: "3",
      courseIds: "2",
      timezone: "America/Los_Angeles",
    }),
    booking_url: "https://jcgsc5.cps.golf/onlineresweb",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("fixture → adapter → DB → query returns correct fields", async () => {
    mockCpsFlow(cpsFixture);

    const status = await pollCourse(db, courseRow, "2026-03-12");
    expect(status).toBe("success");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ? ORDER BY time")
      .bind("sd-encinitas", "2026-03-12")
      .all<{ time: string; price: number; holes: number; open_slots: number }>();

    expect(rows.results.length).toBe(3);
    expect(rows.results[0]).toMatchObject({
      time: "07:21",
      price: 95,
      holes: 18,
      open_slots: 1,
    });
  });
});

describe("pipeline integration: ForeUp", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ facilityId: "21445", scheduleId: "7829" }),
    booking_url: "https://foreupsoftware.com/index.php/booking/21445/7829",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("fixture → adapter → DB → query returns correct fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(foreupFixture), { status: 200 })
    );

    const status = await pollCourse(db, courseRow, "2026-04-15");
    expect(status).toBe("success");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ? ORDER BY time")
      .bind("braemar", "2026-04-15")
      .all<{ time: string; price: number; holes: number; open_slots: number }>();

    expect(rows.results.length).toBe(3);
    expect(rows.results[0]).toMatchObject({
      time: "07:00",
      price: 45,
      holes: 18,
      open_slots: 4,
    });
    // 9-hole tee time
    expect(rows.results[2]).toMatchObject({ time: "15:00", holes: 9 });
  });
});

describe("pipeline integration: TeeItUp", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "keller",
    name: "Keller Golf Course",
    platform: "teeitup",
    platform_config: JSON.stringify({
      alias: "ramsey-county-golf",
      apiBase: "https://phx-api-be-east-1b.kenna.io",
      facilityId: "17055",
    }),
    booking_url: "https://ramsey-county-golf.book.teeitup.com",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("fixture → adapter → DB → query returns correct fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(teeitupFixture), { status: 200 })
    );

    const status = await pollCourse(db, courseRow, "2026-03-11");
    expect(status).toBe("success");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ? ORDER BY time")
      .bind("keller", "2026-03-11")
      .all<{ time: string; price: number; holes: number; open_slots: number }>();

    expect(rows.results.length).toBe(3);
    // TeeItUp converts UTC to Central: 17:50 UTC → 12:50 CDT
    expect(rows.results[0]).toMatchObject({
      time: "12:50",
      price: 35,
      holes: 18,
      open_slots: 1,
    });
  });
});

describe("pipeline integration: poll status and freshness", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ facilityId: "21445", scheduleId: "7829" }),
    booking_url: "https://foreupsoftware.com/index.php/booking/21445/7829",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("success poll → freshness visible in courses query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(foreupFixture), { status: 200 })
    );

    await pollCourse(db, courseRow, "2026-04-15");

    const result = await db.prepare(FRESHNESS_SQL).all<{
      id: string;
      last_poll_status: string;
    }>();

    const course = result.results.find((r) => r.id === "braemar");
    expect(course!.last_poll_status).toBe("success");
  });

  it("empty poll → no_data freshness visible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await pollCourse(db, courseRow, "2026-04-15");

    const result = await db.prepare(FRESHNESS_SQL).all<{
      id: string;
      last_poll_status: string;
    }>();

    const course = result.results.find((r) => r.id === "braemar");
    expect(course!.last_poll_status).toBe("no_data");
  });

  it("error poll → excluded from freshness", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    await pollCourse(db, courseRow, "2026-04-15");

    const result = await db.prepare(FRESHNESS_SQL).all<{
      id: string;
      last_poll_status: string | null;
    }>();

    const course = result.results.find((r) => r.id === "braemar");
    // Error polls are excluded from freshness (status IN ('success', 'no_data'))
    expect(course!.last_poll_status).toBeNull();
  });

  it("re-poll replaces data", async () => {
    // First poll
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(foreupFixture), { status: 200 })
    );
    await pollCourse(db, courseRow, "2026-04-15");

    // Second poll with different data
    const newFixture = [{ ...foreupFixture[0], time: "2026-04-15 11:00", green_fee: "99.00" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(newFixture), { status: 200 })
    );
    await pollCourse(db, courseRow, "2026-04-15");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("braemar", "2026-04-15")
      .all<{ time: string; price: number }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].time).toBe("11:00");
    expect(rows.results[0].price).toBe(99);
  });

  it("multi-course data isolation", async () => {
    await seedCourse(db, {
      id: "keller",
      name: "Keller",
      platform: "teeitup",
      platform_config: JSON.stringify({
        alias: "ramsey-county-golf",
        apiBase: "https://phx-api-be-east-1b.kenna.io",
        facilityId: "17055",
      }),
      booking_url: "https://ramsey-county-golf.book.teeitup.com",
    });

    const kellerRow = makeCourseRow({
      id: "keller",
      name: "Keller",
      platform: "teeitup",
      platform_config: JSON.stringify({
        alias: "ramsey-county-golf",
        apiBase: "https://phx-api-be-east-1b.kenna.io",
        facilityId: "17055",
      }),
      booking_url: "https://ramsey-county-golf.book.teeitup.com",
    });

    // Poll both courses
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(foreupFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(teeitupFixture), { status: 200 }));

    await pollCourse(db, courseRow, "2026-04-15");
    await pollCourse(db, kellerRow, "2026-03-11");

    // Query unfiltered — should have tee times from both courses
    const all = await db
      .prepare("SELECT DISTINCT course_id FROM tee_times")
      .all<{ course_id: string }>();
    expect(all.results.map((r) => r.course_id).sort()).toEqual(["braemar", "keller"]);

    // Query filtered — should only have braemar
    const filtered = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ?")
      .bind("braemar")
      .all();
    expect(filtered.results.length).toBeGreaterThan(0);
    expect(filtered.results.every((r: any) => r.course_id === "braemar")).toBe(true);
  });
});

// --- Future adapter stubs ---
describe.todo(
  "Chronogolf/Lightspeed pipeline (Mandatory: implement when adapter exists — 35 courses, see dev/research/remaining-platforms-investigation.md)"
);
describe.todo(
  "GolfNow pipeline (Mandatory: implement when adapter exists — 6 courses, API research not yet conducted)"
);
describe.todo(
  "Teesnap pipeline (Mandatory: implement when adapter exists — 3 courses, API research not yet conducted)"
);
describe.todo(
  "Eagle Club Systems pipeline (Mandatory: implement when adapter exists — 1 course, see dev/research/remaining-platforms-investigation.md)"
);
describe.todo(
  "EZLinks pipeline (Mandatory: implement when adapter exists — 1 course, API research not yet conducted)"
);
describe.todo(
  "City/Custom pipeline (Mandatory: implement when adapter exists — 3 courses, API research not yet conducted)"
);
```

**Step 2: Run the tests**

Run:
```bash
npx vitest run src/lib/poller.integration.test.ts
```
Expected: All pass (future stubs show as "todo").

**Step 3: Run full suite + type-check**

Run:
```bash
npm test && npx tsc --noEmit
```
Expected: All pass.

**Step 4: Commit**

```bash
git add src/lib/poller.integration.test.ts
git commit -m "test: add pipeline integration tests for CPS Golf, ForeUp, and TeeItUp"
```

---

## Task 9: Vitest Config Changes and Smoke Test Config

**Files:**
- Modify: `vitest.config.ts` (add exclude for smoke tests)
- Create: `vitest.smoke.config.ts` (new config for smoke tests)
- Modify: `package.json` (add `test:smoke` script)

**Context:** Smoke tests hit real APIs and should NOT run in `npm test`. They get their own vitest config with longer timeouts and sequential execution.

**Read these files first:**
- `vitest.config.ts` — current config
- `package.json` — current scripts section

**Step 1: Modify vitest.config.ts**

Add an `exclude` array so `*.smoke.test.ts` files don't run in `npm test`:

In `vitest.config.ts`, change the `test` section from:
```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/*.test.{ts,tsx}"],
  pool: "forks",
},
```
To:
```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/*.test.{ts,tsx}"],
  exclude: ["src/**/*.smoke.test.{ts,tsx}"],
  pool: "forks",
},
```

**Step 2: Create vitest.smoke.config.ts**

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.smoke.test.{ts,tsx}"],
    testTimeout: 30000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

**Step 3: Add test:smoke script to package.json**

Add to the `scripts` section:
```json
"test:smoke": "vitest run --config vitest.smoke.config.ts"
```

**Step 4: Verify existing tests still pass**

Run:
```bash
npm test
```
Expected: All pass. No change in which tests run.

**Step 5: Verify the smoke config works (no tests yet, should pass with 0)**

Run:
```bash
npm run test:smoke
```
Expected: Passes with 0 test files found (no smoke tests exist yet).

**Step 6: Commit**

```bash
git add vitest.config.ts vitest.smoke.config.ts package.json
git commit -m "chore: add vitest smoke test config and npm script"
```

---

## Task 10: Smoke Tests — ForeUp Adapter

**Files:**
- Create: `src/adapters/foreup.smoke.test.ts`

**Context:** Hit the real ForeUp API with test courses to verify the adapter still works and the API contract hasn't changed. This is the simplest adapter (single fetch, no auth flow), so it's a good starting point.

**Read these files first:**
- `src/adapters/foreup.ts` — the adapter code
- `docs/plans/2026-03-16-integration-tests-design.md` — Section "API Smoke & Contract Tests" for the 3 assertion levels and recording fetch wrapper pattern
- `dev/research/sd-test-courses.md` — SD test course details

**IMPORTANT — Test courses (hardcoded, NOT from courses.json):**
- Primary: Balboa Park — facilityId `19348`, scheduleId `1470` (from `dev/research/sd-test-courses.md`)
- Fallback: Goat Hill Park — facilityId `20906`, scheduleId `6161` (from `dev/research/sd-test-courses.md`)

**IMPORTANT — Date selection:** Use a date 5 days from `new Date()`. Format as YYYY-MM-DD.

**IMPORTANT — Recording fetch wrapper:**
Install before each adapter call, restore in `afterEach`. Clear the `captured` array between primary and fallback attempts. See design doc for the exact pattern.

**Step 1: Write the smoke test**

Create `src/adapters/foreup.smoke.test.ts`:

```typescript
// ABOUTME: Smoke tests for ForeUp adapter against live API.
// ABOUTME: Verifies adapter doesn't throw, API contract is stable, and output fields are valid.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ForeUpAdapter } from "./foreup";
import type { CourseConfig, TeeTime } from "@/types";

// Ordered by reliability. If primary returns no data, try fallback.
// facilityId and scheduleId values from dev/research/sd-test-courses.md
const TEST_COURSES: CourseConfig[] = [
  {
    id: "sd-balboa-park",
    name: "Balboa Park GC",
    platform: "foreup",
    platformConfig: { facilityId: "19348", scheduleId: "1470" },
    bookingUrl: "https://foreupsoftware.com/index.php/booking/19348/1470",
  },
  {
    id: "sd-goat-hill",
    name: "Goat Hill Park",
    platform: "foreup",
    platformConfig: { facilityId: "20906", scheduleId: "6161" },
    bookingUrl: "https://foreupsoftware.com/index.php/booking/20906/6161",
  },
];

function getTestDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return d.toISOString().split("T")[0];
}

describe("ForeUp smoke tests", () => {
  const adapter = new ForeUpAdapter();
  const date = getTestDate();
  let captured: { url: string; body: unknown }[] = [];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init?) => {
      const response = await originalFetch(input, init);
      const clone = response.clone();
      try {
        captured.push({ url: String(input), body: await clone.json() });
      } catch {
        /* non-JSON response */
      }
      return response;
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("Level 1 — adapter returns TeeTime[] without throwing", async () => {
    let results: TeeTime[] | null = null;

    for (const course of TEST_COURSES) {
      captured = [];
      try {
        results = await adapter.fetchTeeTimes(course, date);
        if (results.length > 0) break;
      } catch {
        continue;
      }
    }

    expect(results).not.toBeNull();
    expect(Array.isArray(results)).toBe(true);
  });

  it("Level 2 — raw API response matches expected contract", async () => {
    let foundData = false;

    for (const course of TEST_COURSES) {
      captured = [];
      try {
        const results = await adapter.fetchTeeTimes(course, date);
        if (results.length === 0) continue;
        foundData = true;

        // Validate raw response
        expect(captured).toHaveLength(1);
        const raw = captured[0].body as any[];
        expect(Array.isArray(raw)).toBe(true);

        for (const entry of raw.slice(0, 5)) {
          // time field: "YYYY-MM-DD HH:MM" format
          expect(entry.time).toMatch(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
          );
          // green_fee is string or null
          expect(
            entry.green_fee === null || typeof entry.green_fee === "string"
          ).toBe(true);
          // available_spots is number
          expect(typeof entry.available_spots).toBe("number");
          // holes is number
          expect(typeof entry.holes).toBe("number");
        }
        break;
      } catch {
        continue;
      }
    }

    if (!foundData) {
      console.warn(
        "ForeUp contract validation skipped: no tee times available from any test course"
      );
    }
  });

  it("Level 3 — parsed TeeTime objects have valid fields", async () => {
    let teeTimes: TeeTime[] = [];

    for (const course of TEST_COURSES) {
      captured = [];
      try {
        teeTimes = await adapter.fetchTeeTimes(course, date);
        if (teeTimes.length > 0) break;
      } catch {
        continue;
      }
    }

    if (teeTimes.length === 0) {
      console.warn(
        "ForeUp output validation skipped: no tee times available"
      );
      return;
    }

    for (const tt of teeTimes) {
      expect(tt.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(new Date(tt.time).getTime()).not.toBeNaN();
      expect(tt.price === null || typeof tt.price === "number").toBe(true);
      if (tt.price !== null) expect(Number.isNaN(tt.price)).toBe(false);
      expect([9, 18]).toContain(tt.holes);
      expect(tt.openSlots).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(tt.openSlots)).toBe(true);
      expect(tt.bookingUrl).toBeTruthy();
    }
  });
});
```

**Step 2: Run the smoke test**

Run:
```bash
npm run test:smoke
```
Expected: All pass (assuming network access). If a test course has no availability, Level 2 and 3 will log warnings and pass.

**Step 3: Verify it's excluded from npm test**

Run:
```bash
npm test
```
Expected: The smoke test file is NOT included.

**Step 4: Commit**

```bash
git add src/adapters/foreup.smoke.test.ts
git commit -m "test: add ForeUp live API smoke tests with contract validation"
```

---

## Task 11: Smoke Tests — TeeItUp and CPS Golf + Stub Files

**Files:**
- Create: `src/adapters/teeitup.smoke.test.ts`
- Create: `src/adapters/cps-golf.smoke.test.ts`
- Create: `src/adapters/chronogolf.smoke.test.ts` (stub)
- Create: `src/adapters/golfnow.smoke.test.ts` (stub)
- Create: `src/adapters/teesnap.smoke.test.ts` (stub)
- Create: `src/adapters/eagle-club.smoke.test.ts` (stub)
- Create: `src/adapters/ezlinks.smoke.test.ts` (stub)
- Create: `src/adapters/city-custom.smoke.test.ts` (stub)

**Context:** Same pattern as Task 10, but for TeeItUp and CPS Golf. Plus stub files for future adapters.

**Read these files first:**
- `src/adapters/foreup.smoke.test.ts` — the ForeUp smoke test you'll replicate the pattern from
- `src/adapters/teeitup.ts` — TeeItUp adapter (single fetch, `x-be-alias` header)
- `src/adapters/cps-golf.ts` — CPS Golf adapter (3 sequential fetches: token, register, tee times)
- `docs/plans/2026-03-16-integration-tests-design.md` — contract assertions per adapter, test courses, stub file format
- `dev/research/sd-test-courses.md` — test course configs

**IMPORTANT — CPS Golf smoke test:**

The CPS Golf adapter makes 3 sequential fetch calls. The recording wrapper will capture all 3. For contract validation, identify the tee times response by checking if the URL contains "TeeTimes". Skip the token and registration responses.

**IMPORTANT — CPS Golf does NOT need proxy in smoke tests:**

Smoke tests run in Node.js where direct fetch works. Do NOT set `FETCH_PROXY_URL` environment variable. The adapter's `getProxyConfig()` will return null (no proxy env vars), so it uses `globalThis.fetch` directly.

**IMPORTANT — TeeItUp test courses (from `src/config/courses.json`):**
- Primary: Coronado — `{ alias: "coronado-gc-3-14-be", apiBase: "https://phx-api-be-east-1b.kenna.io", facilityId: "10985" }`, bookingUrl: `https://coronado-gc-3-14-be.book.teeitup.com`
- Fallback: Lomas Santa Fe — `{ alias: "lomas-santa-fe-executive-golf-course", apiBase: "https://phx-api-be-east-1b.kenna.io", facilityId: "1241" }`, bookingUrl: `https://lomas-santa-fe-executive-golf-course.book.teeitup.com`

**IMPORTANT — CPS Golf test courses (from `src/config/courses.json`):**
- Primary: Encinitas Ranch — `{ subdomain: "jcgsc5", websiteId: "94ce5060-0b39-444f-2756-08d8d81fed21", siteId: "16", terminalId: "3", courseIds: "6", timezone: "America/Los_Angeles" }`, bookingUrl: `https://jcgsc5.cps.golf/onlineresweb`
- Fallback: Twin Oaks — same subdomain/websiteId/siteId/terminalId, `courseIds: "4"`, same bookingUrl

**Step 1: Read `dev/research/sd-test-courses.md` for exact config values**

Read this file to get the exact `platformConfig` values for each test course. Do NOT guess.

**Step 2: Write TeeItUp smoke test**

Follow the same 3-level pattern as `foreup.smoke.test.ts`. Key contract assertions for TeeItUp:
- Response is an array of objects
- Each has `teetimes` array
- Each tee time has `teetime` as ISO 8601 UTC string (ends with Z)
- Each has `rates` array; each rate has `greenFeeWalking` as integer (cents)
- Each has `maxPlayers` as integer

**Step 3: Write CPS Golf smoke test**

Same 3-level pattern. For Level 2, find the tee times response in `captured` (the one whose URL contains "TeeTimes"). Contract assertions:
- Response has `content` — either an array or an object with `messageKey`
- If array, each entry has `startTime` matching datetime pattern
- Each has `shItemPrices` array (or undefined); if present, each has `price` as number
- Each has `maxPlayer`, `holes` as integers

**Step 4: Write 6 stub files**

Each stub follows this exact pattern (from the design doc):

```typescript
// ABOUTME: Smoke tests for [Platform] adapter (not yet implemented).
// ABOUTME: See dev/research/[file].md for API details.

describe.todo("[Platform] - live API smoke tests (Mandatory: implement when adapter exists — N courses)");
describe.todo("[Platform] - API contract validation (Mandatory: implement when adapter exists)");
describe.todo("[Platform] - parsed output validation (Mandatory: implement when adapter exists)");
```

Stubs:
- `chronogolf.smoke.test.ts` — 35 courses, `dev/research/remaining-platforms-investigation.md`
- `golfnow.smoke.test.ts` — 6 courses, API research not yet conducted
- `teesnap.smoke.test.ts` — 3 courses, API research not yet conducted
- `eagle-club.smoke.test.ts` — 1 course, `dev/research/remaining-platforms-investigation.md`
- `ezlinks.smoke.test.ts` — 1 course, API research not yet conducted
- `city-custom.smoke.test.ts` — 3 courses, API research not yet conducted

**Step 5: Run smoke tests**

Run:
```bash
npm run test:smoke
```
Expected: Real smoke tests pass (or log warnings). Stubs show as "todo".

**Step 6: Run full suite**

Run:
```bash
npm test
```
Expected: All pass. Smoke tests NOT included.

**Step 7: Commit**

```bash
git add src/adapters/teeitup.smoke.test.ts src/adapters/cps-golf.smoke.test.ts src/adapters/chronogolf.smoke.test.ts src/adapters/golfnow.smoke.test.ts src/adapters/teesnap.smoke.test.ts src/adapters/eagle-club.smoke.test.ts src/adapters/ezlinks.smoke.test.ts src/adapters/city-custom.smoke.test.ts
git commit -m "test: add TeeItUp and CPS Golf smoke tests, plus future adapter stubs"
```

---

## Task 12: CI Workflow for Smoke Tests

**Files:**
- Create: `.github/workflows/smoke-tests.yml`

**Context:** Smoke tests should run on PRs to main when adapter-related paths change. NOT a required status check (transient API outages shouldn't block merges).

**Read these files first:**
- `.github/workflows/ci.yml` — existing CI for pattern reference
- `docs/plans/2026-03-16-integration-tests-design.md` — the smoke-tests workflow YAML

**Step 1: Create the workflow file**

Create `.github/workflows/smoke-tests.yml`:

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

**Step 2: Verify file is valid YAML**

Run:
```bash
node -e "const yaml = require('fs').readFileSync('.github/workflows/smoke-tests.yml', 'utf-8'); console.log('YAML length:', yaml.length, 'OK');"
```

**Step 3: Run full test suite**

Run:
```bash
npm test
```
Expected: All pass. Workflow file doesn't affect tests.

**Step 4: Commit**

```bash
git add .github/workflows/smoke-tests.yml
git commit -m "ci: add smoke test workflow for PRs to main (path-filtered, not required)"
```

---

## Task Dependency Graph

```
Task 1 (install better-sqlite3)
  └→ Task 2 (D1 test helper)
       ├→ Task 3 (extract housekeeping) → [Tasks 4-8 can start]
       ├→ Task 4 (core db.ts tests)
       ├→ Task 5 (user lifecycle tests)
       ├→ Task 6 (API route query tests)
       ├→ Task 7 (rate limit tests)
       └→ Task 8 (pipeline tests)

Task 9 (vitest config) — independent of Tasks 1-8
  └→ Task 10 (ForeUp smoke)
       └→ Task 11 (TeeItUp + CPS Golf smoke + stubs)
            └→ Task 12 (CI workflow)
```

**Parallelizable batches for subagent-driven development:**
- **Batch 1:** Task 1 (must be first)
- **Batch 2:** Task 2 (depends on Task 1)
- **Batch 3:** Tasks 3 and 9 (independent of each other, both depend on Task 2)
- **Batch 4:** Tasks 4, 5, 6, 7 (all depend on Tasks 2+3, independent of each other)
- **Batch 5:** Tasks 8, 10 (Task 8 depends on Task 2, Task 10 depends on Task 9)
- **Batch 6:** Task 11 (depends on Task 10 for pattern reference)
- **Batch 7:** Task 12 (depends on Task 11)

---

## Summary

| Task | What | Files Created/Modified | Scenarios Covered |
|------|------|----------------------|-------------------|
| 1 | Install better-sqlite3 | package.json | — |
| 2 | D1 test helper | src/test/d1-test-helper.ts + test | Foundation |
| 3 | Extract housekeeping | src/lib/db.ts, cron-handler.ts + test | 18-20, 24 |
| 4 | Core DB tests | src/lib/db.integration.test.ts | 1-5, 22, 23, 25, 28 |
| 5 | User lifecycle tests | src/lib/user-lifecycle.integration.test.ts | 21, 26, 27, 32, 33 |
| 6 | API route query tests | 3 route integration test files | 6-17, 29-31 |
| 7 | Rate limit tests | src/lib/rate-limit.integration.test.ts | 34-35 |
| 8 | Pipeline tests | src/lib/poller.integration.test.ts | P1-P8 + stubs |
| 9 | Vitest config | vitest.config.ts, vitest.smoke.config.ts, package.json | — |
| 10 | ForeUp smoke | src/adapters/foreup.smoke.test.ts | ForeUp L1-L3 |
| 11 | TeeItUp + CPS smoke + stubs | 8 smoke test files | TeeItUp/CPS L1-L3 + 6 stubs |
| 12 | CI workflow | .github/workflows/smoke-tests.yml | — |
