# Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 19 bugs identified by three independent code analyzers — timezone inconsistencies, silent adapter errors, client resilience, database performance, and code quality.

**Architecture:** Standardize on Central Time (America/Chicago) everywhere since all golf courses are in the Twin Cities metro. Add `todayCT()` to `format.ts`. Fix adapters to throw on HTTP errors instead of silently returning `[]`. Add error isolation to cron loop, bound poll_log queries, and clean up poll_log growth. San Diego test courses will also display in Central Time — this is documented and intentional.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, Cloudflare D1

**Reference:** Bug reports in `dev/bug-reports/` (exploratory, holistic, multipass analyses).

---

## Subagent Execution Notes

**Batch 1:** Task 1 only — foundation task, must complete before Tasks 2-4.
**Batch 2:** Tasks 2, 3, 4 — all parallel (different files, all depend on Task 1's `todayCT`).
**Batch 3:** Tasks 5, 6, 7 — all parallel (independent subsystems).
**Batch 4:** Tasks 8, 9, 10 — all parallel (minor fixes).
**Batch 5:** Task 11 — final verification.

**Content matching:** Tasks that modify files also touched by earlier tasks MUST use content-based Find/Replace, not line numbers. Line numbers drift after earlier tasks modify the same file.

**Mocking convention:** Existing adapter tests use `vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(...))`. All tests MUST use this same pattern.

**ABOUTME comments:** New files MUST start with 2-line ABOUTME comments. Do NOT add ABOUTME to files being modified as part of a non-ABOUTME task — Task 10 handles that separately.

---

## Batch 1: Central Time Foundation

### Task 1: Fix timezone handling in date utilities

The core bug: `toDateStr` uses `toISOString().split("T")[0]` which converts to UTC. After ~7pm Central Time, this returns tomorrow's date. The fix: use `toLocaleDateString("en-CA", { timeZone: "America/Chicago" })` which always produces the correct Central Time date.

Also: `fromDateStr` creates dates at local midnight, which can cause timezone drift. Fix: use noon UTC as a safe anchor point (noon UTC is the same calendar date in all timezones from UTC-12 to UTC+12).

**Files:**
- Modify: `src/lib/format.ts` (add `todayCT`)
- Modify: `src/lib/format.test.ts` (add `todayCT` tests)
- Modify: `src/components/date-picker.tsx` (fix `toDateStr`, `fromDateStr`, update `buildQuickDays`/`datesInRange`/`formatShortDate`)
- Modify: `src/components/date-picker.test.ts` (update tests for new behavior)

**Step 1: Add `todayCT` to format.ts**

In `src/lib/format.ts`, add this function after the existing `staleAge` function:

```typescript
/** Today's date as YYYY-MM-DD in Central Time (America/Chicago).
 * All golf courses in the app are in the Twin Cities metro, so Central Time
 * is the canonical timezone for date logic. San Diego test courses also
 * display in CT — this is intentional. */
export function todayCT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
```

**Step 2: Add `todayCT` tests to format.test.ts**

Add this `describe` block at the end of `src/lib/format.test.ts`:

```typescript
describe("todayCT", () => {
  it("returns a YYYY-MM-DD string", () => {
    const result = todayCT();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

Also update the import at the top of the file — find:
```typescript
import { formatTime, formatAge, staleAge } from "./format";
```
Replace with:
```typescript
import { formatTime, formatAge, staleAge, todayCT } from "./format";
```

**Step 3: Run format tests**

Run: `npm test -- src/lib/format.test.ts`
Expected: All pass (including new `todayCT` test)

**Step 4: Fix `toDateStr` in date-picker.tsx**

In `src/components/date-picker.tsx`, find:
```typescript
export function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}
```
Replace with:
```typescript
// Central Time date string. All courses are in the Twin Cities metro.
export function toDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
```

**Step 5: Fix `fromDateStr` in date-picker.tsx**

In `src/components/date-picker.tsx`, find:
```typescript
export function fromDateStr(s: string): Date {
  return new Date(s + "T00:00:00");
}
```
Replace with:
```typescript
// Noon UTC avoids timezone drift: noon UTC is the same calendar date
// in all timezones from UTC-12 to UTC+12, including Central Time.
export function fromDateStr(s: string): Date {
  return new Date(s + "T12:00:00Z");
}
```

**Step 6: Fix `buildQuickDays` to use UTC accessors**

Since `fromDateStr` now returns noon UTC, `buildQuickDays` must use UTC accessors to get correct day names and numbers. In `src/components/date-picker.tsx`, find:
```typescript
export function buildQuickDays(): { value: string; dayName: string; dayNum: number }[] {
  const days: { value: string; dayName: string; dayNum: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push({
      value: toDateStr(d),
      dayName: i === 0 ? "Today" : DAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
    });
  }
  return days;
}
```
Replace with:
```typescript
export function buildQuickDays(): { value: string; dayName: string; dayNum: number }[] {
  const days: { value: string; dayName: string; dayNum: number }[] = [];
  const today = fromDateStr(toDateStr(new Date()));
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    days.push({
      value: toDateStr(d),
      dayName: i === 0 ? "Today" : DAY_NAMES[d.getUTCDay()],
      dayNum: d.getUTCDate(),
    });
  }
  return days;
}
```

**Step 7: Fix `datesInRange` to use UTC accessors**

In `src/components/date-picker.tsx`, find:
```typescript
export function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = fromDateStr(start);
  const endDate = fromDateStr(end);
  while (d <= endDate) {
    dates.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}
