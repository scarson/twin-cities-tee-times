# Test Coverage & Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close test coverage gaps, fix UX bugs (mobile layout, refresh not working), and add server-side rate limiting to the refresh endpoint.

**Architecture:** Extract pure functions into shared `src/lib/format.ts` util, export component helpers for testability, add rate limiting via D1 poll_log (no new infrastructure), add input validation and error handling to API routes. All tests use vitest with no DOM/render testing — focus on pure functions and API logic.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, Cloudflare D1

**Reference:** See `dev/test-coverage-reports/2026-03-09-full-coverage-review.md` for the full gap analysis.

---

## Subagent Execution Notes

**Parallelism within batches:** Tasks within a batch may be dispatched as parallel subagents UNLESS they share files. File conflicts are noted below.

**Batch 1:** Tasks 1-4 touch different files — all 4 can run in parallel.
**Batch 2:** Tasks 5-6 touch different files — both can run in parallel.
**Batch 3:** Task 8 only (Task 7 was completed in commit `20dfa6c`). Task 8 modifies `course-header.tsx`, `poller.ts`, and `refresh/route.ts`. **Line number warning:** Task 1 (Batch 1) modifies `course-header.tsx` (adds an import, removes `timeAgo`), and commit `20dfa6c` also modified both `course-header.tsx` and `refresh/route.ts`. Match by content, not line numbers.
**Batch 4:** ~~Task 9~~ — DONE (commit `20dfa6c` extracted rate limiting to `src/lib/rate-limit.ts` with tests). Skip this batch entirely.
**Batch 5:** Tasks 10-11 touch different files — both can run in parallel.
**Batch 6:** Tasks 12-13 are sequential (12 adds tests, 13 verifies everything).

**Lint step:** Every task that modifies source code should run `npm run lint` before committing. If lint fails, fix lint errors before committing.

**ABOUTME comments:** New files created by this plan MUST start with 2-line ABOUTME comments (shown in plan code). Do NOT add ABOUTME comments to existing files being modified — that's a separate concern.

**Mocking convention:** Existing adapter tests use `vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(...))`. All new tests in this plan MUST use this same pattern, not `vi.stubGlobal`.

---

## Batch 1: Shared Utils — Extract, Consolidate, Test

### Task 1: Create shared time formatting util

`timeAgo` (course-header.tsx:110-118) and `staleAge` (tee-time-list.tsx:93-98) are near-duplicates. Extract both into a shared module with a single `formatAge` function, plus the existing `formatTime` (tee-time-list.tsx:100-106).

**Files:**
- Create: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`
- Modify: `src/components/tee-time-list.tsx` (remove `staleAge` and `formatTime`, import from format)
- Modify: `src/components/course-header.tsx` (remove `timeAgo`, import from format)
- NO changes needed to `src/components/tee-time-list.test.ts` — it imports `isStale` and `STALE_THRESHOLD_MS` which stay in tee-time-list.tsx

**Step 1: Write the failing tests**

```typescript
// src/lib/format.test.ts
// ABOUTME: Tests for shared time/date formatting utilities.
// ABOUTME: Covers formatTime, formatAge, and staleAge with boundary conditions.

import { describe, it, expect } from "vitest";
import { formatTime, formatAge, staleAge } from "./format";

describe("formatTime", () => {
  it("formats morning time", () => {
    expect(formatTime("09:30")).toBe("9:30 AM");
  });

  it("formats afternoon time", () => {
    expect(formatTime("14:00")).toBe("2:00 PM");
  });

  it("formats noon as 12 PM", () => {
    expect(formatTime("12:00")).toBe("12:00 PM");
  });

  it("formats midnight as 12 AM", () => {
    expect(formatTime("00:00")).toBe("12:00 AM");
  });

  it("formats 1 PM", () => {
    expect(formatTime("13:00")).toBe("1:00 PM");
  });

  it("formats 11:59 AM", () => {
    expect(formatTime("11:59")).toBe("11:59 AM");
  });
});

