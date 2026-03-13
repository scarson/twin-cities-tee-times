# Data Freshness & Polling Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend polling to 30 days, add auto-fetch on course detail view, fix misleading freshness display, and clarify the refresh button.

**Architecture:** Backend changes to `poller.ts` (tier logic + date count), `tee-times/route.ts` (auto-fetch side effect), and `rate-limit.ts` (per-date dedup). Frontend changes to `course-header.tsx` (remove timestamp, relabel button, add toast), `tee-time-list.tsx` (empty-state messaging), and `date-picker.tsx` (60-day cap).

**Tech Stack:** TypeScript, Vitest, Next.js App Router, Cloudflare D1 (SQLite), React

**Design doc:** `docs/plans/2026-03-13-data-freshness-design.md`

**Testing pitfalls:** Review `dev/testing-pitfalls.md` before writing any test. Key concerns for this feature: silent failure (#1), timezone handling (#2), error isolation in cron/background (#5), rate limit bypass (#9).

**Task dependencies:** Tasks 1-4 are independent (backend). Tasks 5-6 depend on Task 4. Tasks 7-8 are sequential (same files). Task 9 is independent. Task 10 depends on all others.

---

### Task 1: Extend `getPollingDates()` from 7 to 30 Days

**Files:**
- Modify: `src/lib/poller.ts:32-40`
- Test: `src/lib/poller.test.ts`

**Step 1: Update the existing test**

The test `"returns 7 dates starting from today"` at `poller.test.ts:44-48` needs to expect 30 dates.

```typescript
it("returns 30 dates starting from today", () => {
  const dates = getPollingDates("2026-04-15");
  expect(dates).toHaveLength(30);
  expect(dates[0]).toBe("2026-04-15");
  expect(dates[6]).toBe("2026-04-21");
  expect(dates[29]).toBe("2026-05-14");
});
```

The month boundary test at `poller.test.ts:51-57` should also be extended — just check length and last date:

```typescript
it("handles month boundary rollover", () => {
  const dates = getPollingDates("2026-03-28");
  expect(dates).toHaveLength(30);
  expect(dates[0]).toBe("2026-03-28");
  expect(dates[3]).toBe("2026-03-31");
  expect(dates[4]).toBe("2026-04-01");
  expect(dates[29]).toBe("2026-04-26");
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/poller.test.ts --reporter=verbose`
Expected: FAIL — `getPollingDates` returns 7 items, tests expect 30.

**Step 3: Update `getPollingDates` implementation**

In `src/lib/poller.ts:32-40`, change the loop limit from 7 to 30 and update the JSDoc:

```typescript
/**
 * Generate an array of 30 date strings starting from the given date.
 */
export function getPollingDates(todayStr: string): string[] {
  const dates: string[] = [];
  const [year, month, day] = todayStr.split("-").map(Number);
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(year, month - 1, day + i));
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/poller.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/poller.ts src/lib/poller.test.ts
git commit -m "feat: extend polling window from 7 to 30 days"
```

---

### Task 2: Update `shouldPollDate()` Tier Logic

**Files:**
- Modify: `src/lib/poller.ts:13-27`
- Test: `src/lib/poller.test.ts:20-41`

**Step 1: Update existing tests for new tiers**

Replace the entire `shouldPollDate` describe block with tests matching the new 4-tier design. The tiers are defined in the design doc (`docs/plans/2026-03-13-data-freshness-design.md`):

| Day offset | Threshold |
|-----------|-----------|
| 0–2 | Always (cron controls frequency) |
| 3–7 | 15 minutes |
| 8–14 | 120 minutes (2 hours) |
| 15–29 | 720 minutes (12 hours) |

```typescript
describe("shouldPollDate", () => {
  it("always polls days 0-2 (today, tomorrow, day after)", () => {
    expect(shouldPollDate(0, 0)).toBe(true);
    expect(shouldPollDate(1, 0)).toBe(true);
    expect(shouldPollDate(2, 0)).toBe(true);
  });

  it("polls days 3-7 every 15 min", () => {
    expect(shouldPollDate(3, 10)).toBe(false);
    expect(shouldPollDate(3, 15)).toBe(true);
    expect(shouldPollDate(7, 14)).toBe(false);
    expect(shouldPollDate(7, 16)).toBe(true);
  });

  it("polls days 8-14 every 2 hours", () => {
    expect(shouldPollDate(8, 60)).toBe(false);
    expect(shouldPollDate(8, 120)).toBe(true);
    expect(shouldPollDate(14, 119)).toBe(false);
    expect(shouldPollDate(14, 121)).toBe(true);
  });

  it("polls days 15-29 every 12 hours", () => {
    expect(shouldPollDate(15, 600)).toBe(false);
    expect(shouldPollDate(15, 720)).toBe(true);
    expect(shouldPollDate(29, 719)).toBe(false);
    expect(shouldPollDate(29, 721)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/poller.test.ts --reporter=verbose`
Expected: FAIL — old tier logic doesn't match new expectations.

**Step 3: Update `shouldPollDate` implementation**

```typescript
/**
 * Determine whether a given date offset should be polled this cycle.
 * @param dayOffset 0 = today, 1 = tomorrow, etc.
 * @param minutesSinceLastPoll minutes since this course+date was last polled
 */
export function shouldPollDate(
  dayOffset: number,
  minutesSinceLastPoll: number
): boolean {
  if (dayOffset <= 2) {
    // Today + tomorrow + day after: always poll (frequency controlled by cron)
    return true;
  }
  if (dayOffset <= 7) {
    // Days 3-7: every 15 minutes
    return minutesSinceLastPoll >= 15;
  }
  if (dayOffset <= 14) {
    // Days 8-14: every 2 hours
    return minutesSinceLastPoll >= 120;
  }
  // Days 15-29: twice daily (~12 hours)
  return minutesSinceLastPoll >= 720;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/poller.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/poller.ts src/lib/poller.test.ts
git commit -m "feat: update polling tiers — 4 tiers across 30 days"
```

---

### Task 3: Update Cron Handler Comment and poll_log Lookback

**Files:**
- Modify: `src/lib/cron-handler.ts:44,80,93`

The cron handler comment says "full 7-date polling" — update to "full 30-date polling." The `poll_log` batch query uses `-24 hours` lookback which is sufficient (tier 4 is 12-hour intervals, all within 24 hours).

**Step 1: Update comments in cron-handler.ts**

Change line 44-45 JSDoc from:
```
 * Two-tier polling:
 * - Active courses: full 7-date polling at dynamic frequency
```
to:
```
 * Two-tier polling:
 * - Active courses: full 30-date polling at dynamic frequency
```

Change line 93 inline comment from:
```
    // --- Active courses: full 7-date polling at dynamic frequency ---
```
to:
```
    // --- Active courses: full 30-date polling at dynamic frequency ---
```

**Step 2: Run all tests to verify nothing broke**

Run: `npm test -- src/lib/cron-handler.test.ts --reporter=verbose`
Expected: PASS (comment-only changes)

**Step 3: Commit**

```bash
git add src/lib/cron-handler.ts
git commit -m "docs: update cron handler comments for 30-day polling"
```

---

### Task 4: Add Per-Date Freshness Check for Auto-Fetch

**Files:**
- Create: `src/lib/auto-fetch.ts`
- Test: `src/lib/auto-fetch.test.ts`

This module has two parts:
1. `shouldAutoFetch()` — pure function determining if a date needs fetching based on last poll time and tier thresholds
2. `autoFetchIfNeeded()` — orchestrator that queries D1 poll_log, calls `shouldAutoFetch`, and triggers `pollCourse` if needed

Both must be tested. `shouldAutoFetch` tests use real timestamps. `autoFetchIfNeeded` tests use mocked D1 and mocked `pollCourse` (same pattern as `src/lib/poller.test.ts:60-205`).

**Step 1: Write failing tests**

Create `src/lib/auto-fetch.test.ts`:

```typescript
// ABOUTME: Tests for auto-fetch logic that transparently polls when cached data is missing.
// ABOUTME: Covers freshness thresholds, poll_log dedup, global rate limiting, and day offset calculation.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldAutoFetch, autoFetchIfNeeded } from "./auto-fetch";

// --- shouldAutoFetch (pure function, real timestamps) ---

describe("shouldAutoFetch", () => {
  it("returns true when poll_log has no entry for course+date", () => {
    expect(shouldAutoFetch(null, 3)).toBe(true);
  });

  it("uses 5-minute threshold for days 0-2", () => {
    const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(shouldAutoFetch(threeMinAgo, 1)).toBe(false);
    const sixMinAgo = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(shouldAutoFetch(sixMinAgo, 1)).toBe(true);
  });

  it("uses 15-minute threshold for days 3-7", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(shouldAutoFetch(tenMinAgo, 5)).toBe(false);
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(shouldAutoFetch(twentyMinAgo, 5)).toBe(true);
  });

  it("uses 2-hour threshold for days 8-14", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(shouldAutoFetch(oneHourAgo, 10)).toBe(false);
    const threeHoursAgo = new Date(Date.now() - 180 * 60_000).toISOString();
    expect(shouldAutoFetch(threeHoursAgo, 10)).toBe(true);
  });

  it("uses 12-hour threshold for days 15+", () => {
    const sixHoursAgo = new Date(Date.now() - 360 * 60_000).toISOString();
    expect(shouldAutoFetch(sixHoursAgo, 20)).toBe(false);
    const thirteenHoursAgo = new Date(Date.now() - 780 * 60_000).toISOString();
    expect(shouldAutoFetch(thirteenHoursAgo, 20)).toBe(true);
  });

  it("uses 12-hour threshold for days beyond 30", () => {
    expect(shouldAutoFetch(null, 45)).toBe(true);
    const sixHoursAgo = new Date(Date.now() - 360 * 60_000).toISOString();
    expect(shouldAutoFetch(sixHoursAgo, 45)).toBe(false);
  });
});

// --- autoFetchIfNeeded (D1 + pollCourse mocked) ---

// Mock pollCourse — same pattern as poller.test.ts
vi.mock("@/lib/poller", () => ({
  pollCourse: vi.fn().mockResolvedValue("success"),
}));

vi.mock("@/lib/db", () => ({
  sqliteIsoNow: vi.fn((modifier?: string) =>
    modifier
      ? `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${modifier}')`
      : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
  ),
}));