```
Replace with:
```typescript
export function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = fromDateStr(start);
  const endDate = fromDateStr(end);
  while (d <= endDate) {
    dates.push(toDateStr(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}
```

**Step 8: Fix `formatShortDate` to use UTC timezone**

In `src/components/date-picker.tsx`, find:
```typescript
export function formatShortDate(dateStr: string): string {
  const d = fromDateStr(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```
Replace with:
```typescript
export function formatShortDate(dateStr: string): string {
  const d = fromDateStr(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
```

**Step 9: Update date-picker tests**

In `src/components/date-picker.test.ts`, update the `toDateStr` test — find:
```typescript
describe("toDateStr", () => {
  it("converts a Date to YYYY-MM-DD string", () => {
    // Use noon local to avoid UTC/local day mismatch
    const d = new Date(2026, 2, 15, 12, 0, 0); // March 15, noon local
    expect(toDateStr(d)).toBe("2026-03-15");
  });
});
```
Replace with:
```typescript
describe("toDateStr", () => {
  it("converts a Date to YYYY-MM-DD in Central Time", () => {
    // Noon UTC: same calendar date in all timezones including CT
    const d = new Date("2026-03-15T12:00:00Z");
    expect(toDateStr(d)).toBe("2026-03-15");
  });
});
```

Update the `fromDateStr` test — find:
```typescript
describe("fromDateStr", () => {
  it("parses YYYY-MM-DD to a Date at local midnight", () => {
    const d = fromDateStr("2026-03-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed: March = 2
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});
```
Replace with:
```typescript
describe("fromDateStr", () => {
  it("parses YYYY-MM-DD to a Date at noon UTC", () => {
    const d = fromDateStr("2026-03-15");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2); // 0-indexed: March = 2
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(12);
  });
});
```

Update `buildQuickDays` test — find:
```typescript
  it("entries have sequential dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0)); // March 15

    const days = buildQuickDays();
    expect(days[0].value).toBe("2026-03-15");
    expect(days[1].value).toBe("2026-03-16");
    expect(days[6].value).toBe("2026-03-21");
  });
```
Replace with:
```typescript
  it("entries have sequential dates", () => {
    vi.useFakeTimers();
    // 18:00 UTC = 1pm CDT (March is DST). CT date is still March 15.
    vi.setSystemTime(new Date("2026-03-15T18:00:00Z"));

    const days = buildQuickDays();
    expect(days[0].value).toBe("2026-03-15");
    expect(days[1].value).toBe("2026-03-16");
    expect(days[6].value).toBe("2026-03-21");
  });
```

**Step 10: Run all tests + type-check + lint**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run lint`
Expected: No errors (or pre-existing config issue only)

**Step 11: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/components/date-picker.tsx src/components/date-picker.test.ts
git commit -m "fix: use Central Time for all date calculations instead of UTC"
```

---

## Batch 2: Client-Side Fixes (depends on Task 1)

### Task 2: Fix page.tsx — CT date + error resilience

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add todayCT import**

In `src/app/page.tsx`, find the imports at the top:
```typescript
import { getFavorites } from "@/lib/favorites";
```
Add after it:
```typescript
import { todayCT } from "@/lib/format";
```

**Step 2: Fix date initialization**

In `src/app/page.tsx`, find:
```typescript
  const [dates, setDates] = useState<string[]>(() => [
    new Date().toISOString().split("T")[0],
  ]);
```
Replace with:
```typescript
  const [dates, setDates] = useState<string[]>(() => [todayCT()]);
```

**Step 3: Fix Promise.all error handling — preserve existing tee times on partial failure**

In `src/app/page.tsx`, find the catch block:
```typescript
      } catch {
        setTeeTimes([]);
      } finally {
```
Replace with:
```typescript
      } catch (err) {
        console.error("Failed to fetch tee times:", err);
      } finally {
```

**Step 4: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "fix: use Central Time default date and preserve tee times on fetch error"
```

---

### Task 3: Fix courses/[id]/page.tsx — CT date + error resilience + type safety

**Files:**
- Modify: `src/app/courses/[id]/page.tsx`

**Step 1: Add todayCT import**

In `src/app/courses/[id]/page.tsx`, find:
```typescript
import { CourseHeader } from "@/components/course-header";
```
Add after it:
```typescript
import { todayCT } from "@/lib/format";
```

**Step 2: Fix date initialization**

Find:
```typescript
  const [dates, setDates] = useState<string[]>(() => [
    new Date().toISOString().split("T")[0],
  ]);
```
Replace with:
```typescript
  const [dates, setDates] = useState<string[]>(() => [todayCT()]);
```

**Step 3: Fix `any` types**

Find:
```typescript
  const [course, setCourse] = useState<any>(null);
  const [teeTimes, setTeeTimes] = useState<any[]>([]);
```
Replace with:
```typescript
  const [course, setCourse] = useState<{
    id: string;
    name: string;
    city: string;
    booking_url: string;
    last_polled: string | null;
  } | null>(null);
  const [teeTimes, setTeeTimes] = useState<
    { date: string; time: string; price: number | null; holes: number; open_slots: number; course_name: string; course_city: string; booking_url: string; fetched_at: string }[]
  >([]);
```

Then find the `courseRes.json()` cast:
```typescript
      const courseData = (await courseRes.json()) as any;
      const merged = (timesResults as any[]).flatMap((r) => r.teeTimes ?? []);
```
Replace with:
```typescript
      const courseData = await courseRes.json();
      const merged = timesResults.flatMap((r: { teeTimes?: typeof teeTimes }) => r.teeTimes ?? []);
```

**Step 4: Fix Promise.all error handling — preserve existing data on failure**

Find:
```typescript
    } catch {
      setTeeTimes([]);
    } finally {
```
Replace with:
```typescript
    } catch (err) {
      console.error("Failed to fetch course data:", err);
    } finally {
```

**Step 5: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/app/courses/[id]/page.tsx
git commit -m "fix: use CT date, add type safety, preserve data on fetch error"
```

---

### Task 4: Fix refresh route — CT default date + double-fault protection

The refresh route defaults to UTC when no `date` param is given. Also, if `pollCourse` throws (because `logPoll` throws inside its catch block — a double-fault), the exception is unhandled.

**Files:**
- Modify: `src/app/api/courses/[id]/refresh/route.ts`

**Step 1: Fix UTC default date**

In `src/app/api/courses/[id]/refresh/route.ts`, find:
```typescript
  const date = dateParam ?? new Date().toISOString().split("T")[0];
```
Replace with:
```typescript
  // Default to today in Central Time — all courses are in the Twin Cities metro
  const date = dateParam ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
```

**Step 2: Add try/catch around pollCourse for double-fault protection**

Find:
```typescript
  const result = await pollCourse(db, course, date);

  if (result === "error") {
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: "Refreshed", courseId: id, date, result });
}
```
Replace with:
```typescript
  try {
    const result = await pollCourse(db, course, date);

    if (result === "error") {
      return NextResponse.json(
        { error: "Refresh failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Refreshed", courseId: id, date, result });
  } catch (err) {
    console.error("Refresh exception:", err);
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 500 }
    );
  }
}
```

**Step 3: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/app/api/courses/[id]/refresh/route.ts
git commit -m "fix: use Central Time default date and handle pollCourse exceptions"
```

---

## Batch 3: Backend Robustness

### Task 5: Make adapters throw on HTTP errors

Currently both adapters return `[]` on HTTP errors, making API failures indistinguishable from "no tee times available" in poll_log. Fix: remove adapter-level try/catch and throw on non-200 responses. The poller's existing try/catch handles error logging.

Also: config guards (`!apiKey`, `!scheduleId`) should throw since missing config is an error, not "no data".

**Files:**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/foreup.ts`
- Modify: `src/adapters/cps-golf.test.ts`
- Modify: `src/adapters/foreup.test.ts`

**Step 1: Fix CPS Golf adapter**

In `src/adapters/cps-golf.ts`, find the config guard:
```typescript
    if (!apiKey) {
      return [];
    }
```
Replace with:
```typescript
    if (!apiKey) {
      throw new Error("Missing apiKey in platformConfig");
    }
```

Find the non-ok check:
```typescript
      if (!response.ok) {
        return [];
      }
```
Replace with:
```typescript
      if (!response.ok) {
        throw new Error(`CPS Golf API returned HTTP ${response.status}`);
      }
```

Remove the try/catch wrapper entirely. The code inside the try block will remain at 6-space indent — this is cosmetically imperfect but syntactically valid.

Remove the catch block — find:
```typescript
    } catch {
      return [];
    }
```
Replace with empty string (delete entirely — no replacement text).

Remove the try opening — find:
```typescript
    try {
```
Replace with empty string (delete entirely — no replacement text).

After both removals, the code inside the former try block stays at its current 6-space indentation. The method's closing `}` at 2-space indent is unchanged. Do NOT add any `}` braces.

**Step 2: Fix ForeUp adapter**

In `src/adapters/foreup.ts`, find:
```typescript
    if (!scheduleId) {
      return [];
    }
```
Replace with:
```typescript
    if (!scheduleId) {
      throw new Error("Missing scheduleId in platformConfig");
    }
```

Find the non-ok check:
```typescript
      if (!response.ok) {
        return [];
      }
```
Replace with:
```typescript
      if (!response.ok) {
        throw new Error(`ForeUp API returned HTTP ${response.status}`);
      }
```

Remove the try/catch wrapper entirely (same approach as CPS Golf).

Remove the catch block — find:
```typescript
    } catch {
      return [];
    }