describe("formatAge", () => {
  it("returns 'just now' for < 1 minute", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatAge(recent)).toBe("just now");
  });

  it("returns minutes for < 1 hour", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatAge(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours for < 24 hours", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatAge(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days for >= 24 hours", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
    expect(formatAge(twoDaysAgo)).toBe("2d ago");
  });

  it("boundary: 59 minutes returns minutes", () => {
    const ts = new Date(Date.now() - 59 * 60_000).toISOString();
    expect(formatAge(ts)).toBe("59m ago");
  });

  it("boundary: 60 minutes returns 1h", () => {
    const ts = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(formatAge(ts)).toBe("1h ago");
  });

  it("boundary: 23 hours returns hours", () => {
    const ts = new Date(Date.now() - 23 * 3_600_000).toISOString();
    expect(formatAge(ts)).toBe("23h ago");
  });

  it("boundary: 24 hours returns 1d", () => {
    const ts = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(formatAge(ts)).toBe("1d ago");
  });
});

describe("staleAge", () => {
  it("returns hours for < 24h", () => {
    const ts = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("2h old");
  });

  it("returns days for >= 24h", () => {
    const ts = new Date(Date.now() - 72 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("3d old");
  });

  it("returns 1h for data just past stale threshold (76 min)", () => {
    const ts = new Date(Date.now() - 76 * 60_000).toISOString();
    expect(staleAge(ts)).toBe("1h old");
  });

  it("boundary: 23h returns hours", () => {
    const ts = new Date(Date.now() - 23 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("23h old");
  });

  it("boundary: 24h returns 1d", () => {
    const ts = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(staleAge(ts)).toBe("1d old");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/format.test.ts`
Expected: FAIL — module `./format` not found

**Step 3: Write the implementation**

```typescript
// src/lib/format.ts
// ABOUTME: Shared time and date formatting utilities.
// ABOUTME: Used by tee-time-list, course-header, and other components.

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${m} ${ampm}`;
}

export function formatAge(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function staleAge(fetchedAt: string): string {
  const hours = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/format.test.ts`
Expected: All pass

**Step 5: Update components to use shared util**

In `src/components/tee-time-list.tsx`:
- Add: `import { formatTime, staleAge } from "@/lib/format";`
- Remove: the local `staleAge` function (lines 93-98: `function staleAge(fetchedAt: string)...`)
- Remove: the local `formatTime` function (lines 100-106: `function formatTime(time: string)...`)
- Keep `isStale` and `STALE_THRESHOLD_MS` where they are (still exported from this file)

In `src/components/course-header.tsx`:
- Add: `import { formatAge } from "@/lib/format";`
- Remove: the local `timeAgo` function (search for `function timeAgo(isoString: string)` near end of file)
- Change the call site: `timeAgo(displayTimestamp)` → `formatAge(displayTimestamp)` (search for `Last updated {timeAgo(`)

**Step 6: Run all tests and lint**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run lint`
Expected: No errors

**Step 7: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/components/tee-time-list.tsx src/components/course-header.tsx
git commit -m "refactor: extract shared time formatting utils with tests"
```

---

### Task 2: Export and test date-picker helpers

The date-picker has 5 pure helper functions that are unexported and untested: `toDateStr`, `fromDateStr`, `buildQuickDays`, `datesInRange`, `formatShortDate`.

**Files:**
- Modify: `src/components/date-picker.tsx` (export 5 helper functions)
- Create: `src/components/date-picker.test.ts`

**Step 1: Write the failing tests FIRST (before exporting)**

```typescript
// src/components/date-picker.test.ts
// ABOUTME: Tests for date-picker helper functions.
// ABOUTME: Covers date string conversion, range generation, and formatting.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toDateStr,
  fromDateStr,
  buildQuickDays,
  datesInRange,
  formatShortDate,
} from "./date-picker";

describe("toDateStr", () => {
  it("converts a Date to YYYY-MM-DD string", () => {
    // Use noon local to avoid UTC/local day mismatch
    const d = new Date(2026, 2, 15, 12, 0, 0); // March 15, noon local
    expect(toDateStr(d)).toBe("2026-03-15");
  });
});

describe("fromDateStr", () => {
  it("parses YYYY-MM-DD to a Date at local midnight", () => {
    const d = fromDateStr("2026-03-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed: March = 2
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});

describe("buildQuickDays", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 7 entries", () => {
    const days = buildQuickDays();
    expect(days).toHaveLength(7);
  });

  it("first entry is labeled 'Today'", () => {
    const days = buildQuickDays();
    expect(days[0].dayName).toBe("Today");
  });

  it("entries have sequential dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0)); // March 15

    const days = buildQuickDays();
    expect(days[0].value).toBe("2026-03-15");
    expect(days[1].value).toBe("2026-03-16");
    expect(days[6].value).toBe("2026-03-21");
  });
});

describe("datesInRange", () => {
  it("returns inclusive range", () => {
    const result = datesInRange("2026-03-10", "2026-03-12");
    expect(result).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("returns single date when start equals end", () => {
    const result = datesInRange("2026-03-10", "2026-03-10");
    expect(result).toEqual(["2026-03-10"]);
  });

  it("returns empty array when start > end", () => {
    const result = datesInRange("2026-03-12", "2026-03-10");
    expect(result).toEqual([]);
  });

  it("handles month boundary", () => {
    const result = datesInRange("2026-03-30", "2026-04-02");
    expect(result).toEqual([
      "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
    ]);
  });
});

describe("formatShortDate", () => {
  it("formats as short month + day", () => {
    const result = formatShortDate("2026-03-09");
    expect(result).toMatch(/Mar\s+9/);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/date-picker.test.ts`
Expected: FAIL — functions are not exported from `./date-picker`

**Step 3: Export the helpers to make tests pass**

In `src/components/date-picker.tsx`, change these 5 functions from private to exported:
- Line 12: `function toDateStr` → `export function toDateStr`
- Line 16: `function fromDateStr` → `export function fromDateStr`
- Line 20: `function buildQuickDays` → `export function buildQuickDays`
- Line 35: `function datesInRange` → `export function datesInRange`
- Line 46: `function formatShortDate` → `export function formatShortDate`

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/date-picker.test.ts`
Expected: All pass

**Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run lint`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/date-picker.tsx src/components/date-picker.test.ts
git commit -m "test: add date-picker helper tests and export pure functions"
```

---

### Task 3: Test favorites.ts

**Files:**
- Create: `src/lib/favorites.test.ts`

**Important context:** `getFavorites()` in `src/lib/favorites.ts` (line 4) checks `typeof window === "undefined"` and returns `[]` early if so. Vitest runs in Node where `window` is undefined by default. You MUST mock `window` on `globalThis` so the code reaches the `localStorage` logic. Without this, all tests pass for the wrong reason (always returning `[]` via the server-side guard).

**Step 1: Write the tests**

```typescript
// src/lib/favorites.test.ts
// ABOUTME: Tests for localStorage-based favorites management.
// ABOUTME: Covers get, set, toggle, and isFavorite with localStorage mock.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getFavorites, toggleFavorite, isFavorite } from "./favorites";

// Mock browser environment: vitest runs in Node where `window` is undefined.
// favorites.ts checks `typeof window === "undefined"` and bails early.
// We must define both `window` and `localStorage` on globalThis.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
  length: 0,
  key: vi.fn(() => null),
};

// Define window to pass the `typeof window === "undefined"` guard
Object.defineProperty(globalThis, "window", { value: globalThis, writable: true, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true, configurable: true });

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("getFavorites", () => {
  it("returns empty array when nothing stored", () => {
    expect(getFavorites()).toEqual([]);
  });

  it("returns parsed array from localStorage", () => {
    store["tct-favorites"] = JSON.stringify(["course-a", "course-b"]);
    expect(getFavorites()).toEqual(["course-a", "course-b"]);
  });

  it("returns empty array on malformed JSON", () => {
    store["tct-favorites"] = "not-json";
    expect(getFavorites()).toEqual([]);
  });
});

describe("toggleFavorite", () => {
  it("adds a course when not favorited", () => {
    toggleFavorite("course-a");
    expect(getFavorites()).toContain("course-a");
  });

  it("removes a course when already favorited", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    toggleFavorite("course-a");
    expect(getFavorites()).not.toContain("course-a");
  });
});

describe("isFavorite", () => {
  it("returns true for favorited course", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    expect(isFavorite("course-a")).toBe(true);
  });

  it("returns false for non-favorited course", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    expect(isFavorite("course-b")).toBe(false);
  });
});
```

**Step 2: Run tests**

Run: `npm test -- src/lib/favorites.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/lib/favorites.test.ts
git commit -m "test: add favorites localStorage tests"
```

---

### Task 4: Test adapter registry

**Files:**
- Create: `src/adapters/index.test.ts`

**Step 1: Write the tests**

```typescript
// src/adapters/index.test.ts
// ABOUTME: Tests for the platform adapter registry.
// ABOUTME: Verifies known platforms return adapters and unknown returns undefined.

import { describe, it, expect } from "vitest";
import { getAdapter } from "./index";

describe("getAdapter", () => {
  it("returns CPS Golf adapter for 'cps_golf'", () => {
    const adapter = getAdapter("cps_golf");
    expect(adapter).toBeDefined();
    expect(adapter!.platformId).toBe("cps_golf");
  });

  it("returns ForeUp adapter for 'foreup'", () => {
    const adapter = getAdapter("foreup");
    expect(adapter).toBeDefined();
    expect(adapter!.platformId).toBe("foreup");
  });

  it("returns undefined for unknown platform", () => {
    expect(getAdapter("unknown")).toBeUndefined();
  });
});
```

**Step 2: Run tests**

Run: `npm test -- src/adapters/index.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/adapters/index.test.ts
git commit -m "test: add adapter registry tests"
```

---

## Batch 2: Adapter & Poller Edge Cases

### Task 5: ForeUp adapter edge case tests and NaN price fix

The existing ForeUp tests don't cover non-200 responses or non-numeric `green_fee` values. The `green_fee` field is typed as `string | null` in the adapter's interface, so a value like `"free"` would pass through `parseFloat()` and produce `NaN`, which would display as "$NaN" in the UI.

**Files:**
- Modify: `src/adapters/foreup.test.ts` (add tests inside the existing `describe("ForeUpAdapter", ...)` block)
- Modify: `src/adapters/foreup.ts` (fix NaN price bug)

**Step 1: Add missing test cases inside the existing `describe("ForeUpAdapter", ...)` block**

Add these tests after the existing `it("handles null green_fee", ...)` test (around line 99):

```typescript
  it("returns empty array on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result).toEqual([]);
  });

  it("returns null price for non-numeric green_fee", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{
        time: "2026-03-15 08:00",
        green_fee: "free",
        holes: 18,
        available_spots: 4,
        schedule_id: 7829,
      }]), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result[0].price).toBeNull();
  });
