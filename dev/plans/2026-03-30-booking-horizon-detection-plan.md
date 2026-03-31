# Booking Horizon Detection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-detect how far out each course publishes tee times, and poll accordingly (up to 14 days).

**Architecture:** New `booking_horizon_days` and `last_horizon_probe` columns on `courses`. The cron handler generates per-course date arrays based on each course's horizon. A weekly probe in batch 0 housekeeping scans beyond each course's current horizon and ratchets it up (never down) when tee times are found. Polling frequency tiers change: days 2-7 become 30-min, days 8+ become 60-min.

**Tech Stack:** D1 migration, TypeScript (poller.ts, cron-handler.ts, types), Vitest, React (About page)

**Design doc:** `docs/plans/2026-03-30-booking-horizon-detection-design.md`

---

## Preamble for ALL tasks

```
BEFORE starting work:
1. Read the skill at .claude/skills/test-driven-development/ (or invoke /test-driven-development)
2. Read dev/testing-pitfalls.md
Follow TDD: write failing test → implement fix → verify green.
```

```
BEFORE marking this task complete:
1. Review your tests against dev/testing-pitfalls.md
2. Verify test coverage of the fix (are error paths tested? edge cases?)
3. Run tests (or relevant subset) and confirm green
```

---

## Task 1: Migration + Type Update

**Files:**
- Create: `migrations/0009_add_booking_horizon.sql`
- Modify: `src/types/index.ts` (CourseRow interface, around line 30-42)
- Modify: `src/lib/cron-handler.test.ts` (makeCourseRow helper)
- Modify: `src/lib/poller.test.ts` (mockCourse object)
- Modify: `src/lib/batch.test.ts` (makeCourse helper)
- Modify: `src/lib/poller.integration.test.ts` (makeCourseRow helper)

**Step 1: Write the migration file**

Create `migrations/0009_add_booking_horizon.sql`:

```sql
-- Per-course booking horizon: how many days out this course publishes tee times.
-- Ratchet-up only: auto-detection increases this value but never decreases it.
ALTER TABLE courses ADD COLUMN booking_horizon_days INTEGER NOT NULL DEFAULT 7;

-- Timestamp of last horizon probe for this course. NULL = never probed.
ALTER TABLE courses ADD COLUMN last_horizon_probe TEXT;
```

**Step 2: Add fields to CourseRow**

In `src/types/index.ts`, add two fields to the `CourseRow` interface:

```typescript
booking_horizon_days: number;
last_horizon_probe: string | null;
```

Add them after the `last_had_tee_times` field (line 42). Match the existing style exactly — no trailing comments explaining the fields.

**Step 3: Update the test helper `makeCourseRow` in cron-handler.test.ts**

In `src/lib/cron-handler.test.ts`, the `makeCourseRow` helper (lines 12-35) constructs `CourseRow` objects for tests. Add the new fields with sensible defaults:

```typescript
booking_horizon_days: overrides.booking_horizon_days ?? 7,
last_horizon_probe: overrides.last_horizon_probe ?? null,
```

Add `booking_horizon_days` and `last_horizon_probe` to the `overrides` parameter type.

**Step 4: Update the test helper `mockCourse` in poller.test.ts**

In `src/lib/poller.test.ts`, the `mockCourse` object (lines 72-83) is a `CourseRow` literal. Add:

```typescript
booking_horizon_days: 7,
last_horizon_probe: null,
```

**Step 5: Update the test helper `makeCourse` in batch.test.ts**

In `src/lib/batch.test.ts`, the `makeCourse` helper (lines 7-21) constructs `CourseRow` objects. Add:

```typescript
booking_horizon_days: 7,
last_horizon_probe: null,
```

After the `last_had_tee_times` field.

**Step 6: Update the test helper `makeCourseRow` in poller.integration.test.ts**

In `src/lib/poller.integration.test.ts`, the `makeCourseRow` helper (lines 19-34) uses `Partial<CourseRow>` spread. Add defaults to the base object:

```typescript
booking_horizon_days: 7,
last_horizon_probe: null,
```