```
Replace with empty string (delete entirely — no replacement text).

Remove the try opening — find:
```typescript
    try {
```
Replace with empty string (delete entirely — no replacement text).

After both removals, the code inside the former try block stays at its current 6-space indentation. The method's closing `}` at 2-space indent is unchanged. Do NOT add any `}` braces.

**Step 3: Update CPS Golf tests**

In `src/adapters/cps-golf.test.ts`, find the test:
```typescript
  it("returns empty array on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });
```
Replace with:
```typescript
  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("HTTP 401");
  });
```

Find the test:
```typescript
  it("returns empty array on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });
```
Replace with:
```typescript
  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("timeout");
  });
```

Find the test:
```typescript
  it("skips courses with missing apiKey", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { subdomain: "minneapolisgrossnational" },
    };

    const results = await adapter.fetchTeeTimes(incompleteConfig, "2026-04-15");
    expect(results).toEqual([]);
  });
```
Replace with:
```typescript
  it("throws for courses with missing apiKey", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: { subdomain: "minneapolisgrossnational" },
    };

    await expect(adapter.fetchTeeTimes(incompleteConfig, "2026-04-15")).rejects.toThrow("Missing apiKey");
  });
```

**Step 4: Update ForeUp tests**

In `src/adapters/foreup.test.ts`, find:
```typescript
  it("returns empty array on error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fail"));

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
    expect(results).toEqual([]);
  });