```

**Step 2: Run tests — the NaN test will FAIL**

Run: `npm test -- src/adapters/foreup.test.ts`
Expected: The non-200 test passes. The non-numeric green_fee test FAILS — `parseFloat("free")` returns `NaN`, not `null`.

**Step 3: Fix the NaN price bug in foreup.ts**

In `src/adapters/foreup.ts` line 49, change the price mapping:

```typescript
// Current (line 49):
price: tt.green_fee !== null ? parseFloat(tt.green_fee) : null,

// Replace with:
price: tt.green_fee !== null && !Number.isNaN(parseFloat(tt.green_fee))
  ? parseFloat(tt.green_fee)
  : null,
```

**Step 4: Run all tests**

Run: `npm test`
Expected: All pass (including the new NaN test)

Run: `npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/adapters/foreup.test.ts src/adapters/foreup.ts
git commit -m "test: add ForeUp edge cases, fix NaN price for non-numeric green_fee"
```

---

### Task 6: Poller edge case tests

**Files:**
- Modify: `src/lib/poller.test.ts`

**Context:** The existing `poller.test.ts` already has `vi.mock("@/adapters", ...)` and `vi.mock("@/lib/db", ...)` at the top, with `getAdapter` and `logPoll` imported and mockable via `vi.mocked()`. The `mockDb` and `mockCourse` fixtures are defined inside `describe("pollCourse", ...)`.

**Step 1: Add tests to EXISTING describe blocks**

Add the month boundary test inside the existing `describe("getPollingDates", ...)` block (after the existing test at line 47):

```typescript
  it("handles month boundary rollover", () => {
    const dates = getPollingDates("2026-03-28");
    expect(dates).toEqual([
      "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31",
      "2026-04-01", "2026-04-02", "2026-04-03",
    ]);
  });