After the `last_had_tee_times` field, before the `...overrides` spread.

**Step 7: Run tests to verify nothing is broken**

Run: `npm test`
Expected: All existing tests pass. The new columns have defaults so nothing should break.

**Step 8: Commit**

```bash
git add migrations/0009_add_booking_horizon.sql src/types/index.ts src/lib/cron-handler.test.ts src/lib/poller.test.ts src/lib/batch.test.ts src/lib/poller.integration.test.ts
git commit -m "feat: add booking_horizon_days and last_horizon_probe to courses schema"
```

---

## Task 2: Update `shouldPollDate` Frequency Tiers

**Files:**
- Modify: `src/lib/poller.ts` (lines 13-27)
- Modify: `src/lib/poller.test.ts` (lines 20-39)

**Context:** Current tiers are: days 0-1 always, days 2-3 every 30 min, days 4-6 every 60 min. New tiers: days 0-1 always, days 2-7 every 30 min, days 8+ every 60 min. The overnight fallback to hourly is handled by `shouldRunThisCycle()` in `cron-handler.ts` — it gates whether the entire invocation runs (only once per hour overnight). `shouldPollDate` does NOT need to know about overnight; it only sets per-date minimum intervals.

**Step 1: Write failing tests for updated tiers**

Replace the existing `shouldPollDate` test block in `src/lib/poller.test.ts` (lines 20-39) with:

```typescript
describe("shouldPollDate", () => {
  it("always polls today and tomorrow", () => {
    expect(shouldPollDate(0, 0)).toBe(true);
    expect(shouldPollDate(1, 0)).toBe(true);
  });

  it("polls days 2-7 every 30 min", () => {
    // Under 30 min → skip
    expect(shouldPollDate(2, 20)).toBe(false);
    expect(shouldPollDate(5, 29)).toBe(false);
    expect(shouldPollDate(7, 15)).toBe(false);
    // At or over 30 min → poll
    expect(shouldPollDate(2, 30)).toBe(true);
    expect(shouldPollDate(3, 31)).toBe(true);
    expect(shouldPollDate(5, 45)).toBe(true);
    expect(shouldPollDate(7, 30)).toBe(true);
  });

  it("polls days 8+ hourly", () => {
    // Under 60 min → skip
    expect(shouldPollDate(8, 30)).toBe(false);
    expect(shouldPollDate(10, 59)).toBe(false);
    expect(shouldPollDate(13, 45)).toBe(false);
    // At or over 60 min → poll
    expect(shouldPollDate(8, 60)).toBe(true);
    expect(shouldPollDate(10, 61)).toBe(true);
    expect(shouldPollDate(13, 120)).toBe(true);
  });
});
```

**Step 2: Run tests to verify the new tests fail**

Run: `npm test -- src/lib/poller.test.ts`
Expected: FAIL — days 5 and 7 currently require 60 min, not 30 min. Days 8+ don't exist yet but will pass because the current fallback is `>= 60`.

**Step 3: Update `shouldPollDate` implementation**

Replace the function body in `src/lib/poller.ts` (lines 13-27):

```typescript
export function shouldPollDate(
  dayOffset: number,
  minutesSinceLastPoll: number
): boolean {
  if (dayOffset <= 1) {
    // Today + tomorrow: always poll (frequency controlled by time-of-day cron)
    return true;
  }
  if (dayOffset <= 7) {
    // Days 2-7: every 30 minutes
    return minutesSinceLastPoll >= 30;
  }
  // Days 8+: hourly
  return minutesSinceLastPoll >= 60;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/poller.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/poller.ts src/lib/poller.test.ts
git commit -m "feat: update polling frequency tiers — 30 min for days 2-7, hourly for 8+"
```

---

## Task 3: Make `getPollingDates` Accept a Horizon Parameter

**Files:**
- Modify: `src/lib/poller.ts` (lines 32-40)
- Modify: `src/lib/poller.test.ts` (lines 41-56)

**Context:** `getPollingDates` currently always returns 7 dates. It needs to accept a `horizonDays` parameter so the cron handler can generate per-course date arrays. The default should be 7 for backward compatibility with any callers that don't pass it. Add a constant `MAX_HORIZON = 14` — this is the ceiling for horizon probing.

