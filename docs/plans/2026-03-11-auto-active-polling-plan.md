# Auto-Active Course Polling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate manual `is_active` management by having the cron handler automatically detect when courses open/close based on tee time results.

**Architecture:** Two-tier polling within the existing 5-minute cron schedule. Active courses get full 7-date dynamic-frequency polling. Inactive courses get an hourly probe of today+tomorrow. Auto-promotion on tee time detection, auto-demotion after 30 days of no results. Seed script changes to idempotent upsert to support deploy-time syncing.

**Tech Stack:** TypeScript, Vitest, D1 (SQLite), Cloudflare Workers cron

**Design doc:** `docs/plans/2026-03-11-auto-active-polling-design.md`

---

### Task 1: D1 Migration — Add `last_had_tee_times` Column

**Files:**
- Create: `migrations/0003_auto_active.sql`

**Context:** The `courses` table currently has `is_active INTEGER NOT NULL DEFAULT 1` and an unused `last_active_check TEXT` column. We need a new `last_had_tee_times TEXT` column to track when a course last returned tee times. We also set all existing courses to `is_active = 1` as a fresh start for the auto-management system.

**Step 1: Write the migration**

```sql
-- Add timestamp for tracking when a course last returned tee times.
-- Used by the cron handler to auto-deactivate courses after 30 days of no results.
ALTER TABLE courses ADD COLUMN last_had_tee_times TEXT;

-- Fresh start: activate all courses so the auto-management system can take over.
UPDATE courses SET is_active = 1;
```

**Step 2: Apply the migration locally and verify**

Run: `npx wrangler d1 migrations apply tee-times-db --local`
Expected: Migration 0003 applied successfully.

Then verify:
Run: `npx wrangler d1 execute tee-times-db --local --command="PRAGMA table_info(courses)"`
Expected: Output includes `last_had_tee_times` column of type TEXT.

**Step 3: Commit**

```bash
git add migrations/0003_auto_active.sql
git commit -m "feat: add last_had_tee_times column to courses table"
```

---

### Task 2: Update `CourseRow` Type

**Files:**
- Modify: `src/types/index.ts:29-38`

**Context:** The `CourseRow` interface must reflect the new column. Replace `last_active_check` with `last_had_tee_times`.

**Step 1: Update the interface**

Change the `CourseRow` interface from:

```typescript
export interface CourseRow {
  id: string;
  name: string;
  city: string;
  platform: string;
  platform_config: string; // JSON string
  booking_url: string;
  is_active: number; // SQLite boolean
  last_active_check: string | null;
}
```

To:

```typescript
export interface CourseRow {
  id: string;
  name: string;
  city: string;
  platform: string;
  platform_config: string; // JSON string
  booking_url: string;
  is_active: number; // SQLite boolean
  last_had_tee_times: string | null;
}
```

**Step 2: Run type-check to verify**

Run: `npx tsc --noEmit`
Expected: No errors (nothing references `last_active_check` anywhere).

If there ARE errors referencing `last_active_check`, fix each usage to use `last_had_tee_times` instead.

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: update CourseRow type with last_had_tee_times"
```

---

### Task 3: Idempotent Seed Script

**Files:**
- Modify: `scripts/seed.ts`
- Regenerated: `scripts/seed.sql` (auto-generated, commit it too)

**Context:** The current seed script does `DELETE FROM tee_times; DELETE FROM poll_log; DELETE FROM courses;` then re-inserts. This is destructive — it wipes runtime state. We need to change it to UPSERT so it can run on every deploy without disrupting `is_active`, `last_had_tee_times`, `tee_times`, or `poll_log`.

**Important:** At the time this task runs, `courses.json` still has `is_active` fields on some entries (they get removed in Task 4). The new seed script simply does not read or use `is_active` from the JSON — the `CourseEntry` interface omits it, so it's ignored during parsing. The script works correctly whether or not `is_active` exists in the JSON.

**Step 1: Rewrite `scripts/seed.ts`**

Replace the entire file with:

```typescript
// ABOUTME: Generates seed SQL from courses.json for D1.
// ABOUTME: Uses UPSERT to sync catalog data without disrupting runtime state.
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Seed script for D1. Generates an idempotent SQL file from courses.json.
 *
 * Uses INSERT ... ON CONFLICT to update catalog fields (name, city, platform,
 * platform_config, booking_url) without touching runtime-managed fields
 * (is_active, last_had_tee_times). New courses get is_active=1 from the
 * column default.
 *
 * Generate: npx tsx scripts/seed.ts
 * Apply locally: npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql
 * Apply remote: npx wrangler d1 execute tee-times-db --remote --file=scripts/seed.sql
 */