```

Add the adapter-throws test inside the existing `describe("pollCourse", ...)` block (after the existing `"logs no_data"` test at line 133). Use the existing `mockDb`, `mockCourse`, `getAdapter`, and `logPoll` that are already in scope:

```typescript
  it("logs error when adapter throws", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockRejectedValue(new Error("API timeout")),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(logPoll).toHaveBeenCalledWith(
      mockDb,
      "braemar",
      "2026-04-15",
      "error",
      0,
      "API timeout"
    );
  });
```

**Step 2: Run tests**

Run: `npm test -- src/lib/poller.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/lib/poller.test.ts
git commit -m "test: add poller month boundary and adapter-throws edge case tests"
```

---

## Batch 3: UX Bug Fixes

### Task 7: ~~Fix mobile course header layout~~ — DONE (commit `20dfa6c`)

> **Already implemented.** Commit `20dfa6c` added `shrink-0` to button container, `inline-flex items-center` to both buttons, `gap-3` + `min-w-0` to top-level layout, and optimistic "Refreshing…" inline state. Skip this task.

---

### Task 8: Surface refresh failures to the client

The refresh endpoint always returns 200, even when `pollCourse` encounters errors. This is because `pollCourse` (poller.ts) has its own internal try/catch — it catches adapter errors, logs them to poll_log with status `"error"`, and returns normally without throwing. So the route handler always reaches `return NextResponse.json({ message: "Refreshed" })`.

The fix has three parts:
1. Make `pollCourse` return a status string so callers can detect failures (backward-compatible — the cron handler ignores the return value)
2. Check `pollCourse` result in the route handler and return 500 on error
3. Check HTTP response status in the CourseHeader so failures are logged

**Files:**
- Modify: `src/lib/poller.ts` (change `pollCourse` return type from `void` to status string)
- Modify: `src/app/api/courses/[id]/refresh/route.ts` (check pollCourse return value)
- Modify: `src/components/course-header.tsx` (check response status in handleRefresh)

**Step 1: Make pollCourse return a status string**

In `src/lib/poller.ts`, change the return type and add return values. Find the function signature and change it:

```typescript
// Find:
export async function pollCourse(
  db: D1Database,
  course: CourseRow,
  date: string
): Promise<void> {
// Change to:
export async function pollCourse(
  db: D1Database,
  course: CourseRow,
  date: string
): Promise<"success" | "no_data" | "error"> {
```

Then add return statements to each of the 4 code paths. Use content matching:

```typescript
// Path 1 — no adapter. Find:
    await logPoll(db, course.id, date, "error", 0, `No adapter for platform: ${course.platform}`);
    return;
// Change `return;` to:
    return "error";

// Path 2 — no_data. Find:
      await logPoll(db, course.id, date, "no_data", 0, undefined);
      return;
// Change `return;` to:
      return "no_data";

// Path 3 — success. Find:
    await logPoll(db, course.id, date, "success", teeTimes.length, undefined);
// Add after that line:
    return "success";

// Path 4 — catch. Find:
    await logPoll(db, course.id, date, "error", 0, message);
// Add after that line:
    return "error";
```

**Step 2: Check pollCourse result in refresh endpoint**

In `src/app/api/courses/[id]/refresh/route.ts`, find the bare `pollCourse` call and return at the end of the function (after the `checkRefreshAllowed` block), and replace them:

```typescript
// Find (at the end of the POST function, after the rateCheck block):
  await pollCourse(db, course, date);

  return NextResponse.json({ message: "Refreshed", courseId: id, date });

// Replace with:
  const result = await pollCourse(db, course, date);

  if (result === "error") {
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: "Refreshed", courseId: id, date, result });
```

**Step 3: Add response checking in CourseHeader**

In `src/components/course-header.tsx`, in the `handleRefresh` function, add response status checking. **Note:** Task 1 and commit `20dfa6c` both modified this file — match by content. The current code fires POSTs via `Promise.all` but ignores the responses. Replace the body of the try block:

```typescript
// Find the try block body in handleRefresh (the Promise.all and everything after it up to the finally):
      await Promise.all(
        dates.map((date) =>
          fetch(`/api/courses/${course.id}/refresh?date=${date}`, {
            method: "POST",
          })
        )
      );
      setLastRefreshedAt(new Date().toISOString());
      onRefreshed();
      setCoolingDown(true);
      cooldownTimer.current = setTimeout(() => setCoolingDown(false), 30_000);

// Replace with:
      const responses = await Promise.all(
        dates.map((date) =>
          fetch(`/api/courses/${course.id}/refresh?date=${date}`, {
            method: "POST",
          })
        )
      );
      // 429 = rate-limited (data is fresh), not a real failure
      const failed = responses.filter((r) => !r.ok && r.status !== 429);
      if (failed.length > 0) {
        console.error(`Refresh failed for ${failed.length}/${responses.length} dates`);
      }
      setLastRefreshedAt(new Date().toISOString());
      onRefreshed();
      setCoolingDown(true);
      cooldownTimer.current = setTimeout(() => setCoolingDown(false), 30_000);
```

**Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/lib/poller.ts src/app/api/courses/[id]/refresh/route.ts src/components/course-header.tsx
git commit -m "fix: surface pollCourse failures to client via status return and response checking"
```

---

## Batch 4: ~~Server-Side Rate Limiting~~ — DONE

### Task 9: ~~Add server-side rate limiting to refresh endpoint~~ — DONE (commit `20dfa6c`)

> **Already implemented.** Commit `20dfa6c` extracted rate limiting to `src/lib/rate-limit.ts` with:
> - Per-course 30s cooldown (any date) via `COURSE_COOLDOWN_SECONDS`
> - Global 20/min rate limit via `GLOBAL_MAX_PER_MINUTE`
> - `checkRefreshAllowed()` function returning discriminated union
> - Returns 429 (not 200) when rate limited
> - Tests in `src/lib/rate-limit.test.ts` covering all branches
>
> Skip this task.

---

## Batch 5: API Input Validation & Error Handling

### Task 10: Add input validation to tee-times route

**Files:**
- Modify: `src/app/api/tee-times/route.ts`

**Step 1: Add validation after param extraction, before query building**

In `src/app/api/tee-times/route.ts`, add these validation blocks AFTER the param extraction lines (`const courseIds = ...`, `const startTime = ...`, etc.) and BEFORE the query building (`let query = ...`):

```typescript
  // Validate startTime/endTime format (HH:MM)
  const timeRegex = /^\d{2}:\d{2}$/;
  if (startTime && !timeRegex.test(startTime)) {
    return NextResponse.json(
      { error: "Invalid startTime format (HH:MM)" },
      { status: 400 }
    );
  }
  if (endTime && !timeRegex.test(endTime)) {
    return NextResponse.json(
      { error: "Invalid endTime format (HH:MM)" },
      { status: 400 }
    );
  }

  // Validate minSlots is a positive integer
  if (minSlots && (Number.isNaN(parseInt(minSlots)) || parseInt(minSlots) < 1)) {
    return NextResponse.json(
      { error: "minSlots must be a positive integer" },
      { status: 400 }
    );
  }

  // Cap courses list to prevent unbounded IN clause
  if (courseIds && courseIds.length > 50) {
    return NextResponse.json(
      { error: "Too many course IDs (max 50)" },
      { status: 400 }
    );
  }
```

Then wrap the final DB query and return (the `const result = await db.prepare(query)...` and `return NextResponse.json(...)` at the end of the function) in a try/catch:

Find the DB query and return at the end of the function (after `query += " ORDER BY t.time ASC";`). Wrap them in a try/catch:

```typescript
// Find:
  query += " ORDER BY t.time ASC";

  const result = await db.prepare(query).bind(...bindings).all();

  return NextResponse.json({
    date,
    teeTimes: result.results,
  });

// Replace with:
  query += " ORDER BY t.time ASC";

  try {
    const result = await db.prepare(query).bind(...bindings).all();
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

**Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/api/tee-times/route.ts
git commit -m "fix: add input validation and error handling to tee-times route"
```

---

### Task 11: Add error handling to remaining API routes

**Files:**
- Modify: `src/app/api/courses/route.ts`
- Modify: `src/app/api/courses/[id]/route.ts`

**Step 1: Wrap `courses/route.ts` in try/catch**

In `src/app/api/courses/route.ts`, wrap the DB query and return inside a try/catch. Replace the entire GET function body with:

```typescript
export async function GET() {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  try {
    const result = await db
      .prepare(
        `SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
                p.polled_at as last_polled,
                p.status as last_poll_status
         FROM courses c
         LEFT JOIN (
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
         ) p ON c.id = p.course_id AND p.rn = 1
         ORDER BY c.name`
      )
      .all();

    return NextResponse.json({ courses: result.results });
  } catch (err) {
    console.error("courses list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Step 2: Wrap `courses/[id]/route.ts` in try/catch**

In `src/app/api/courses/[id]/route.ts`, wrap the DB query, 404 check, and return inside a try/catch. Replace the entire GET function body with:

```typescript
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { env } = await getCloudflareContext();
  const db = env.DB;

  try {
    const course = await db
      .prepare(
        `SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
                p.polled_at as last_polled,
                p.status as last_poll_status
         FROM courses c
         LEFT JOIN (
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
         ) p ON c.id = p.course_id AND p.rn = 1
         WHERE c.id = ?`
      )
      .bind(id)
      .first();

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    return NextResponse.json({ course });
  } catch (err) {
    console.error("course detail error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/app/api/courses/route.ts src/app/api/courses/[id]/route.ts
git commit -m "fix: add error handling to courses API routes"
```

---

## Batch 6: Remaining Test Coverage

### Task 12: Add CPS Golf edge case tests

**Files:**
- Modify: `src/adapters/cps-golf.test.ts` (add tests inside the existing `describe("CpsGolfAdapter", ...)` block)

**Step 1: Add missing tests inside the existing `describe("CpsGolfAdapter", ...)` block**

Add these tests after the existing `"skips courses with missing apiKey"` test (around line 105):

```typescript
  it("handles null TeeTimes array from API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ TeeTimes: null }), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result).toEqual([]);
  });

  it("handles null GreenFee as null price", async () => {
    const teeTimeWithNullFee = {
      TeeTimeId: 100,
      TeeDateTime: "2026-03-15T10:00:00",
      GreenFee: null,
      NumberOfOpenSlots: 4,
      Holes: 18,
      CourseId: 17,
      CourseName: "Theodore Wirth",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ TeeTimes: [teeTimeWithNullFee] }), { status: 200 })
    );

    const result = await adapter.fetchTeeTimes(mockConfig, "2026-03-15");
    expect(result).toHaveLength(1);
    expect(result[0].price).toBeNull();
  });