```
Replace with:
```typescript
  it("throws on fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fail"));

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-04-15")).rejects.toThrow("fail");
  });
```

Find:
```typescript
  it("skips courses with missing scheduleId", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: {},
    };

    const results = await adapter.fetchTeeTimes(incompleteConfig, "2026-04-15");
    expect(results).toEqual([]);
  });
```
Replace with:
```typescript
  it("throws for courses with missing scheduleId", async () => {
    const incompleteConfig: CourseConfig = {
      ...mockConfig,
      platformConfig: {},
    };

    await expect(adapter.fetchTeeTimes(incompleteConfig, "2026-04-15")).rejects.toThrow("Missing scheduleId");
  });
```

Find:
```typescript
  it("returns empty array on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result).toEqual([]);
  });
```
Replace with:
```typescript
  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    await expect(adapter.fetchTeeTimes(mockConfig, "2026-03-15")).rejects.toThrow("HTTP 500");
  });
```

**Step 5: Run all tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/adapters/cps-golf.ts src/adapters/foreup.ts src/adapters/cps-golf.test.ts src/adapters/foreup.test.ts
git commit -m "fix: adapters throw on HTTP errors instead of silently returning empty"
```

---

### Task 6: Cron error isolation + poll_log cleanup

Two issues: (1) a D1 error on one course kills polling for all remaining courses, (2) poll_log grows unbounded.