interface CourseEntry {
  id: string;
  name: string;
  city: string;
  platform: string;
  platformConfig: Record<string, string>;
  bookingUrl: string;
}

const coursesPath = resolve(__dirname, "../src/config/courses.json");
const courses: CourseEntry[] = JSON.parse(readFileSync(coursesPath, "utf-8"));

const esc = (s: string) => s.replace(/'/g, "''");

const lines: string[] = [
  "-- Auto-generated by scripts/seed.ts — do not edit manually",
  "-- Uses UPSERT: updates catalog fields, preserves runtime state (is_active, last_had_tee_times)",
  "",
];

for (const course of courses) {
  lines.push(
    `INSERT INTO courses (id, name, city, platform, platform_config, booking_url) VALUES ('${esc(course.id)}', '${esc(course.name)}', '${esc(course.city)}', '${esc(course.platform)}', '${esc(JSON.stringify(course.platformConfig))}', '${esc(course.bookingUrl)}') ON CONFLICT(id) DO UPDATE SET name=excluded.name, city=excluded.city, platform=excluded.platform, platform_config=excluded.platform_config, booking_url=excluded.booking_url;`
  );
}

const outputPath = resolve(__dirname, "seed.sql");
writeFileSync(outputPath, lines.join("\n") + "\n");
console.log(`Wrote ${courses.length} courses to ${outputPath}`);
```

**Step 2: Generate the SQL and verify**

Run: `npx tsx scripts/seed.ts`
Expected: `Wrote 24 courses to <path>/scripts/seed.sql`

Then inspect the generated SQL:
Run: `head -10 scripts/seed.sql`
Expected: Lines contain `INSERT INTO courses (id, name, city, platform, platform_config, booking_url) VALUES (...) ON CONFLICT(id) DO UPDATE SET name=excluded.name, ...` — NO `is_active` or `last_had_tee_times` in the statement.

**Step 3: Apply locally and verify it works as upsert**

Run: `npx tsx scripts/seed.ts && npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql`
Expected: No errors.

Run the same command again (second apply should be idempotent):
Run: `npx tsx scripts/seed.ts && npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql`
Expected: No errors. Data unchanged.

**Step 4: Commit**

```bash
git add scripts/seed.ts scripts/seed.sql
git commit -m "feat: make seed script idempotent with UPSERT"
```

---

### Task 4: Remove `is_active` from `courses.json`

**Files:**
- Modify: `src/config/courses.json`

**Context:** `is_active` is now a runtime-only D1 field managed by the cron handler. Remove all `"is_active": 0` lines from `courses.json`. There are currently entries with `"is_active": 0` for many MN courses and one MN ForeUp course (Bunker Hills). The SD test courses had theirs removed in a recent commit.

**Step 1: Remove all `is_active` fields**

Search for every occurrence of `"is_active"` in `src/config/courses.json` and delete the entire line. Also fix the trailing comma: the line ABOVE each deleted `"is_active"` line will have become the last property in its object, so its trailing comma must be removed. Use `grep -c "is_active" src/config/courses.json` before and after to confirm you found and removed ALL occurrences (before: some number > 0, after: 0).

After removal, every course entry should look like:

```json
{
  "index": 7,
  "id": "gross-national",
  "name": "Gross National",
  "city": "Minneapolis",
  "address": "2201 St. Anthony Blvd, Minneapolis, MN 55418",
  "platform": "cps_golf",
  "platformConfig": {
    "subdomain": "minneapolisgrossnational"
  },
  "bookingUrl": "https://minneapolisgrossnational.cps.golf/onlineresweb"
}
```

No `is_active` field on any course.

**Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/config/courses.json','utf-8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass. The `areas.test.ts` tests don't reference `is_active`. The cron handler tests mock the DB. No test should break.

**Step 4: Regenerate seed SQL to reflect the changes**

Run: `npx tsx scripts/seed.ts`
Expected: `Wrote 24 courses to <path>/scripts/seed.sql` — and no `is_active` in the generated SQL.

**Step 5: Commit**

```bash
git add src/config/courses.json scripts/seed.sql
git commit -m "feat: remove is_active from courses.json (now runtime-managed)"
```

---

### Task 5: Remove `(inactive)` Label from `/courses` Page

**Files:**
- Modify: `src/app/courses/page.tsx:14-21` (CatalogCourse interface)
- Modify: `src/app/courses/page.tsx:117-122` (inactive label rendering)

**Context:** Since `is_active` is no longer in `courses.json` and is now a polling implementation detail, the `(inactive)` label should be removed from the courses page.

**Step 1: Remove `is_active` from the `CatalogCourse` interface**

In `src/app/courses/page.tsx`, change the interface from:

```typescript
interface CatalogCourse {
  id: string;
  name: string;
  city: string;
  address?: string;
  bookingUrl: string;
  is_active?: number;
}
```

To:

```typescript
interface CatalogCourse {
  id: string;
  name: string;
  city: string;
  address?: string;
  bookingUrl: string;
}
```

**Step 2: Remove the `(inactive)` label JSX**

Find this block (around line 117-122):

```tsx
{course.is_active === 0 && (
  <span className="ml-1.5 text-xs font-normal text-gray-400">
    (inactive)
  </span>
)}
```

Delete it entirely. The course name link should now just be:

```tsx
<Link
  href={`/courses/${course.id}`}
  className="font-medium text-gray-900 hover:text-green-700 lg:text-lg"
>
  {course.name}
</Link>
```

**Step 3: Run tests and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass, no type errors.

**Step 4: Commit**

```bash
git add src/app/courses/page.tsx
git commit -m "feat: remove (inactive) label from courses page"
```

---

### Task 6: Two-Tier Cron Handler — Failing Tests

**Files:**
- Modify: `src/lib/cron-handler.test.ts`

**Context:** We need to test the new two-tier polling behavior:
1. Active courses polled as before (existing tests cover `shouldRunThisCycle`)
2. Inactive courses probed hourly (today + tomorrow only)
3. `last_had_tee_times` updated when poll returns "success"
4. Auto-promotion: inactive course with tee times → `is_active = 1`
5. Auto-demotion: active course with stale `last_had_tee_times` → `is_active = 0`

The existing mock setup uses `vi.mock("@/lib/poller")` and a `mockDb`. We'll extend this pattern.

**Step 1: Write new test cases**

Add these test cases to `src/lib/cron-handler.test.ts`. Add them after the existing `"runCronPoll cleanup"` describe block:

```typescript
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";

// ... (add this import at the top of the file, alongside the existing imports)

// Access the already-mocked poller functions. The vi.mock("@/lib/poller") at line 42
// already mocks the module. Use vi.mocked() to get typed mock references.
const mockedPollCourse = vi.mocked(pollCourse);
const mockedShouldPollDate = vi.mocked(shouldPollDate);
const mockedGetPollingDates = vi.mocked(getPollingDates);

describe("runCronPoll auto-active management", () => {
  let preparedStatements: string[] = [];
  let boundValues: unknown[][] = [];

  // Helper: creates a mock D1Database that returns the given courses for
  // "SELECT * FROM courses" and the given pollLog entries for the poll_log query.
  // All other queries (UPDATE, DELETE) succeed silently and are tracked in
  // preparedStatements/boundValues for assertion.
  const makeMockDb = (
    courses: Array<{
      id: string;
      is_active: number;
      last_had_tee_times: string | null;
      platform: string;
      platform_config: string;
      booking_url: string;
      name: string;
      city: string;
    }>,
    pollLog: Array<{ course_id: string; date: string; last_polled: string }> = []
  ) => {
    preparedStatements = [];
    boundValues = [];

    return {
      prepare: vi.fn().mockImplementation((sql: string) => {
        preparedStatements.push(sql);
        return {
          bind: vi.fn().mockImplementation((...args: unknown[]) => {
            boundValues.push(args);
            return {
              run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
              all: vi.fn().mockResolvedValue({ results: [] }),
            };
          }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
          all: vi.fn().mockResolvedValue({
            results: sql.includes("FROM courses")
              ? courses
              : sql.includes("poll_log")
                ? pollLog
                : [],
          }),
        };
      }),
    };
  };

  const activeCourse = {
    id: "test-active",
    is_active: 1,
    last_had_tee_times: "2026-04-15T07:00:00.000Z",
    platform: "foreup",
    platform_config: "{}",
    booking_url: "https://example.com",
    name: "Active Course",
    city: "Minneapolis",
  };

  const inactiveCourse = {
    id: "test-inactive",
    is_active: 0,
    last_had_tee_times: null,
    platform: "foreup",
    platform_config: "{}",
    booking_url: "https://example.com",
    name: "Inactive Course",
    city: "Minneapolis",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    // Configure poller mocks for standard behavior
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue([
      "2026-04-15",
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
      "2026-04-19",
      "2026-04-20",
      "2026-04-21",
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("probes inactive courses with today and tomorrow only", async () => {
    const db = makeMockDb([inactiveCourse]);
    await runCronPoll(db as unknown as D1Database);

    // pollCourse should be called with only today and tomorrow (2 dates)
    expect(mockedPollCourse).toHaveBeenCalledTimes(2);
    expect(mockedPollCourse.mock.calls[0][2]).toBe("2026-04-15");
    expect(mockedPollCourse.mock.calls[1][2]).toBe("2026-04-16");
  });

  it("promotes inactive course to active when tee times found", async () => {
    mockedPollCourse.mockResolvedValue("success");
    const db = makeMockDb([inactiveCourse]);
    await runCronPoll(db as unknown as D1Database);

    // Should UPDATE is_active = 1 and last_had_tee_times
    const promotionSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 1") && sql.includes("last_had_tee_times")
    );
    expect(promotionSql).toBeDefined();
  });

  it("does not probe inactive courses if polled less than 1 hour ago", async () => {
    // Pass poll_log data showing a recent poll (30 min ago) for today's date
    const recentPoll = new Date("2026-04-15T06:30:00-05:00").toISOString();
    const db = makeMockDb(
      [inactiveCourse],
      [{ course_id: "test-inactive", date: "2026-04-15", last_polled: recentPoll }]
    );

    await runCronPoll(db as unknown as D1Database);
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });

  it("updates last_had_tee_times when active course poll returns success", async () => {
    mockedPollCourse.mockResolvedValue("success");
    // Only poll today (offset 0) to keep assertions simple
    mockedShouldPollDate.mockImplementation(
      (offset: number) => offset === 0
    );
    const db = makeMockDb([activeCourse]);
    await runCronPoll(db as unknown as D1Database);

    const updateSql = preparedStatements.find(
      (sql) => sql.includes("last_had_tee_times") && !sql.includes("is_active = 0")
    );
    expect(updateSql).toBeDefined();
  });

  it("deactivates courses with no tee times for 30 days", async () => {
    const db = makeMockDb([activeCourse]);
    await runCronPoll(db as unknown as D1Database);

    const deactivateSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 0") && sql.includes("-30 days")
    );
    expect(deactivateSql).toBeDefined();
  });

  it("returns inactiveProbeCount in results", async () => {
    const db = makeMockDb([inactiveCourse]);
    const result = await runCronPoll(db as unknown as D1Database);
    expect(result).toHaveProperty("inactiveProbeCount");
  });
});
```

**IMPORTANT for the implementer:** The test file already has `vi.mock("@/lib/poller")` at line 42, which mocks the entire module. You need to add named imports for `pollCourse`, `shouldPollDate`, and `getPollingDates` at the top of the file (alongside the existing `import { shouldRunThisCycle, runCronPoll } from "./cron-handler"`), then create the `vi.mocked()` wrappers AFTER the `vi.mock()` call. The imports will resolve to the mocked versions because `vi.mock` is hoisted.

The file structure should be:
```
import { ... } from "vitest";
import { shouldRunThisCycle, runCronPoll } from "./cron-handler";
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";  // NEW

// ... existing shouldRunThisCycle tests ...

vi.mock("@/lib/poller", () => ({   // EXISTING (line 42)
  pollCourse: vi.fn(),
  shouldPollDate: vi.fn().mockReturnValue(false),
  getPollingDates: vi.fn().mockReturnValue(["2026-04-15"]),
}));

const mockedPollCourse = vi.mocked(pollCourse);           // NEW
const mockedShouldPollDate = vi.mocked(shouldPollDate);   // NEW
const mockedGetPollingDates = vi.mocked(getPollingDates);  // NEW

// ... existing cleanup tests ...
// ... NEW auto-active tests ...
```

**Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/cron-handler.test.ts`
Expected: The new tests FAIL because the cron handler doesn't implement two-tier polling yet. The existing tests should still pass.

**Step 3: Commit the failing tests**

```bash
git add src/lib/cron-handler.test.ts
git commit -m "test: add failing tests for auto-active two-tier polling"
```

---

### Task 7: Two-Tier Cron Handler — Implementation

**Files:**
- Modify: `src/lib/cron-handler.ts`

**Context:** The cron handler currently queries only `is_active = 1` courses. We need to:
1. Query ALL courses
2. Split into active and inactive
3. Poll active courses as before (7 dates, dynamic frequency)
4. Poll inactive courses hourly (today + tomorrow only)
5. Update `last_had_tee_times` when pollCourse returns "success"
6. Auto-promote inactive courses that return tee times
7. Auto-deactivate active courses with stale `last_had_tee_times` (30 days)
8. Return `inactiveProbeCount` in the result

**Step 1: Rewrite `runCronPoll` in `src/lib/cron-handler.ts`**

Replace ONLY the `runCronPoll` function (lines 43-123). Do NOT modify `shouldRunThisCycle` (lines 17-31) or `sleep` (lines 36-38). The imports at line 1-5 stay the same.

**IMPORTANT:** The return type changes from `{ pollCount, courseCount, skipped }` to `{ pollCount, courseCount, inactiveProbeCount, skipped }`. Check `worker.ts` for any code that destructures or uses this return value — if it does, update it to handle the new `inactiveProbeCount` field. (Currently `worker.ts` likely just logs the result, so this should be a non-issue, but verify.)

```typescript
/**
 * Main cron polling logic. Called by the Worker's scheduled() handler.
 *
 * Two-tier polling:
 * - Active courses: full 7-date polling at dynamic frequency
 * - Inactive courses: hourly probe of today + tomorrow to detect reopening
 */
export async function runCronPoll(db: D1Database): Promise<{
  pollCount: number;
  courseCount: number;
  inactiveProbeCount: number;
  skipped: boolean;
}> {
  const now = new Date();

  if (!shouldRunThisCycle(now)) {
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: true };
  }

  // Fetch ALL courses (active and inactive)
  const coursesResult = await db
    .prepare("SELECT * FROM courses")
    .all<CourseRow>();
  const allCourses = coursesResult.results;

  const activeCourses = allCourses.filter((c) => c.is_active === 1);
  const inactiveCourses = allCourses.filter((c) => c.is_active === 0);

  const todayStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  }); // YYYY-MM-DD
  const dates = getPollingDates(todayStr);

  // Batch-fetch the most recent poll time for every course+date combo (one query)
  const recentPolls = await db
    .prepare(
      `SELECT course_id, date, MAX(polled_at) as last_polled
       FROM poll_log
       WHERE polled_at > datetime('now', '-24 hours')
       GROUP BY course_id, date`
    )
    .all<{ course_id: string; date: string; last_polled: string }>();

  const pollTimeMap = new Map<string, string>();
  for (const row of recentPolls.results) {
    pollTimeMap.set(`${row.course_id}:${row.date}`, row.last_polled);
  }

  let pollCount = 0;
  let inactiveProbeCount = 0;

  // --- Active courses: full 7-date polling at dynamic frequency ---
  for (const course of activeCourses) {
    try {
      for (let i = 0; i < dates.length; i++) {
        const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
        const minutesSinceLast = lastPolled
          ? (Date.now() - new Date(lastPolled).getTime()) / 60000
          : Infinity;

        if (shouldPollDate(i, minutesSinceLast)) {
          const status = await pollCourse(db, course, dates[i]);
          pollCount++;

          if (status === "success") {
            await db
              .prepare("UPDATE courses SET last_had_tee_times = ? WHERE id = ?")
              .bind(now.toISOString(), course.id)
              .run();
          }

          await sleep(250);
        }
      }
    } catch (err) {
      console.error(`Error polling course ${course.id}:`, err);
    }
  }

  // --- Inactive courses: hourly probe of today + tomorrow ---
  const probeDates = dates.slice(0, 2); // today + tomorrow

  for (const course of inactiveCourses) {
    try {
      // Check if this course was probed in the last hour
      const lastProbed = pollTimeMap.get(`${course.id}:${probeDates[0]}`);
      const minutesSinceProbe = lastProbed
        ? (Date.now() - new Date(lastProbed).getTime()) / 60000
        : Infinity;

      if (minutesSinceProbe < 60) continue;

      let foundTeeTimes = false;

      for (const date of probeDates) {
        const status = await pollCourse(db, course, date);
        inactiveProbeCount++;

        if (status === "success") {
          foundTeeTimes = true;
        }

        await sleep(250);
      }

      // Auto-promote: flip to active if tee times were found
      if (foundTeeTimes) {
        await db
          .prepare("UPDATE courses SET is_active = 1, last_had_tee_times = ? WHERE id = ?")
          .bind(now.toISOString(), course.id)
          .run();
        console.log(`Auto-activated course ${course.id}: tee times detected`);
      }
    } catch (err) {
      console.error(`Error probing inactive course ${course.id}:`, err);
    }
  }

  // --- Auto-deactivate: courses with no tee times for 30 days ---
  try {
    const deactivated = await db
      .prepare(
        `UPDATE courses SET is_active = 0
         WHERE is_active = 1
           AND (last_had_tee_times IS NULL OR last_had_tee_times < datetime('now', '-30 days'))`
      )
      .run();
    if (deactivated.meta?.changes && deactivated.meta.changes > 0) {
      console.log(`Auto-deactivated ${deactivated.meta.changes} course(s): no tee times for 30 days`);
    }
  } catch (err) {
    console.error("Auto-deactivation error:", err);
  }

  // Purge poll_log entries older than 7 days to prevent unbounded growth
  try {
    await db
      .prepare("DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')")
      .run();
  } catch (err) {
    console.error("poll_log cleanup error:", err);
  }

  // Remove expired sessions
  try {
    await db
      .prepare("DELETE FROM sessions WHERE expires_at < datetime('now')")
      .run();
  } catch (err) {
    console.error("session cleanup error:", err);
  }

  return { pollCount, courseCount: activeCourses.length, inactiveProbeCount, skipped: false };
}
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass, including the new auto-active tests from Task 6.

If tests fail, debug and fix. The most likely issues:
- Mock DB `all()` return needs to differentiate between courses query and poll_log query (check the SQL string)
- `pollCourse` mock might need adjustment for the new call patterns

**Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/lib/cron-handler.ts
git commit -m "feat: implement two-tier polling with auto-activate/deactivate"
```

---

### Task 8: Deploy Pipeline — Add Seed Step

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Context:** Add the seed script execution to the deploy workflow so D1 stays in sync with `courses.json` on every deploy. This goes after "Apply D1 migrations" and before "Deploy Worker". Uses the idempotent upsert seed script from Task 3.

**Step 1: Add the seed step**

In `.github/workflows/deploy.yml`, add this step between "Apply D1 migrations" and "Deploy Worker":

```yaml
      - name: Seed course catalog
        run: npx tsx scripts/seed.ts && npx wrangler d1 execute tee-times-db --remote --file=scripts/seed.sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

The full deploy steps should now be (in order):
1. Checkout, setup node, npm ci
2. npm test
3. Cache, build
4. Apply D1 migrations
5. **Seed course catalog** ← NEW
6. Deploy Worker

**Step 2: Verify YAML indentation**

Read the file and confirm the new step has correct indentation: 6 spaces before `- name:`, matching the other steps. The `run:` and `env:` lines should also be indented to match the existing "Apply D1 migrations" step exactly.

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add seed step to deploy pipeline for D1 catalog sync"
```

---

### Task 9: Update `npm run seed:local` Command

**Files:**
- Modify: `package.json:15` (the `seed:local` script)

**Context:** The `seed:local` npm script should still work for local development. The command is already correct (`npx tsx scripts/seed.ts && npx wrangler d1 execute tee-times-db --local --file=scripts/seed.sql`), but verify it still works after the seed script rewrite.

**Step 1: Run the local seed command**

Run: `npm run seed:local`
Expected: No errors. Output includes `Wrote 24 courses to <path>/scripts/seed.sql`.

**Step 2: Verify courses are in local D1**

Run: `npx wrangler d1 execute tee-times-db --local --command="SELECT id, is_active, last_had_tee_times FROM courses LIMIT 5"`
Expected: Courses listed with `is_active = 1` and `last_had_tee_times = NULL` (for a fresh DB after migration 0003).

**Step 3: No commit needed** — this is just verification.

---

### Task 10: Final Verification

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 4: Verify no `is_active` in `courses.json`**

Run: `grep "is_active" src/config/courses.json`
Expected: No output (no matches).

**Step 5: Verify seed SQL has no `is_active`**

Run: `grep "is_active" scripts/seed.sql`
Expected: No output (no matches).

**Step 6: Review git log**

Run: `git log --oneline -10`
Expected: Clean sequence of commits from Tasks 1-8.