```

**Step 2: Run tests**

Run: `npm test -- src/adapters/cps-golf.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add src/adapters/cps-golf.test.ts
git commit -m "test: add CPS Golf null TeeTimes and GreenFee edge cases"
```

---

### Task 13: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors

**Step 4: Run build**

Run: `npx @opennextjs/cloudflare build`
Expected: Build succeeds

**Step 5: Update coverage report**

Append a "## Remediation Summary" section to `dev/test-coverage-reports/2026-03-09-full-coverage-review.md` documenting what was fixed, tests added, and bugs found.

**Step 6: Final commit and PR**

```bash
git add dev/test-coverage-reports/
git commit -m "docs: update coverage report with remediation summary"
```

Then push and create PR.

---

## Summary of Changes

| Batch | Tasks | Focus | Parallelizable? |
|-------|-------|-------|-----------------|
| 1 | Tasks 1-4 | Extract shared utils, export + test pure functions | Yes, all 4 |
| 2 | Tasks 5-6 | Adapter & poller edge cases | Yes, both |
| 3 | Task 8 only | Refresh error handling (Task 7 done in `20dfa6c`) | N/A — single task |
| 4 | ~~Task 9~~ | ~~Rate limiting~~ — DONE in `20dfa6c` | Skip |
| 5 | Tasks 10-11 | API input validation & error handling | Yes, both |
| 6 | Tasks 12-13 | Remaining test coverage, final verification | No — sequential |

**Not in scope (deferred):**
- React component render tests (would require jsdom/testing-library setup)
- `runCronPoll` integration tests (requires D1 mock, complex setup)
- `toDateStr` timezone bug (needs architectural decision on UTC vs local)
- API route integration tests (need D1 test harness)