**Step 1: Write failing tests for parameterized horizon**

Replace the `getPollingDates` test block in `src/lib/poller.test.ts` with:

```typescript
describe("getPollingDates", () => {
  it("returns 7 dates by default", () => {
    const dates = getPollingDates("2026-04-15");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-04-15");
    expect(dates[6]).toBe("2026-04-21");
  });

  it("returns specified number of dates when horizonDays is given", () => {
    const dates = getPollingDates("2026-04-15", 14);
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe("2026-04-15");
    expect(dates[13]).toBe("2026-04-28");
  });

  it("handles month boundary rollover with extended horizon", () => {
    const dates = getPollingDates("2026-03-25", 14);
    expect(dates[0]).toBe("2026-03-25");
    expect(dates[6]).toBe("2026-03-31");
    expect(dates[7]).toBe("2026-04-01");
    expect(dates[13]).toBe("2026-04-07");
  });

  it("handles month boundary rollover with default horizon", () => {
    const dates = getPollingDates("2026-03-28");
    expect(dates).toEqual([
      "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31",
      "2026-04-01", "2026-04-02", "2026-04-03",
    ]);
  });
});
```

Also add an import test for `MAX_HORIZON`:

```typescript
import { pollCourse, shouldPollDate, getPollingDates, MAX_HORIZON } from "./poller";

describe("MAX_HORIZON", () => {
  it("is 14", () => {
    expect(MAX_HORIZON).toBe(14);
  });
});
```

Update the import line at the top of the file to include `MAX_HORIZON`.

**Step 2: Run tests to verify the new tests fail**

Run: `npm test -- src/lib/poller.test.ts`
Expected: FAIL — `MAX_HORIZON` doesn't exist, and `getPollingDates("2026-04-15", 14)` ignores the second parameter.

**Step 3: Update `getPollingDates` and add `MAX_HORIZON`**

In `src/lib/poller.ts`, add the constant before the functions:

```typescript
export const MAX_HORIZON = 14;
```

Update `getPollingDates` signature and body:

