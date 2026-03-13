# Data Freshness & Polling Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend polling to 30 days, add auto-fetch on course detail view, fix misleading freshness display, and clarify the refresh button.

**Architecture:** Backend changes to `poller.ts` (tier logic + date count), `tee-times/route.ts` (auto-fetch side effect), and `rate-limit.ts` (per-date dedup). Frontend changes to `course-header.tsx` (remove timestamp, relabel button, add toast), `tee-time-list.tsx` (empty-state messaging), and `date-picker.tsx` (60-day cap).

**Tech Stack:** TypeScript, Vitest, Next.js App Router, Cloudflare D1 (SQLite), React

**Design doc:** `docs/plans/2026-03-13-data-freshness-design.md`

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

Replace the entire `shouldPollDate` describe block with tests matching the new 4-tier design:

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

  it("polls days 15-30 every 12 hours", () => {
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
  // Days 15-30: twice daily (~12 hours)
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

The cron handler comment says "full 7-date polling" — update to "full 30-date polling." Also, the `poll_log` batch query uses `-24 hours` lookback, which is insufficient for tier 4 (12-hour interval needs history beyond 12 hours, but 24 hours is fine). No functional change needed, just the comment.

**Step 1: Update comments in cron-handler.ts**

Change line 44-45 comment from:
```
 * Two-tier polling:
 * - Active courses: full 7-date polling at dynamic frequency
```
to:
```
 * Two-tier polling:
 * - Active courses: full 30-date polling at dynamic frequency
```

Change line 93 comment from:
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

This module checks `poll_log` for a specific course+date and determines if auto-fetch should run. It also performs the auto-fetch by calling `pollCourse`.

**Step 1: Write the failing test**

Create `src/lib/auto-fetch.test.ts`:

```typescript
// ABOUTME: Tests for auto-fetch logic that transparently polls when cached data is missing.
// ABOUTME: Covers freshness thresholds, poll_log dedup, and global rate limiting.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldAutoFetch, autoFetchIfNeeded } from "./auto-fetch";

describe("shouldAutoFetch", () => {
  it("returns true when poll_log has no entry for course+date", () => {
    expect(shouldAutoFetch(null, 3)).toBe(true);
  });

  it("returns false when recent poll exists within tier threshold (days 3-7)", () => {
    // 10 minutes ago — within 15-min threshold
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(shouldAutoFetch(tenMinAgo, 5)).toBe(false);
  });

  it("returns true when poll is older than tier threshold (days 3-7)", () => {
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(shouldAutoFetch(twentyMinAgo, 5)).toBe(true);
  });

  it("returns false when recent poll exists within tier threshold (days 8-14)", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(shouldAutoFetch(oneHourAgo, 10)).toBe(false);
  });

  it("returns true when poll is older than tier threshold (days 8-14)", () => {
    const threeHoursAgo = new Date(Date.now() - 180 * 60_000).toISOString();
    expect(shouldAutoFetch(threeHoursAgo, 10)).toBe(true);
  });

  it("uses 12-hour threshold for days 15-30", () => {
    const sixHoursAgo = new Date(Date.now() - 360 * 60_000).toISOString();
    expect(shouldAutoFetch(sixHoursAgo, 20)).toBe(false);
    const thirteenHoursAgo = new Date(Date.now() - 780 * 60_000).toISOString();
    expect(shouldAutoFetch(thirteenHoursAgo, 20)).toBe(true);
  });

  it("uses 5-minute threshold for days 0-2", () => {
    const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(shouldAutoFetch(threeMinAgo, 1)).toBe(false);
    const sixMinAgo = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(shouldAutoFetch(sixMinAgo, 1)).toBe(true);
  });

  it("returns true for days beyond 30 with no recent poll", () => {
    expect(shouldAutoFetch(null, 45)).toBe(true);
  });

  it("uses 12-hour threshold for days beyond 30", () => {
    const sixHoursAgo = new Date(Date.now() - 360 * 60_000).toISOString();
    expect(shouldAutoFetch(sixHoursAgo, 45)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

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

  // Check global rate limit (reuse threshold from rate-limit.ts)
  const globalCount = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM poll_log
       WHERE polled_at > ${sqliteIsoNow("-60 seconds")}`
    )
    .first<{ cnt: number }>();

  if (globalCount && globalCount.cnt > 20) return false;

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

**Step 5: Commit**

```bash
git add src/lib/auto-fetch.ts src/lib/auto-fetch.test.ts
git commit -m "feat: add auto-fetch module with per-date freshness check"
```

---

### Task 5: Add Auto-Fetch to Tee-Times API Route

**Files:**
- Modify: `src/app/api/tee-times/route.ts`
- Test: Manual verification (API route with D1 dependency — tested via integration/preview)

The tee-times route gains a new optional parameter `autoFetch=true` that the course detail page sends. When present with a single `courses` param, auto-fetch fires for that course+date if stale.

**Step 1: Update route to support auto-fetch**

In `src/app/api/tee-times/route.ts`, after the existing query logic but before returning results, add auto-fetch logic. The route needs to:

1. Accept `autoFetch=true` query param
2. Only activate when a single course ID is provided (course detail page)
3. Check poll_log staleness for each date+course combo
4. If stale or missing, call `autoFetchIfNeeded`, then re-query

Add imports at the top:
```typescript
import { autoFetchIfNeeded } from "@/lib/auto-fetch";
import { todayCT } from "@/lib/format";
import type { CourseRow } from "@/types";
```

After the existing query (around line 94), insert auto-fetch logic:

```typescript
  try {
    const result = await db.prepare(query).bind(...bindings).all();

    // Auto-fetch: if single course requested and no cached results, poll upstream
    const autoFetch = searchParams.get("autoFetch") === "true";
    if (autoFetch && courseIds && courseIds.length === 1 && result.results.length === 0) {
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

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/api/tee-times/route.ts
git commit -m "feat: add auto-fetch to tee-times API for course detail page"
```

---

### Task 6: Update Course Detail Page to Request Auto-Fetch

**Files:**
- Modify: `src/app/courses/[id]/page.tsx:33`

**Step 1: Add `autoFetch=true` to the tee-times fetch URL**

In `src/app/courses/[id]/page.tsx:33`, change:
```typescript
fetch(`/api/tee-times?date=${date}&courses=${id}`).then((r) => r.json())
```
to:
```typescript
fetch(`/api/tee-times?date=${date}&courses=${id}&autoFetch=true`).then((r) => r.json())
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/courses/[id]/page.tsx
git commit -m "feat: enable auto-fetch on course detail page"
```

---

### Task 7: Remove "Last Updated" Timestamp from Course Header

**Files:**
- Modify: `src/components/course-header.tsx`
- Test: Visual verification

**Step 1: Simplify the course header**

Remove the `lastRefreshedAt` state, `displayTimestamp`, and the `formatAge` import. Replace the timestamp display with just the refresh button. Remove `last_polled` from the interface since it's no longer needed.

The new `<p>` section in the return (replacing lines 74-101):

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

Remove from the interface:
- `last_polled` property (no longer displayed)

Remove from the component:
- `lastRefreshedAt` state
- `displayTimestamp` variable
- `formatAge` import
- The `setLastRefreshedAt(...)` call in `handleRefresh`

**Step 2: Update the CourseHeaderProps interface**

The `course` prop no longer needs `last_polled`. Remove it:

```typescript
interface CourseHeaderProps {
  course: {
    id: string;
    name: string;
    city: string;
    booking_url: string;
  };
  dates: string[];
  onRefreshed: () => void;
}
```

**Step 3: Update the course detail page to stop passing `last_polled`**

In `src/app/courses/[id]/page.tsx`, the `course` state type includes `last_polled`. Remove it:

```typescript
const [course, setCourse] = useState<{
  id: string;
  name: string;
  city: string;
  booking_url: string;
} | null>(null);
```

**Step 4: Run type check and verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/course-header.tsx src/app/courses/[id]/page.tsx
git commit -m "feat: remove misleading 'Last updated' timestamp, relabel refresh button"
```

---

### Task 8: Add Toast Confirmation for Manual Refresh

**Files:**
- Modify: `src/components/course-header.tsx`
- Modify: `src/app/courses/[id]/page.tsx`

The existing `Toast` component in `src/components/toast.tsx` is reusable. We need to surface a toast message from `CourseHeader` up to the page.

**Step 1: Add `onToast` callback to CourseHeader**

Update `CourseHeaderProps`:

```typescript
interface CourseHeaderProps {
  course: {
    id: string;
    name: string;
    city: string;
    booking_url: string;
  };
  dates: string[];
  onRefreshed: () => void;
  onToast: (message: string) => void;
}
```

In `handleRefresh`, after the successful refresh, call `onToast`:

```typescript
// After onRefreshed() call:
const dateLabel = dates.length === 1
  ? new Date(dates[0] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  : `${new Date(dates[0] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}–${new Date(dates[dates.length - 1] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
onToast(`Refreshed tee times for ${dateLabel}`);
```

**Step 2: Wire up Toast in the course detail page**

In `src/app/courses/[id]/page.tsx`, add toast state and render the Toast component:

```typescript
import { Toast } from "@/components/toast";

// Inside CoursePage component:
const [toastMessage, setToastMessage] = useState<string | null>(null);
```

Update the CourseHeader usage:
```tsx
<CourseHeader
  course={course}
  dates={dates}
  onRefreshed={() => fetchData(false)}
  onToast={setToastMessage}
/>
```

Add Toast at the bottom of the `<main>`:
```tsx
<Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/course-header.tsx src/app/courses/[id]/page.tsx
git commit -m "feat: add toast confirmation for manual refresh"
```

---

### Task 9: Cap Date Picker at 60 Days

**Files:**
- Modify: `src/components/date-picker.tsx`
- Test: `src/components/date-picker.test.ts`

**Step 1: Write a failing test for the 60-day cap**

Check whether the date picker test file already has tests for the disabled dates. If not, add:

```typescript
it("disables dates beyond 60 days from today", () => {
  // The DayPicker `disabled` prop should include { after: <60 days out> }
  // Test via the MAX_FUTURE_DAYS export
  expect(MAX_FUTURE_DAYS).toBe(60);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/date-picker.test.ts --reporter=verbose`
Expected: FAIL — `MAX_FUTURE_DAYS` not exported yet.

**Step 3: Add the 60-day cap**

In `src/components/date-picker.tsx`, add constant:
```typescript
export const MAX_FUTURE_DAYS = 60;
```

Update the `DayPicker` component's `disabled` prop (line 185):
```tsx
disabled={[
  { before: today },
  { after: new Date(today.getTime() + MAX_FUTURE_DAYS * 86_400_000) },
]}
```

Note: The `DayPicker` `disabled` prop accepts an array of matchers.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/date-picker.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/date-picker.tsx src/components/date-picker.test.ts
git commit -m "feat: cap date picker at 60 days from today"
```

---

### Task 10: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean.

**Step 3: Run lint**

Run: `npm run lint`
Expected: Clean.

**Step 4: Commit any remaining fixes**

If any tests or lint issues surfaced, fix and commit.

**Step 5: Push and open PR**

```bash
git push origin dev
```

Use the `commit-commands:commit-push-pr` skill to open a PR against `main`.