**Files:**
- Modify: `src/lib/cron-handler.ts`
- Modify: `src/lib/cron-handler.test.ts`

**Step 1: Add error isolation around per-course polling**

In `src/lib/cron-handler.ts`, find the inner loop:
```typescript
  for (const course of courses) {
    for (let i = 0; i < dates.length; i++) {
      const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
      const minutesSinceLast = lastPolled
        ? (Date.now() - new Date(lastPolled).getTime()) / 60000
        : Infinity;

      if (shouldPollDate(i, minutesSinceLast)) {
        await pollCourse(db, course, dates[i]);
        pollCount++;

        // Rate limit: CPS Golf allows 5 req/sec. 250ms between requests
        // gives ~4 req/sec with headroom. ForeUp has no known limit but
        // being polite doesn't hurt.
        await sleep(250);
      }
    }
  }
```
Replace with:
```typescript
  for (const course of courses) {
    try {
      for (let i = 0; i < dates.length; i++) {
        const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
        const minutesSinceLast = lastPolled
          ? (Date.now() - new Date(lastPolled).getTime()) / 60000
          : Infinity;

        if (shouldPollDate(i, minutesSinceLast)) {
          await pollCourse(db, course, dates[i]);
          pollCount++;

          // Rate limit: CPS Golf allows 5 req/sec. 250ms between requests
          // gives ~4 req/sec with headroom. ForeUp has no known limit but
          // being polite doesn't hurt.
          await sleep(250);
        }
      }
    } catch (err) {
      console.error(`Error polling course ${course.id}:`, err);
    }
  }
```