```typescript
export function getPollingDates(todayStr: string, horizonDays: number = 7): string[] {
  const dates: string[] = [];
  const [year, month, day] = todayStr.split("-").map(Number);
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(Date.UTC(year, month - 1, day + i));
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/poller.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: PASS — the default parameter means all existing callers still work.

**Step 6: Commit**

```bash
git add src/lib/poller.ts src/lib/poller.test.ts
git commit -m "feat: parameterize getPollingDates with horizonDays, add MAX_HORIZON constant"
```

---

### Review checkpoint after Tasks 1-3

```
After every logical group of tasks:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.
```

Review against `dev/testing-pitfalls.md` specifically:
- Section 2 (Timezone): `getPollingDates` uses `Date.UTC` — no timezone ambiguity. Good.
- Section 5 (Cron): `shouldPollDate` boundary values are tested at exactly 30 and 60. Good.

---

## Task 4: Per-Course Date Range in Cron Handler

**Files:**
- Modify: `src/lib/cron-handler.ts` (lines 82-115)
- Modify: `src/lib/cron-handler.test.ts`

**Context:** Currently `cron-handler.ts` calls `getPollingDates(todayStr)` once (line 85) and uses the same 7-date array for all courses. After this change, it should generate a MAX_HORIZON-length array once, then skip dates beyond each course's `booking_horizon_days` in the inner loop.

**Important:** The `getPollingDates` mock in `cron-handler.test.ts` (line 76-77) returns a fixed array. After this change, the mock needs to return a `MAX_HORIZON`-length array (14 dates) since the handler will call `getPollingDates(todayStr, MAX_HORIZON)`.

**Important:** The date-outer loop iterates `dates[i]` and passes `i` to `shouldPollDate(i, ...)`. After this change, dates beyond a course's horizon must be skipped. Add `if (i >= course.booking_horizon_days) continue;` at the start of the inner course loop. Do NOT add this check in the date-outer loop — it must be per-course because different courses have different horizons.

**Step 1: Write a failing test for per-course horizon filtering**

Add a new describe block in `src/lib/cron-handler.test.ts`:

```typescript
describe("runCronPoll per-course horizon", () => {
  // Uses same makeMockDb pattern as other test blocks in this file
  const makeMockDb = (courses: ReturnType<typeof makeCourseRow>[]) => ({
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      all: vi.fn().mockResolvedValue({
        results: sql.includes("FROM courses") ? courses : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 250 });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    // Return 14 dates to match MAX_HORIZON
    mockedGetPollingDates.mockReturnValue(
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 3, 15 + i));
        return d.toISOString().split("T")[0];
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("only polls dates up to each course's booking_horizon_days", async () => {
    // One course with horizon=7, one with horizon=14 — both in same batch
    // Use a single course per test to avoid batch assignment complexity
    const course7 = makeCourseRow("horizon-7", "foreup", { booking_horizon_days: 7 });
    const db = makeMockDb([course7]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    const dates7 = mockedPollCourse.mock.calls
      .filter((c) => c[1].id === "horizon-7")
      .map((c) => c[2]);
    expect(dates7).toHaveLength(7);
    expect(dates7[dates7.length - 1]).toBe("2026-04-21");
  });

  it("polls up to 14 days for courses with extended horizon", async () => {
    const course14 = makeCourseRow("horizon-14", "foreup", { booking_horizon_days: 14 });
    const db = makeMockDb([course14]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    const dates14 = mockedPollCourse.mock.calls
      .filter((c) => c[1].id === "horizon-14")
      .map((c) => c[2]);
    expect(dates14).toHaveLength(14);
    expect(dates14[dates14.length - 1]).toBe("2026-04-28");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/cron-handler.test.ts`
Expected: FAIL — `booking_horizon_days` is not used in the loop yet, and `getPollingDates` is still called without `MAX_HORIZON`.

**Step 3: Update cron handler to use per-course horizons**

In `src/lib/cron-handler.ts`:

1. Add `MAX_HORIZON` to the import from `@/lib/poller` (line 3):
   ```typescript
   import { pollCourse, shouldPollDate, getPollingDates, MAX_HORIZON } from "@/lib/poller";
   ```

2. Change line 85 from:
   ```typescript
   const dates = getPollingDates(todayStr);
   ```
   to:
   ```typescript
   const dates = getPollingDates(todayStr, MAX_HORIZON);
   ```

3. Inside the active courses date-outer/course-inner loop (line 109, inside the `for (const course of activeCourses)` block), add as the first line:
   ```typescript
   if (i >= course.booking_horizon_days) continue;
   ```

   This goes before the `pollTimeMap` lookup. The full inner loop start should look like:
   ```typescript
   for (const course of activeCourses) {
     if (i >= course.booking_horizon_days) continue;
     const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
     // ... rest unchanged
   ```

**Step 4: Update existing test mocks**

Several existing test blocks in `cron-handler.test.ts` mock `getPollingDates` to return short arrays (e.g., `["2026-04-15"]` or `["2026-04-15", "2026-04-16"]`). These still work because the horizon check `i >= course.booking_horizon_days` (default 7) won't filter out any dates from a 2-element array. No changes needed to existing mocks.

However, verify that the `getPollingDates` mock in the top-level mock setup (line 76) still returns at least the dates that existing tests expect. It currently returns `["2026-04-15"]` which is fine — tests that need more dates override it in their `beforeEach`.

**Step 5: Run tests**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "feat: use per-course booking_horizon_days for polling date range"
```

---

## Task 5: Horizon Probe in Cron Handler

**Files:**
- Modify: `src/lib/cron-handler.ts` (add probe function, call from housekeeping)
- Modify: `src/lib/cron-handler.test.ts` (add probe tests)

**Context:** The horizon probe runs during batch 0 housekeeping, after existing cleanup tasks. It checks active courses where `last_horizon_probe IS NULL` or older than 7 days. For each eligible course, it scans dates from `booking_horizon_days + 1` through `MAX_HORIZON` (14). If tee times are found, it ratchets `booking_horizon_days` up (never down). It always updates `last_horizon_probe`.

**Constants:** Add `PROBE_INTERVAL_DAYS = 7` to `src/lib/poller.ts` next to `MAX_HORIZON`, and export it.

**CRITICAL RATCHET RULE:** The probe MUST NEVER decrease `booking_horizon_days`. Even if the probe finds no tee times on day 12 this week, a course that was previously detected at 12 stays at 12. The UPDATE query should use `MAX(booking_horizon_days, ?)` or a conditional: only update if the new value is greater.

**TESTING PITFALL WARNING (from dev/testing-pitfalls.md section 5):**
- Error isolation between iterations: a failure probing one course must not kill the loop for remaining courses. Wrap each course's probe in its own try/catch.
- Error isolation within nested loops: a failure probing one date must not skip remaining dates for that course. Wrap each date poll in its own try/catch.
- Budget tracking: probe polls consume subrequests and must decrement the budget.

**Step 1: Add `PROBE_INTERVAL_DAYS` constant to poller.ts**

In `src/lib/poller.ts`, next to `MAX_HORIZON`:

```typescript
export const PROBE_INTERVAL_DAYS = 7;
```

**Step 2: Write the probe function**

Add a new exported function to `src/lib/cron-handler.ts`:

```typescript
export async function runHorizonProbe(
  db: D1Database,
  courses: CourseRow[],
  todayStr: string,
  budget: { remaining: number },
  env?: CloudflareEnv
): Promise<{ probeCount: number; updatedCourses: string[] }> {
  const now = new Date().toISOString();
  let probeCount = 0;
  const updatedCourses: string[] = [];

  for (const course of courses) {
    if (budget.remaining <= 0) break;

    try {
      let maxFound = course.booking_horizon_days;

      for (let dayOffset = course.booking_horizon_days; dayOffset < MAX_HORIZON; dayOffset++) {
        const weight = platformWeight(course.platform);
        if (budget.remaining < weight) break;

        const [year, month, day] = todayStr.split("-").map(Number);
        const d = new Date(Date.UTC(year, month - 1, day + dayOffset));
        const dateStr = d.toISOString().split("T")[0];

        try {
          const status = await pollCourse(db, course, dateStr, env);
          probeCount++;
          budget.remaining -= weight;

          if (status === "success" && dayOffset + 1 > maxFound) {
            maxFound = dayOffset + 1;
          }
        } catch (err) {
          console.error(`Horizon probe error for ${course.id} on ${dateStr}:`, err);
          probeCount++;
          budget.remaining -= weight;
        }

        await sleep(250);
      }

      // Ratchet up only
      if (maxFound > course.booking_horizon_days) {
        await db
          .prepare("UPDATE courses SET booking_horizon_days = ? WHERE id = ? AND booking_horizon_days < ?")
          .bind(maxFound, course.id, maxFound)
          .run();
        updatedCourses.push(course.id);
        console.log(`Horizon probe: ${course.id} extended to ${maxFound} days`);
      }

      // Always update probe timestamp
      await db
        .prepare("UPDATE courses SET last_horizon_probe = ? WHERE id = ?")
        .bind(now, course.id)
        .run();
    } catch (err) {
      console.error(`Horizon probe failed for ${course.id}:`, err);
    }
  }

  return { probeCount, updatedCourses };
}
```

**Important implementation notes:**
- `dayOffset` starts at `course.booking_horizon_days` (e.g., 7), so day 7 is the first date checked (0-indexed, so it's the 8th day out). `dayOffset + 1` is the horizon value to store because `booking_horizon_days` means "this many days total."
- The `WHERE booking_horizon_days < ?` in the UPDATE is a safety net for the ratchet rule — even if the function logic has a bug, the SQL won't lower the value.
- The `budget` parameter is an object (not a number) so changes propagate to the caller. The caller passes in `{ remaining: budget }` where `budget` is whatever's left after normal polling.
- `sleep` is already defined in cron-handler.ts (line 36). It's file-scoped, so `runHorizonProbe` can use it if the function is in the same file.

**Step 3: Add the import for `PROBE_INTERVAL_DAYS`**

Update the import line in `src/lib/cron-handler.ts`:

```typescript
import { pollCourse, shouldPollDate, getPollingDates, MAX_HORIZON, PROBE_INTERVAL_DAYS } from "@/lib/poller";
```

**Step 4: Call the probe from batch 0 housekeeping**

In `src/lib/cron-handler.ts`, after the existing housekeeping block (after the session cleanup try/catch, around line 235), add:

```typescript
// --- Horizon probe: weekly check for courses publishing beyond their known horizon ---
try {
  const eligibleForProbe = await db
    .prepare(
      `SELECT * FROM courses
       WHERE disabled = 0 AND is_active = 1
         AND (last_horizon_probe IS NULL OR last_horizon_probe < ${sqliteIsoNow(`-${PROBE_INTERVAL_DAYS} days`)})`
    )
    .all<CourseRow>();

  if (eligibleForProbe.results.length > 0) {
    const probeResult = await runHorizonProbe(
      db,
      eligibleForProbe.results,
      todayStr,
      { remaining: budget },
      env
    );
    pollCount += probeResult.probeCount;
    budget -= (budget - probeResult.probeCount); // sync budget with what probe consumed

    if (probeResult.updatedCourses.length > 0) {
      console.log(`Horizon probe: updated ${probeResult.updatedCourses.length} course(s)`);
    }
  }
} catch (err) {
  console.error("Horizon probe error:", err);
}
```

**Wait — the budget syncing is wrong.** The probe function mutates `budget.remaining` directly. The caller should read it back. Let me reconsider.

Actually, the `budget` variable in `runCronPoll` is a plain `number` (line 104: `let budget = SUBREQUEST_BUDGET;`). The probe function takes `{ remaining: number }`. After the probe returns, set `budget = probeResult.budgetRemaining` or similar. Cleaner approach:

Change the probe call to:
```typescript
const budgetObj = { remaining: budget };
const probeResult = await runHorizonProbe(
  db,
  eligibleForProbe.results,
  todayStr,
  budgetObj,
  env
);
pollCount += probeResult.probeCount;
budget = budgetObj.remaining;
```

But actually, the probe runs AFTER normal polling (in housekeeping), and the budget variable is not used after housekeeping. So budget syncing doesn't matter functionally — the probe just needs to track its own internal budget to avoid exceeding the subrequest limit. Pass `{ remaining: budget }` and let the probe manage it. Don't bother syncing back.

**Revised call site:**
```typescript
try {
  const eligibleForProbe = await db
    .prepare(
      `SELECT * FROM courses
       WHERE disabled = 0 AND is_active = 1
         AND (last_horizon_probe IS NULL OR last_horizon_probe < ${sqliteIsoNow(`-${PROBE_INTERVAL_DAYS} days`)})`
    )
    .all<CourseRow>();

  if (eligibleForProbe.results.length > 0) {
    const probeResult = await runHorizonProbe(
      db,
      eligibleForProbe.results,
      todayStr,
      { remaining: budget },
      env
    );

    if (probeResult.updatedCourses.length > 0) {
      console.log(`Horizon probe: updated ${probeResult.updatedCourses.length} course(s)`);
    }
  }
} catch (err) {
  console.error("Horizon probe error:", err);
}
```

**Step 5: Write tests for the horizon probe**

Add a new describe block in `src/lib/cron-handler.test.ts`:

```typescript
describe("runHorizonProbe", () => {
  // Import the function
  // Add to the import at top of file: import { runHorizonProbe } from "./cron-handler";

  const makeMockDb = () => ({
    prepare: vi.fn().mockImplementation(() => ({
      bind: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      })),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 250 });
    vi.setSystemTime(new Date("2026-04-15T02:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extends horizon when tee times found beyond current horizon", async () => {
    const course = makeCourseRow("probe-test", "foreup", { booking_horizon_days: 7 });

    // Return success for day offset 10 (the 11th day out)
    mockedPollCourse.mockImplementation(async (_db, _course, date) => {
      if (date === "2026-04-25") return "success"; // day offset 10
      return "no_data";
    });

    const db = makeMockDb();
    const result = await runHorizonProbe(
      db as any,
      [course],
      "2026-04-15",
      { remaining: 500 }
    );

    expect(result.updatedCourses).toContain("probe-test");

    // Should have updated booking_horizon_days to 11 (dayOffset 10 + 1)
    const updateCalls = db.prepare.mock.calls.filter(
      (args) => (args[0] as string).includes("booking_horizon_days")
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("does not lower horizon when no tee times found", async () => {
    const course = makeCourseRow("no-lower", "foreup", { booking_horizon_days: 10 });
    mockedPollCourse.mockResolvedValue("no_data");

    const db = makeMockDb();
    const result = await runHorizonProbe(
      db as any,
      [course],
      "2026-04-15",
      { remaining: 500 }
    );

    expect(result.updatedCourses).toHaveLength(0);

    // booking_horizon_days UPDATE should NOT have been called
    const updateCalls = db.prepare.mock.calls.filter(
      (args) => (args[0] as string).includes("booking_horizon_days")
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("always updates last_horizon_probe timestamp", async () => {
    const course = makeCourseRow("probe-ts", "foreup", { booking_horizon_days: 7 });
    mockedPollCourse.mockResolvedValue("no_data");

    const db = makeMockDb();
    await runHorizonProbe(db as any, [course], "2026-04-15", { remaining: 500 });

    const probeCalls = db.prepare.mock.calls.filter(
      (args) => (args[0] as string).includes("last_horizon_probe")
    );
    expect(probeCalls.length).toBeGreaterThan(0);
  });

  it("respects subrequest budget", async () => {
    const course = makeCourseRow("budget-test", "cps_golf", { booking_horizon_days: 7 });
    mockedPollCourse.mockResolvedValue("no_data");

    // CPS weight = 3, 7 dates to check (days 7-13), so needs 21 subrequests
    // Give only 9 → should stop after 3 dates
    const budget = { remaining: 9 };
    const db = makeMockDb();
    await runHorizonProbe(db as any, [course], "2026-04-15", budget);

    expect(mockedPollCourse).toHaveBeenCalledTimes(3);
    expect(budget.remaining).toBe(0);
  });

  it("continues probing other courses after one throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const course1 = makeCourseRow("fail-probe", "foreup", { booking_horizon_days: 7 });
    const course2 = makeCourseRow("ok-probe", "foreup", { booking_horizon_days: 7 });

    mockedPollCourse.mockImplementation(async (_db, course) => {
      if (course.id === "fail-probe") throw new Error("boom");
      return "no_data";
    });

    const db = makeMockDb();
    const result = await runHorizonProbe(
      db as any,
      [course1, course2],
      "2026-04-15",
      { remaining: 500 }
    );

    // Second course should still have been probed
    const probedIds = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(probedIds).toContain("ok-probe");

    consoleSpy.mockRestore();
  });

  it("skips courses already at MAX_HORIZON", async () => {
    const course = makeCourseRow("at-max", "foreup", { booking_horizon_days: 14 });
    mockedPollCourse.mockResolvedValue("no_data");

    const db = makeMockDb();
    await runHorizonProbe(db as any, [course], "2026-04-15", { remaining: 500 });

    // No dates to check: horizon (14) >= MAX_HORIZON (14)
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });
});
```

**Step 6: Write a test for the probe running in batch 0 housekeeping**

Add to the existing "runCronPoll housekeeping" describe block. This test verifies the probe query is issued in batch 0 — the `runHorizonProbe` function itself is tested separately above.

```typescript
it("issues horizon probe query in batch 0", async () => {
  const db = makeMockDb();
  await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

  // Verify that the probe eligibility query was prepared
  const probeQuery = preparedStatements.find((sql) =>
    sql.includes("last_horizon_probe")
  );
  expect(probeQuery).toBeDefined();
});

it("does not issue horizon probe query in non-zero batches", async () => {
  const db = makeMockDb();
  await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_1_CRON);

  const probeQuery = preparedStatements.find((sql) =>
    sql.includes("last_horizon_probe")
  );
  expect(probeQuery).toBeUndefined();
});
```

**Note:** The `preparedStatements` array is already tracked in the housekeeping test block's mock DB — use the same pattern. Keep the test simple: verify the query is issued, not the full probe flow (that's covered by `runHorizonProbe` tests).

**Step 7: Run tests**

Run: `npm test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/lib/poller.ts src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "feat: add weekly horizon probe to detect extended booking availability"
```

---

### Review checkpoint after Tasks 4-5

```
After every logical group of tasks:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.
```

Review against `dev/testing-pitfalls.md`:
- Section 5 (Error isolation between iterations): probe wraps each course in try/catch — tested.
- Section 5 (Error isolation within nested loops): probe wraps each date poll in try/catch — tested.
- Section 8 (Parameterized queries): the `sqliteIsoNow` helper generates SQL expressions. Verify the `PROBE_INTERVAL_DAYS` interpolation doesn't create injection risk — it's a constant integer, not user input. Safe.
- Section 4 (Unbounded growth): probe writes to `poll_log` via `pollCourse`. These entries are cleaned up by the existing 7-day cleanup. No new growth concern.

---

## Task 6: Update About Page

**Files:**
- Modify: `src/app/about/page.tsx` (lines 46-59)
- Modify: `src/app/about/page.test.tsx` (if it tests the frequency table)

**Context:** The About page frequency table needs to reflect the new tiers and mention the extended horizon.

**Step 1: Check existing About page tests**

Read `src/app/about/page.test.tsx` to see what's tested. If the test checks specific table content strings, update them to match the new tiers.

**Step 2: Update the frequency table**

Replace the `<tbody>` content in `src/app/about/page.tsx` (lines 46-59):

```tsx
<tbody className="text-gray-700">
  <tr className="border-b border-gray-200">
    <td className="py-2 pr-4">Today &amp; tomorrow</td>
    <td className="py-2">
      Every 5–15 min (5am–8pm CT), hourly overnight
    </td>
  </tr>
  <tr className="border-b border-gray-200">
    <td className="py-2 pr-4">2–7 days out</td>
    <td className="py-2">Every 30 min, hourly overnight</td>
  </tr>
  <tr>
    <td className="py-2 pr-4">8–14 days out</td>
    <td className="py-2">
      Every hour (for courses that publish this far out)
    </td>
  </tr>
</tbody>
```

**Do NOT** add any extra explanatory paragraph about horizon detection or auto-detection. The parenthetical note is sufficient — users don't need to know about the probe mechanism.

**Step 3: Update tests if needed**

If `page.test.tsx` asserts specific strings like "2–3 days out" or "4–7 days out", update them to match.

**Step 4: Run tests**

Run: `npm test -- src/app/about`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/about/page.tsx src/app/about/page.test.tsx
git commit -m "docs: update About page polling frequency table for extended horizon"
```

---

## Task 7: Type-Check and Lint

**Files:** None (verification only)

**Step 1: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors. If there are errors, they are likely from `CourseRow` changes — fix any code that constructs `CourseRow` objects without the new fields. Known construction sites beyond those fixed in Task 1:
- `src/app/api/courses/[id]/refresh/route.ts` — reads `CourseRow` from D1 via `SELECT *`, which includes the new columns automatically. No change needed.
- Any other `SELECT * FROM courses` queries — D1 returns all columns, so the type matches as long as the migration has run.

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit any fixes if needed**

If type-check or lint revealed issues, fix and commit:
```bash
git commit -m "fix: resolve type-check/lint issues from horizon detection changes"
```

---

### Final review checkpoint

```
After every logical group of tasks:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.
```

Final review focuses:
- Read through all modified files end-to-end. Does the code read clearly?
- Are ABOUTME comments still accurate? Update if file purpose changed.
- Are there any `CourseRow` construction sites we missed (e.g., seed scripts, API routes)?
- Does the migration apply cleanly to an existing database with data? (D1 `ALTER TABLE ADD COLUMN` with `NOT NULL DEFAULT` works on existing rows.)