import { pollCourse } from "@/lib/poller";

describe("autoFetchIfNeeded", () => {
  const mockFirst = vi.fn();
  const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
  const mockDb = {
    prepare: vi.fn().mockReturnValue({ first: mockFirst, bind: mockBind }),
  };

  const mockCourse = {
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ scheduleId: "7829" }),
    booking_url: "https://example.com",
    is_active: 1,
    city: "Edina",
    last_had_tee_times: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: global rate limit not hit, no previous poll
    mockFirst
      .mockResolvedValueOnce({ cnt: 0 })       // global rate limit check
      .mockResolvedValueOnce({ last_polled: null }); // poll_log check
    mockBind.mockReturnValue({ first: mockFirst });
  });

  it("triggers pollCourse when no poll_log entry exists", async () => {
    const result = await autoFetchIfNeeded(
      mockDb as any, mockCourse, "2026-04-20", "2026-04-15"
    );

    expect(result).toBe(true);
    expect(pollCourse).toHaveBeenCalledWith(mockDb, mockCourse, "2026-04-20");
  });

  it("skips when global rate limit exceeded", async () => {
    mockFirst.mockReset();
    mockFirst.mockResolvedValueOnce({ cnt: 25 }); // over limit
    mockBind.mockReturnValue({ first: mockFirst });

    const result = await autoFetchIfNeeded(
      mockDb as any, mockCourse, "2026-04-20", "2026-04-15"
    );

    expect(result).toBe(false);
    expect(pollCourse).not.toHaveBeenCalled();
  });

  it("skips when recent poll exists within tier threshold", async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    mockFirst.mockReset();
    mockFirst
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ last_polled: fiveMinAgo }); // day 5 → 15-min threshold
    mockBind.mockReturnValue({ first: mockFirst });

    // Date is 5 days out from today
    const result = await autoFetchIfNeeded(
      mockDb as any, mockCourse, "2026-04-20", "2026-04-15"
    );

    expect(result).toBe(false);
    expect(pollCourse).not.toHaveBeenCalled();
  });

  it("calculates day offset correctly from todayStr and date", async () => {
    // date is 2026-04-25, today is 2026-04-15 → offset 10 → tier 8-14 (120 min)
    const result = await autoFetchIfNeeded(
      mockDb as any, mockCourse, "2026-04-25", "2026-04-15"
    );

    expect(result).toBe(true);
    expect(pollCourse).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/auto-fetch.test.ts --reporter=verbose`
Expected: FAIL — module doesn't exist yet.

**Step 3: Write `auto-fetch.ts`**

Create `src/lib/auto-fetch.ts`:

```typescript
// ABOUTME: Auto-fetch logic for transparently polling when cached data is missing.
// ABOUTME: Used by the tee-times API route on the course detail page.
import { pollCourse } from "@/lib/poller";
import { sqliteIsoNow } from "@/lib/db";
import type { CourseRow } from "@/types";

/** Global rate limit for auto-fetch — matches GLOBAL_MAX_PER_MINUTE in rate-limit.ts. */
const GLOBAL_MAX_PER_MINUTE = 20;

/**
 * Freshness threshold in minutes per tier, matching shouldPollDate in poller.ts.
 */
function tierThresholdMinutes(dayOffset: number): number {
  if (dayOffset <= 2) return 5;
  if (dayOffset <= 7) return 15;
  if (dayOffset <= 14) return 120;
  return 720; // days 15+ (including >30)
}

/**
 * Determine whether auto-fetch should fire for a course+date.
 * @param lastPolledAt ISO timestamp of most recent poll_log entry, or null if never polled
 * @param dayOffset number of days from today (0 = today)
 */
export function shouldAutoFetch(
  lastPolledAt: string | null,
  dayOffset: number
): boolean {
  if (!lastPolledAt) return true;

  const minutesSincePoll =
    (Date.now() - new Date(lastPolledAt).getTime()) / 60_000;
  return minutesSincePoll >= tierThresholdMinutes(dayOffset);
}

/**
 * Check poll_log and auto-fetch if needed for a single course+date.
 * Returns true if a fetch was triggered, false if skipped.
 */
export async function autoFetchIfNeeded(
  db: D1Database,
  course: CourseRow,
  date: string,
  todayStr: string
): Promise<boolean> {
  // Calculate day offset
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const dateMs = new Date(date + "T00:00:00Z").getTime();
  const dayOffset = Math.round((dateMs - todayMs) / 86_400_000);

  // Check global rate limit
  const globalCount = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM poll_log
       WHERE polled_at > ${sqliteIsoNow("-60 seconds")}`
    )
    .first<{ cnt: number }>();

  if (globalCount && globalCount.cnt > GLOBAL_MAX_PER_MINUTE) return false;

  // Check poll_log for this specific course+date
  const lastPoll = await db
    .prepare(
      `SELECT MAX(polled_at) as last_polled FROM poll_log
       WHERE course_id = ? AND date = ?`
    )
    .bind(course.id, date)
    .first<{ last_polled: string | null }>();

  if (!shouldAutoFetch(lastPoll?.last_polled ?? null, dayOffset)) {
    return false;
  }

  await pollCourse(db, course, date);
  return true;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/auto-fetch.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Run full test suite to check for interference**

Run: `npm test`
Expected: All tests pass. The mocks in this file are scoped and should not affect other test files.

**Step 6: Commit**

```bash
git add src/lib/auto-fetch.ts src/lib/auto-fetch.test.ts
git commit -m "feat: add auto-fetch module with per-date freshness check"
```

---

### Task 5: Add Auto-Fetch to Tee-Times API Route

**Depends on:** Task 4 (auto-fetch module must exist)

**Files:**
- Modify: `src/app/api/tee-times/route.ts`

The tee-times route gains a new optional parameter `autoFetch=true` that the course detail page sends. When present with a single `courses` param and no cached results, auto-fetch fires for that course+date.

**CRITICAL: Error isolation (see `dev/testing-pitfalls.md` #1).** Auto-fetch failure must NOT kill the normal response. The auto-fetch logic gets its own try/catch so that upstream API errors or D1 failures fall through gracefully — the user still gets their cached (possibly empty) results.

**Step 1: Add imports at the top of `src/app/api/tee-times/route.ts`**

Add these three imports after the existing imports:

```typescript
import { autoFetchIfNeeded } from "@/lib/auto-fetch";
import { todayCT } from "@/lib/format";
import type { CourseRow } from "@/types";
```

**Step 2: Replace the existing try/catch block (lines 94-106) with auto-fetch logic**

The entire try/catch block is replaced. Key difference from original: auto-fetch has its **own try/catch** so failures don't affect the normal response path.

```typescript
  try {
    const result = await db.prepare(query).bind(...bindings).all();

    // Auto-fetch: if single course requested and no cached results, poll upstream.
    // Scoped to course detail page (single course + autoFetch flag).
    // Wrapped in its own try/catch — auto-fetch failure must not kill the response
    // (see dev/testing-pitfalls.md #1: silent failure / error swallowing).
    const autoFetch = searchParams.get("autoFetch") === "true";
    if (autoFetch && courseIds && courseIds.length === 1 && result.results.length === 0) {
      try {
        const course = await db
          .prepare("SELECT * FROM courses WHERE id = ?")
          .bind(courseIds[0])
          .first<CourseRow>();

        if (course) {
          const fetched = await autoFetchIfNeeded(db, course, date, todayCT());
          if (fetched) {
            // Re-query after fresh data was inserted
            const freshResult = await db.prepare(query).bind(...bindings).all();
            return NextResponse.json({
              date,
              teeTimes: freshResult.results,
            });
          }
        }
      } catch (autoFetchErr) {
        // Log but don't fail the request — return cached (empty) results below
        console.error("Auto-fetch error:", autoFetchErr);
      }
    }

    return NextResponse.json({
      date,
      teeTimes: result.results,
    });
  } catch (err) {
    console.error("tee-times query error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass. This route has no unit tests (D1-dependent), but existing tests must not regress.

**Step 5: Commit**

```bash
git add src/app/api/tee-times/route.ts
git commit -m "feat: add auto-fetch to tee-times API with error isolation"
```

---

### Task 6: Update Course Detail Page to Request Auto-Fetch

**Depends on:** Task 5 (tee-times route must accept autoFetch param)

**Files:**
- Modify: `src/app/courses/[id]/page.tsx:33`

**Step 1: Add `autoFetch=true` to the tee-times fetch URL**

In `src/app/courses/[id]/page.tsx:33`, the existing line:
```typescript
fetch(`/api/tee-times?date=${date}&courses=${id}`).then((r) => r.json())
```

Change to:
```typescript
fetch(`/api/tee-times?date=${date}&courses=${id}&autoFetch=true`).then((r) => r.json())
```

This is the ONLY change in this file for this task. Do not modify anything else.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add "src/app/courses/[id]/page.tsx"
git commit -m "feat: enable auto-fetch on course detail page"
```

---

### Task 7: Remove "Last Updated" Timestamp, Relabel Refresh Button

**Files:**
- Modify: `src/components/course-header.tsx`
- Modify: `src/app/courses/[id]/page.tsx`

This task removes the misleading course-level "Last updated X ago" timestamp and changes the refresh button label to "Refresh selected dates."

**Important:** This task modifies `course-header.tsx` AND `page.tsx`. Task 8 will also modify both files. These tasks MUST be executed sequentially, not in parallel.

**Step 1: Modify `src/components/course-header.tsx`**

Make these specific changes:

1. **Remove the `formatAge` import** (line 6):
   Delete `import { formatAge } from "@/lib/format";`

2. **Remove `last_polled` from the interface** (line 16):
   Change the `course` type in `CourseHeaderProps` to:
   ```typescript
   course: {
     id: string;
     name: string;
     city: string;
     booking_url: string;
   };
   ```

3. **Remove `lastRefreshedAt` state** (line 25):
   Delete `const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);`

4. **Remove `setLastRefreshedAt` call in `handleRefresh`** (line 58):
   Delete `setLastRefreshedAt(new Date().toISOString());`

5. **Remove `displayTimestamp` variable** (line 67):
   Delete `const displayTimestamp = lastRefreshedAt ?? course.last_polled;`

6. **Replace the `<p>` block** (lines 74-101) with:
   ```tsx
   <p className="mt-1 text-xs text-gray-400 lg:text-sm">
     {refreshing ? (
       <span className="text-gray-400">Refreshing…</span>
     ) : coolingDown ? (
       <span className="text-gray-400">Refreshed</span>
     ) : (
       <button
         onClick={handleRefresh}
         className="text-green-700 hover:underline"
       >
         Refresh selected dates
       </button>
     )}
   </p>
   ```

**Step 2: Modify `src/app/courses/[id]/page.tsx`**

Remove `last_polled` from the `course` state type (lines 15-21). Change to:
```typescript
const [course, setCourse] = useState<{
  id: string;
  name: string;
  city: string;
  booking_url: string;
} | null>(null);
```

The API still returns `last_polled` in the response — that's fine, it's just ignored now.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS. If there's a lint warning about unused `formatAge` import, the deletion in Step 1 should have resolved it. If not, check that the import was fully removed.

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS. Verify no dead imports remain.

**Step 5: Commit**

```bash
git add src/components/course-header.tsx "src/app/courses/[id]/page.tsx"
git commit -m "feat: remove misleading 'Last updated' timestamp, relabel refresh button"
```

---

### Task 8: Add Toast Confirmation for Manual Refresh

**Depends on:** Task 7 (course-header.tsx must already have the updated interface without `last_polled`)

**Files:**
- Modify: `src/components/course-header.tsx`
- Modify: `src/app/courses/[id]/page.tsx`

The existing `Toast` component in `src/components/toast.tsx` auto-dismisses after 7 seconds. We surface a toast from `CourseHeader` via a callback prop.

**Step 1: Add `onToast` callback to `CourseHeaderProps` in `src/components/course-header.tsx`**

After Task 7, the interface looks like:
```typescript
interface CourseHeaderProps {
  course: { id: string; name: string; city: string; booking_url: string };
  dates: string[];
  onRefreshed: () => void;
}
```

Add `onToast`:
```typescript
interface CourseHeaderProps {
  course: { id: string; name: string; city: string; booking_url: string };
  dates: string[];
  onRefreshed: () => void;
  onToast: (message: string) => void;
}
```

**Step 2: Add `onToast` to the destructured props**

Change:
```typescript
export function CourseHeader({ course, dates, onRefreshed }: CourseHeaderProps) {
```
to:
```typescript
export function CourseHeader({ course, dates, onRefreshed, onToast }: CourseHeaderProps) {
```

**Step 3: Call `onToast` in `handleRefresh` after the successful refresh**

Inside `handleRefresh`, after the `onRefreshed()` call and before `setCoolingDown(true)`, add:

```typescript
const dateLabel = dates.length === 1
  ? new Date(dates[0] + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    })
  : `${new Date(dates[0] + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    })}–${new Date(dates[dates.length - 1] + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    })}`;
onToast(`Refreshed tee times for ${dateLabel}`);
```

Note: Using `T12:00:00Z` noon anchor (same pattern as `fromDateStr` in `src/components/date-picker.tsx:19-21`) avoids timezone drift. `timeZone: "UTC"` ensures the formatted output matches the date string, not the browser's local timezone.

**Step 4: Wire up Toast in `src/app/courses/[id]/page.tsx`**

Add import at the top:
```typescript
import { Toast } from "@/components/toast";
```

Add state inside `CoursePage` component (after the existing useState declarations):
```typescript
const [toastMessage, setToastMessage] = useState<string | null>(null);
```

Update the `CourseHeader` JSX to pass `onToast`:
```tsx
<CourseHeader
  course={course}
  dates={dates}
  onRefreshed={() => fetchData(false)}
  onToast={setToastMessage}
/>
```

Add `Toast` at the bottom of the `<main>` element (before the closing `</main>` tag):
```tsx
<Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/course-header.tsx "src/app/courses/[id]/page.tsx"
git commit -m "feat: add toast confirmation for manual refresh"
```

---

### Task 9: Cap Date Picker at 60 Days

**Files:**
- Modify: `src/components/date-picker.tsx`
- Test: `src/components/date-picker.test.ts`

**Step 1: Read the existing date-picker test file**

Read `src/components/date-picker.test.ts` to understand the existing test patterns before adding a new test.

**Step 2: Write a failing test**

Add a test that imports `MAX_FUTURE_DAYS` and verifies the constant, AND a behavioral test for `buildQuickDays` or similar to verify dates are capped. At minimum:

```typescript
import { MAX_FUTURE_DAYS } from "./date-picker";

it("exports a 60-day future cap", () => {
  expect(MAX_FUTURE_DAYS).toBe(60);
});
```

If the test file has rendering tests using a test library, also verify that the DayPicker receives the correct `disabled` prop. If not, the constant test is sufficient — the DayPicker wiring is verified by type check.

**Step 3: Run test to verify it fails**

Run: `npm test -- src/components/date-picker.test.ts --reporter=verbose`
Expected: FAIL — `MAX_FUTURE_DAYS` not exported yet.

**Step 4: Add the 60-day cap to `src/components/date-picker.tsx`**

Add constant after line 10 (`const MAX_RANGE_DAYS = 14;`):
```typescript
export const MAX_FUTURE_DAYS = 60;
```

Update the `DayPicker` component's `disabled` prop (currently `disabled={{ before: today }}` at line 185).

The `react-day-picker` library's `disabled` prop accepts a `Matcher | Matcher[]`. Change to an array:
```tsx
disabled={[
  { before: today },
  { after: new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_FUTURE_DAYS) },
]}
```

**Important:** Use `Date` constructor with year/month/day arithmetic — NOT `today.getTime() + N * 86_400_000`. The millisecond approach is timezone-fragile near midnight (see `dev/testing-pitfalls.md` #2). The `Date(year, month, day + N)` approach correctly handles month boundaries via JavaScript's Date overflow behavior.

**Step 5: Run test to verify it passes**

Run: `npm test -- src/components/date-picker.test.ts --reporter=verbose`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/date-picker.tsx src/components/date-picker.test.ts
git commit -m "feat: cap date picker at 60 days from today"
```

---

### Task 10: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass with clean output (no warnings, no unexpected console errors).

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean — no errors.

**Step 3: Run lint**

Run: `npm run lint`
Expected: Clean — no warnings or errors.

**Step 4: Review the diff**

Run: `git diff HEAD~N` (where N = number of commits since the plan started) and review all changes for:
- Dead imports (especially `formatAge` in course-header)
- Inconsistent prop interfaces between components and their callers
- Any `TODO` or placeholder code left behind
- Console.log statements that should be console.error

**Step 5: Fix any issues found and commit**

If any tests, lint, or review issues surfaced, fix and commit individually.

**Step 6: Push and open PR**

```bash
git push origin dev
```

Use the `commit-commands:commit-push-pr` skill to open a PR against `main`.