**Step 2: Add poll_log cleanup at end of cron run**

In `src/lib/cron-handler.ts`, find the return statement at the end of `runCronPoll`:
```typescript
  return { pollCount, courseCount: courses.length, skipped: false };
```
Add poll_log cleanup BEFORE the return:
```typescript
  // Purge poll_log entries older than 7 days to prevent unbounded growth
  try {
    await db
      .prepare("DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')")
      .run();
  } catch (err) {
    console.error("poll_log cleanup error:", err);
  }

  return { pollCount, courseCount: courses.length, skipped: false };
```

**Step 3: Run tests**

Run: `npm test -- src/lib/cron-handler.test.ts`
Expected: All pass (existing tests should still work — the error isolation wraps existing behavior, and cleanup is a new step after the main loop)

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/lib/cron-handler.ts
git commit -m "fix: isolate cron errors per-course and purge old poll_log entries"
```

---

### Task 7: Bound ROW_NUMBER() queries with time filter

The `ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC)` subquery in the courses API routes scans the entire `poll_log` table. Add a `WHERE` clause to bound the scan to recent entries.

**Files:**
- Modify: `src/app/api/courses/route.ts`
- Modify: `src/app/api/courses/[id]/route.ts`

**Step 1: Fix courses list route**

In `src/app/api/courses/route.ts`, find the subquery:
```typescript
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
```
Replace with:
```typescript
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
           WHERE polled_at > datetime('now', '-24 hours')
```

**Step 2: Fix course detail route**

In `src/app/api/courses/[id]/route.ts`, find the same subquery:
```typescript
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
```
Replace with:
```typescript
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
           WHERE polled_at > datetime('now', '-24 hours')
```

**Step 3: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/app/api/courses/route.ts src/app/api/courses/[id]/route.ts
git commit -m "perf: bound poll_log ROW_NUMBER queries to last 24 hours"
```

---

## Batch 4: Minor Fixes

### Task 8: CourseHeader timer cleanup + comment fixes

**Files:**
- Modify: `src/components/course-header.tsx` (add useEffect cleanup for cooldown timer)
- Modify: `src/lib/poller.ts` (fix misleading comment)
- Modify: `src/lib/rate-limit.ts` (add comment explaining SQL interpolation)

**Step 1: Fix cooldown timer leak in CourseHeader**

In `src/components/course-header.tsx`, find the import line:
```typescript
import { useRef, useState } from "react";
```
Replace with:
```typescript
import { useEffect, useRef, useState } from "react";
```

Then find:
```typescript
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const handleToggle = () => {
```
Replace with:
```typescript
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  const handleToggle = () => {
```

**Step 2: Fix misleading shouldPollDate comment**

In `src/lib/poller.ts`, find:
```typescript
  if (dayOffset <= 3) {
    // Days 3-4: every 30 minutes
    return minutesSinceLastPoll >= 30;
  }
```
Replace with:
```typescript
  if (dayOffset <= 3) {
    // Offsets 2-3 (day after tomorrow + next): every 30 minutes
    return minutesSinceLastPoll >= 30;
  }
```

**Step 3: Add explanatory comment for rate-limit SQL interpolation**

In `src/lib/rate-limit.ts`, find:
```typescript
  // Per-course cooldown: any date
  const recentPoll = await db
    .prepare(
      `SELECT polled_at FROM poll_log
       WHERE course_id = ? AND polled_at > datetime('now', '-${COURSE_COOLDOWN_SECONDS} seconds')
```
Replace with:
```typescript
  // Per-course cooldown: any date
  // Note: COURSE_COOLDOWN_SECONDS is interpolated (not bound) because SQLite's
  // datetime() modifier string cannot accept parameter bindings. The value is a
  // module-level constant, not user input.
  const recentPoll = await db
    .prepare(
      `SELECT polled_at FROM poll_log
       WHERE course_id = ? AND polled_at > datetime('now', '-${COURSE_COOLDOWN_SECONDS} seconds')
```

**Step 4: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/course-header.tsx src/lib/poller.ts src/lib/rate-limit.ts
git commit -m "fix: clean up cooldown timer on unmount, fix misleading comments"
```

---

### Task 9: Deactivate misconfigured courses

12 CPS Golf courses are missing `apiKey` and 1 ForeUp course (Bunker Hills) is missing `scheduleId`. These courses can never return tee times, but the cron handler polls them every cycle, wasting time and polluting poll_log with `no_data` entries.

**Files:**
- Modify: `src/config/courses.json`

**Step 1: Set `is_active` to `0` for misconfigured courses**

In `src/config/courses.json`, set `"is_active": 0` for every course where `platformConfig` is missing its required key:
- CPS Golf courses missing `apiKey`: all CPS Golf entries EXCEPT `sd-twirth` (Theodore Wirth, which has an apiKey)
- ForeUp courses missing `scheduleId`: `sd-bunker-hills` (Bunker Hills)

For each affected course, find `"is_active": 1` and change to `"is_active": 0`. The affected course IDs are:
- `sd-gross-national`
- `sd-meadowbrook`
- `sd-columbia`
- `sd-hiawatha`
- `sd-phalen`
- `sd-chaska`
- `sd-edinburgh`
- `sd-oak-glen`
- `sd-highland`
- `sd-como`
- `sd-victory-links`
- `sd-gem-lake`
- `sd-bunker-hills`

Read the file first to confirm the exact course IDs, then change each one's `is_active` to `0`.

**Step 2: Verify**

Run: `npm test`
Expected: All pass (courses.json is only read at runtime, not in tests)

**Step 3: Commit**

```bash
git add src/config/courses.json
git commit -m "chore: deactivate courses missing required platform config"
```

---

### Task 10: Add ABOUTME comments to files missing them

Per project convention, every code file must start with 2-line ABOUTME comments. 20 files are missing them.

**Files to modify (add ABOUTME at the very top, before any existing code or imports):**

```
src/adapters/cps-golf.ts
// ABOUTME: CPS Golf (Club Prophet) platform adapter for fetching tee times.
// ABOUTME: Handles API auth, date formatting, and response parsing for CPS-hosted courses.

src/adapters/cps-golf.test.ts
// ABOUTME: Tests for the CPS Golf adapter.
// ABOUTME: Covers API URL construction, response parsing, error handling, and edge cases.

src/adapters/foreup.ts
// ABOUTME: ForeUp platform adapter for fetching tee times.
// ABOUTME: Handles API requests, time format conversion, and price parsing.

src/adapters/foreup.test.ts
// ABOUTME: Tests for the ForeUp adapter.
// ABOUTME: Covers API URL construction, response parsing, price edge cases, and errors.

src/adapters/index.ts
// ABOUTME: Platform adapter registry mapping platform IDs to adapter instances.
// ABOUTME: Used by the poller to look up the correct adapter for each course.

src/app/api/courses/route.ts
// ABOUTME: API route listing all courses with their most recent poll status.
// ABOUTME: Returns course metadata joined with latest poll_log entry.

src/app/api/courses/[id]/route.ts
// ABOUTME: API route returning detail for a single course by ID.
// ABOUTME: Includes latest poll status from poll_log.

src/app/api/courses/[id]/refresh/route.ts
// ABOUTME: API route for user-triggered tee time refresh on a single course.
// ABOUTME: Enforces rate limiting and returns poll result status.

src/app/api/tee-times/route.ts
// ABOUTME: API route querying cached tee times with optional date, course, time, and slot filters.
// ABOUTME: Returns tee times joined with course metadata.

src/app/layout.tsx
// ABOUTME: Root layout with global styles, metadata, and navigation.
// ABOUTME: Wraps all pages with Nav component and base styling.

src/app/page.tsx
// ABOUTME: Home page showing tee times across all courses with date and time filtering.
// ABOUTME: Supports favorites toggle to filter to user's preferred courses.

src/components/nav.tsx
// ABOUTME: Top navigation bar with site logo and wordmark.
// ABOUTME: Dark-themed fixed header used across all pages.

src/components/tee-time-list.tsx
// ABOUTME: Tee time list component rendering available times with price, slots, and staleness.
// ABOUTME: Groups times by course with links to course detail pages.

src/lib/cron-handler.ts
// ABOUTME: Cron polling orchestrator that runs on a 5-minute schedule.
// ABOUTME: Controls polling frequency by time of day and polls active courses via adapters.

src/lib/cron-handler.test.ts
// ABOUTME: Tests for the cron handler's time-of-day polling frequency logic.
// ABOUTME: Covers shouldRunThisCycle at different Central Time hours.

src/lib/db.ts
// ABOUTME: D1 database helpers for upserting tee times and logging poll attempts.
// ABOUTME: Uses batch transactions for atomic delete+insert of tee time data.

src/lib/favorites.ts
// ABOUTME: Client-side favorites management using localStorage.
// ABOUTME: Stores favorite course IDs with SSR-safe window guard.

src/lib/poller.ts
// ABOUTME: Core polling logic for fetching tee times from platform adapters.
// ABOUTME: Handles per-date polling frequency and result logging to poll_log.

src/lib/poller.test.ts
// ABOUTME: Tests for polling logic including date frequency, month boundaries, and error handling.
// ABOUTME: Covers shouldPollDate, getPollingDates, and pollCourse with mocked adapters.

src/types/index.ts
// ABOUTME: TypeScript interfaces for the app's domain model.
// ABOUTME: Defines CourseConfig, TeeTime, PlatformAdapter, and D1 row types.
```

For each file: add the 2 ABOUTME lines at the very top (line 1), before any existing content. If the file starts with `"use client";` or an import, the ABOUTME goes ABOVE that.

**Important:** For files that already have comments or `"use client"` at the top, insert the ABOUTME lines at line 1 and push everything else down. Exception: `src/app/courses/[id]/page.tsx` and `src/components/course-header.tsx` ALREADY have ABOUTME — skip them.

**Step 1: Add ABOUTME to all 20 files listed above**

**Step 2: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/adapters/ src/app/ src/components/ src/lib/ src/types/
git commit -m "chore: add ABOUTME comments to all source files"
```

---

## Batch 5: Final Verification

### Task 11: Full verification + build

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors (or pre-existing config issue only)

**Step 4: Run build**

Run: `npx @opennextjs/cloudflare build`
Expected: Build succeeds

**Step 5: Commit bug reports**

```bash
git add dev/bug-reports/
git commit -m "docs: add bug hunt analysis reports"
```

---

## Summary of Changes

| Batch | Tasks | Focus | Parallelizable? |
|-------|-------|-------|-----------------|
| 1 | Task 1 | Central Time foundation | N/A — single task |
| 2 | Tasks 2-4 | Client CT dates + error resilience + type safety | Yes, all 3 |
| 3 | Tasks 5-7 | Adapter errors, cron isolation, query performance | Yes, all 3 |
| 4 | Tasks 8-10 | Timer cleanup, deactivate courses, ABOUTME | Yes, all 3 |
| 5 | Task 11 | Final verification | N/A — single task |

**Bugs addressed:** All 19 findings from the three bug hunt reports.

**Not addressed (intentional):**
- Cron overlap protection (YAGNI — 19 courses take ~33s, well under the 5-min interval)
- `formatCpsDate` day padding (current `day: "2-digit"` matches CPS API expectations)
- `upsertTeeTimes` time parsing edge case (the `includes("T")` guard handles all realistic inputs)
