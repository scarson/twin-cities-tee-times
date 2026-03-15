# Batched Cron Polling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split cron polling across 5 staggered invocations to stay within Cloudflare Workers free plan's 50 external subrequest limit.

**Architecture:** 5 cron triggers fire 1 minute apart within each 5-minute window. Each invocation queries all courses, assigns them to batches via weighted bin-packing (CPS=3, others=1), and processes only its batch. A subrequest budget tracker prevents exceeding 50 per invocation. Date-outer loop ordering ensures today is polled for all courses before tomorrow.

**Tech Stack:** Cloudflare Workers cron triggers, D1, existing adapter/poller infrastructure.

**Design doc:** `docs/plans/2026-03-15-cron-batching-design.md`

---

### Task 1: Add batch assignment utility with tests

**Files:**
- Create: `src/lib/batch.ts`
- Create: `src/lib/batch.test.ts`

**Step 1: Write failing tests**

Write `src/lib/batch.test.ts`:

```typescript
// ABOUTME: Tests for cron batch assignment via weighted bin-packing.
// ABOUTME: Covers even distribution, CPS weighting, determinism, and edge cases.
import { describe, it, expect } from "vitest";
import { assignBatches, BATCH_COUNT, platformWeight } from "./batch";
import type { CourseRow } from "@/types";

function makeCourse(id: string, platform: string): CourseRow {
  return {
    id,
    name: id,
    city: "Test",
    platform,
    platform_config: "{}",
    booking_url: "https://example.com",
    is_active: 1,
    last_had_tee_times: null,
  };
}

describe("platformWeight", () => {
  it("returns 3 for cps_golf", () => {
    expect(platformWeight("cps_golf")).toBe(3);
  });

  it("returns 1 for other platforms", () => {
    expect(platformWeight("foreup")).toBe(1);
    expect(platformWeight("teeitup")).toBe(1);
    expect(platformWeight("chronogolf")).toBe(1);
  });
});

describe("assignBatches", () => {
  it("distributes courses across all batches", () => {
    const courses = Array.from({ length: 10 }, (_, i) =>
      makeCourse(`course-${String(i).padStart(2, "0")}`, "foreup")
    );
    const result = assignBatches(courses);

    expect(result).toHaveLength(BATCH_COUNT);
    const allIds = result.flat().map((c) => c.id);
    expect(allIds).toHaveLength(10);
  });

  it("balances CPS courses (weight 3) across batches", () => {
    const courses = [
      makeCourse("cps-a", "cps_golf"),
      makeCourse("cps-b", "cps_golf"),
      makeCourse("cps-c", "cps_golf"),
      makeCourse("cps-d", "cps_golf"),
      makeCourse("cps-e", "cps_golf"),
    ];
    const result = assignBatches(courses);

    // 5 CPS courses with weight 3 each → one per batch
    for (let i = 0; i < BATCH_COUNT; i++) {
      expect(result[i]).toHaveLength(1);
    }
  });

  it("assigns heavier platforms to lighter batches", () => {
    const courses = [
      makeCourse("a-foreup", "foreup"),     // weight 1
      makeCourse("b-foreup", "foreup"),     // weight 1
      makeCourse("c-cps", "cps_golf"),      // weight 3
    ];
    const result = assignBatches(courses);

    // After sorting by ID: a-foreup, b-foreup, c-cps
    // a-foreup → batch 0 (weight 0), b-foreup → batch 1 (weight 0),
    // c-cps → batch 2 (weight 0) — all equal, ties broken by lowest index
    // BUT: greedy picks lightest, then lowest index on tie
    // So: a-foreup→0(w=1), b-foreup→1(w=1), c-cps→2(w=3)
    // Total weights: [1, 1, 3, 0, 0]
    // Verify no batch exceeds total_weight/BATCH_COUNT + max_single_weight
    const totalWeight = 5;
    const maxBatchWeight = Math.max(
      ...result.map((batch) =>
        batch.reduce((sum, c) => sum + platformWeight(c.platform), 0)
      )
    );
    expect(maxBatchWeight).toBeLessThanOrEqual(
      Math.ceil(totalWeight / BATCH_COUNT) + 3
    );
  });

  it("is deterministic — same input gives same output", () => {
    const courses = [
      makeCourse("z-course", "foreup"),
      makeCourse("a-course", "cps_golf"),
      makeCourse("m-course", "teeitup"),
    ];
    const result1 = assignBatches(courses);
    const result2 = assignBatches(courses);

    for (let i = 0; i < BATCH_COUNT; i++) {
      expect(result1[i].map((c) => c.id)).toEqual(
        result2[i].map((c) => c.id)
      );
    }
  });

  it("handles empty course list", () => {
    const result = assignBatches([]);
    expect(result).toHaveLength(BATCH_COUNT);
    for (const batch of result) {
      expect(batch).toHaveLength(0);
    }
  });

  it("handles fewer courses than batches", () => {
    const courses = [makeCourse("only-one", "foreup")];
    const result = assignBatches(courses);

    const nonEmpty = result.filter((b) => b.length > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0][0].id).toBe("only-one");
  });

  it("breaks ties by lowest batch index", () => {
    // Single course should always go to batch 0
    const courses = [makeCourse("solo", "foreup")];
    const result = assignBatches(courses);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0].id).toBe("solo");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/batch.test.ts`
Expected: FAIL — module `./batch` not found

**Step 3: Write the implementation**

Write `src/lib/batch.ts`:

```typescript
// ABOUTME: Weighted bin-packing for distributing courses across cron batches.
// ABOUTME: Balances subrequest cost (CPS=3, others=1) across 5 batches.
import type { CourseRow } from "@/types";

export const BATCH_COUNT = 5;

/**
 * Subrequest weight per platform. CPS Golf requires 3 external fetches
 * per date (token + register + tee times). All others require 1.
 */
export function platformWeight(platform: string): number {
  return platform === "cps_golf" ? 3 : 1;
}

/**
 * Distribute courses across BATCH_COUNT batches using greedy bin-packing
 * by platform weight. Courses are sorted by ID for determinism, then each
 * is assigned to the batch with the lowest total weight (ties broken by
 * lowest batch index).
 */
export function assignBatches(courses: CourseRow[]): CourseRow[][] {
  const batches: CourseRow[][] = Array.from({ length: BATCH_COUNT }, () => []);
  const weights = new Array(BATCH_COUNT).fill(0);

  const sorted = [...courses].sort((a, b) => a.id.localeCompare(b.id));

  for (const course of sorted) {
    // Find batch with minimum weight (lowest index breaks ties)
    let minIdx = 0;
    for (let i = 1; i < BATCH_COUNT; i++) {
      if (weights[i] < weights[minIdx]) {
        minIdx = i;
      }
    }
    batches[minIdx].push(course);
    weights[minIdx] += platformWeight(course.platform);
  }

  return batches;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/batch.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/lib/batch.ts src/lib/batch.test.ts
git commit -m "feat: add weighted batch assignment for cron polling"
```

---

### Task 2: Add cron-to-batch mapping with tests

**Files:**
- Modify: `src/lib/batch.ts`
- Modify: `src/lib/batch.test.ts`

**Step 1: Write failing tests**

Append to the test file, inside a new `describe` block after the existing ones:

```typescript
describe("cronToBatchIndex", () => {
  it("maps */5 to batch 0", () => {
    expect(cronToBatchIndex("*/5 * * * *")).toBe(0);
  });

  it("maps staggered crons to batches 1-4", () => {
    expect(cronToBatchIndex("1-56/5 * * * *")).toBe(1);
    expect(cronToBatchIndex("2-57/5 * * * *")).toBe(2);
    expect(cronToBatchIndex("3-58/5 * * * *")).toBe(3);
    expect(cronToBatchIndex("4-59/5 * * * *")).toBe(4);
  });

  it("throws on unknown cron expression", () => {
    expect(() => cronToBatchIndex("0 * * * *")).toThrow(
      "Unknown cron expression"
    );
  });
});
```

Add `cronToBatchIndex` to the import at the top of the test file:

```typescript
import { assignBatches, BATCH_COUNT, platformWeight, cronToBatchIndex } from "./batch";
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/batch.test.ts`
Expected: FAIL — `cronToBatchIndex` is not exported

**Step 3: Write the implementation**

Add to the bottom of `src/lib/batch.ts`:

```typescript
const CRON_TO_BATCH: Record<string, number> = {
  "*/5 * * * *": 0,
  "1-56/5 * * * *": 1,
  "2-57/5 * * * *": 2,
  "3-58/5 * * * *": 3,
  "4-59/5 * * * *": 4,
};

/**
 * Map a cron expression string (from event.cron) to a batch index.
 */
export function cronToBatchIndex(cron: string): number {
  const index = CRON_TO_BATCH[cron];
  if (index === undefined) {
    throw new Error(`Unknown cron expression: ${cron}`);
  }
  return index;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/batch.test.ts`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add src/lib/batch.ts src/lib/batch.test.ts
git commit -m "feat: add cron expression to batch index mapping"
```

---

### Task 3: Update wrangler.jsonc with 5 staggered cron triggers

**Files:**
- Modify: `wrangler.jsonc`

**Step 1: Update the crons array**

In `wrangler.jsonc`, change:

```jsonc
	"triggers": {
		"crons": [
			"*/5 * * * *"
		]
	},
```

to:

```jsonc
	"triggers": {
		"crons": [
			"*/5 * * * *",
			"1-56/5 * * * *",
			"2-57/5 * * * *",
			"3-58/5 * * * *",
			"4-59/5 * * * *"
		]
	},
```

**Step 2: Verify no syntax issues**

Run: `npx tsc --noEmit`
Expected: No errors (wrangler.jsonc isn't type-checked, but ensures nothing else broke)

**Step 3: Commit**

```bash
git add wrangler.jsonc
git commit -m "feat: add 5 staggered cron triggers for batch polling"
```

---

### Task 4: Pass cron expression from worker.ts to runCronPoll

**Files:**
- Modify: `worker.ts`

**Step 1: Update the scheduled handler**

Change:

```typescript
  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(runCronPoll(env));
  },
```

to:

```typescript
  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(runCronPoll(env, event.cron));
  },
```

**Step 2: Verify no syntax issues**

Run: `npx tsc --noEmit`
Expected: May warn about signature mismatch (runCronPoll doesn't accept cron yet). That's expected — Task 5 fixes it.

**Step 3: Commit**

```bash
git add worker.ts
git commit -m "refactor: pass event.cron to runCronPoll for batch selection"
```

---

### Task 5: Rewrite cron-handler with batch support — failing tests first

This is the core task. The cron handler changes significantly:
- New signature: `runCronPoll(env, cronExpression)`
- Batch filtering via `assignBatches` + `cronToBatchIndex`
- Loop reorder: date-outer, course-inner
- Subrequest budget tracking
- Housekeeping gated to batch 0 only
- Return type adds `batchIndex` and `budgetExhausted`

**Files:**
- Modify: `src/lib/cron-handler.test.ts`
- Modify: `src/lib/cron-handler.ts`

**Step 1: Write failing tests for batch behavior**

Replace the entire contents of `src/lib/cron-handler.test.ts` with:

```typescript
// ABOUTME: Tests for the cron handler's batched polling, budget tracking, and cleanup.
// ABOUTME: Covers batch filtering, date-outer loop, budget exhaustion, and housekeeping gating.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldRunThisCycle, runCronPoll } from "./cron-handler";
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
import { sqliteIsoNow } from "@/lib/db";
import { BATCH_COUNT } from "@/lib/batch";

describe("shouldRunThisCycle", () => {
  function makeDate(centralHour: number, minute: number): Date {
    // Create a Date that, when formatted in America/Chicago, shows the given hour
    // April 15 2026 is during CDT (UTC-5)
    const d = new Date(
      `2026-04-15T${String(centralHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-05:00`
    );
    return d;
  }

  it("runs every invocation during 5am-10am CT", () => {
    expect(shouldRunThisCycle(makeDate(5, 0))).toBe(true);
    expect(shouldRunThisCycle(makeDate(7, 33))).toBe(true);
    expect(shouldRunThisCycle(makeDate(9, 55))).toBe(true);
  });

  it("runs every 10 min during 10am-2pm CT", () => {
    expect(shouldRunThisCycle(makeDate(10, 0))).toBe(true); // 0 % 10 < 5
    expect(shouldRunThisCycle(makeDate(11, 5))).toBe(false); // 5 % 10 = 5, not < 5
    expect(shouldRunThisCycle(makeDate(13, 20))).toBe(true); // 20 % 10 = 0 < 5
  });

  it("runs every 15 min during 2pm-8pm CT", () => {
    expect(shouldRunThisCycle(makeDate(14, 0))).toBe(true); // 0 % 15 < 5
    expect(shouldRunThisCycle(makeDate(15, 10))).toBe(false); // 10 % 15 = 10
    expect(shouldRunThisCycle(makeDate(19, 30))).toBe(true); // 30 % 15 = 0 < 5
  });

  it("runs once per hour during 8pm-5am CT", () => {
    expect(shouldRunThisCycle(makeDate(22, 0))).toBe(true); // 0 < 5
    expect(shouldRunThisCycle(makeDate(22, 5))).toBe(false); // 5 not < 5
    expect(shouldRunThisCycle(makeDate(3, 15))).toBe(false); // 15 not < 5
  });
});

// Mock poller to isolate cron handler logic
vi.mock("@/lib/poller", () => ({
  pollCourse: vi.fn(),
  shouldPollDate: vi.fn().mockReturnValue(false),
  getPollingDates: vi.fn().mockReturnValue(["2026-04-15"]),
}));

const mockedPollCourse = vi.mocked(pollCourse);
const mockedShouldPollDate = vi.mocked(shouldPollDate);
const mockedGetPollingDates = vi.mocked(getPollingDates);

// Default cron expression for batch 0
const BATCH_0_CRON = "*/5 * * * *";
const BATCH_1_CRON = "1-56/5 * * * *";

describe("runCronPoll batch filtering", () => {
  const preparedStatements: string[] = [];

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
    preparedStatements.length = 0;

    return {
      prepare: vi.fn().mockImplementation((sql: string) => {
        preparedStatements.push(sql);
        return {
          bind: vi.fn().mockImplementation(() => ({
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
            all: vi.fn().mockResolvedValue({ results: [] }),
          })),
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("only polls courses assigned to this batch", async () => {
    // Create enough courses that they span multiple batches
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) => ({
      id: `course-${String(i).padStart(2, "0")}`,
      is_active: 1,
      last_had_tee_times: null,
      platform: "foreup",
      platform_config: "{}",
      booking_url: "https://example.com",
      name: `Course ${i}`,
      city: "Test",
    }));

    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // 10 courses / 5 batches = 2 per batch, 2 dates each = 4 polls
    expect(result.pollCount).toBe(4);
    expect(result.courseCount).toBeLessThan(courses.length);
  });

  it("returns batchIndex in results", async () => {
    const db = makeMockDb([]);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );
    expect(result.batchIndex).toBe(0);
  });

  it("assigns different courses to different batches", async () => {
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) => ({
      id: `course-${String(i).padStart(2, "0")}`,
      is_active: 1,
      last_had_tee_times: null,
      platform: "foreup",
      platform_config: "{}",
      booking_url: "https://example.com",
      name: `Course ${i}`,
      city: "Test",
    }));

    const db0 = makeMockDb(courses);
    const db1 = makeMockDb(courses);
    await runCronPoll({ DB: db0 } as unknown as CloudflareEnv, BATCH_0_CRON);
    const batch0Courses = mockedPollCourse.mock.calls.map((c) => c[1].id);

    vi.clearAllMocks();
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);

    await runCronPoll({ DB: db1 } as unknown as CloudflareEnv, BATCH_1_CRON);
    const batch1Courses = mockedPollCourse.mock.calls.map((c) => c[1].id);

    // No overlap between the two batches
    const batch0Unique = [...new Set(batch0Courses)];
    const batch1Unique = [...new Set(batch1Courses)];
    for (const id of batch0Unique) {
      expect(batch1Unique).not.toContain(id);
    }
  });
});

describe("runCronPoll date-outer loop ordering", () => {
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
    }>
  ) => ({
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls today for all courses before moving to tomorrow", async () => {
    // Two courses that will be in batch 0
    // Use IDs that bin-packing assigns to batch 0
    const courses = [
      {
        id: "aaa-first",
        is_active: 1,
        last_had_tee_times: null,
        platform: "foreup",
        platform_config: "{}",
        booking_url: "https://example.com",
        name: "First",
        city: "Test",
      },
      {
        id: "aab-second",
        is_active: 1,
        last_had_tee_times: null,
        platform: "foreup",
        platform_config: "{}",
        booking_url: "https://example.com",
        name: "Second",
        city: "Test",
      },
    ];

    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    // With date-outer ordering, expect:
    // call 0: course A, date today
    // call 1: course B, date today
    // call 2: course A, date tomorrow
    // call 3: course B, date tomorrow
    const calls = mockedPollCourse.mock.calls;

    // All today calls come before all tomorrow calls
    const todayCalls = calls.filter((c) => c[2] === "2026-04-15");
    const tomorrowCalls = calls.filter((c) => c[2] === "2026-04-16");

    if (todayCalls.length > 0 && tomorrowCalls.length > 0) {
      const lastTodayIndex = calls.findLastIndex((c) => c[2] === "2026-04-15");
      const firstTomorrowIndex = calls.findIndex((c) => c[2] === "2026-04-16");
      expect(lastTodayIndex).toBeLessThan(firstTomorrowIndex);
    }
  });
});

describe("runCronPoll budget tracking", () => {
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
    }>
  ) => ({
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling when budget is exhausted", async () => {
    // Create many CPS courses (weight 3 each) to exhaust the budget
    // All will be assigned across batches, so we need enough that one batch is heavy
    const courses = Array.from({ length: 50 }, (_, i) => ({
      id: `cps-${String(i).padStart(2, "0")}`,
      is_active: 1,
      last_had_tee_times: null,
      platform: "cps_golf",
      platform_config: "{}",
      booking_url: "https://example.com",
      name: `CPS ${i}`,
      city: "Test",
    }));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // Budget is 45. Each CPS poll costs 3. 50 courses / 5 batches = 10 per batch.
    // 10 courses × 3 weight × 2 dates = 60, which exceeds 45.
    // So some polls should have been skipped.
    expect(result.budgetExhausted).toBe(true);
    // Should have polled fewer than 10 courses × 2 dates = 20
    expect(mockedPollCourse).toHaveBeenCalledTimes(result.pollCount);
    expect(result.pollCount).toBeLessThan(20);

    consoleSpy.mockRestore();
  });

  it("does not exhaust budget with lightweight courses", async () => {
    const courses = Array.from({ length: 10 }, (_, i) => ({
      id: `foreup-${String(i).padStart(2, "0")}`,
      is_active: 1,
      last_had_tee_times: null,
      platform: "foreup",
      platform_config: "{}",
      booking_url: "https://example.com",
      name: `ForeUp ${i}`,
      city: "Test",
    }));

    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // 10 courses / 5 batches = 2, weight 1 × 2 dates = 4. Well under 45.
    expect(result.budgetExhausted).toBe(false);
  });
});

describe("runCronPoll housekeeping", () => {
  const preparedStatements: string[] = [];

  const makeMockDb = () => {
    preparedStatements.length = 0;

    return {
      prepare: vi.fn().mockImplementation((sql: string) => {
        preparedStatements.push(sql);
        return {
          bind: vi.fn().mockImplementation(() => ({
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
            all: vi.fn().mockResolvedValue({ results: [] }),
          })),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        };
      }),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(false);
    mockedGetPollingDates.mockReturnValue(["2026-04-15"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs cleanup tasks in batch 0", async () => {
    const db = makeMockDb();
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    const sessionCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM sessions")
    );
    const pollLogCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM poll_log")
    );
    const deactivation = preparedStatements.find((sql) =>
      sql.includes("is_active = 0") && sql.includes("-30 days")
    );

    expect(sessionCleanup).toBeDefined();
    expect(pollLogCleanup).toBeDefined();
    expect(deactivation).toBeDefined();
  });

  it("skips cleanup tasks in non-zero batches", async () => {
    const db = makeMockDb();
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_1_CRON);

    const sessionCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM sessions")
    );
    const pollLogCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM poll_log") && sql.includes("-7 days")
    );
    const deactivation = preparedStatements.find((sql) =>
      sql.includes("is_active = 0") && sql.includes("-30 days")
    );

    expect(sessionCleanup).toBeUndefined();
    expect(pollLogCleanup).toBeUndefined();
    expect(deactivation).toBeUndefined();
  });
});

describe("runCronPoll active/inactive polling", () => {
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
  ) => ({
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      all: vi.fn().mockResolvedValue({
        results: sql.includes("FROM courses")
          ? courses
          : sql.includes("poll_log")
            ? pollLog
            : [],
      }),
    })),
  });

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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
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
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    expect(mockedPollCourse).toHaveBeenCalledTimes(2);
    const dates = mockedPollCourse.mock.calls.map((c) => c[2]);
    expect(dates).toContain("2026-04-15");
    expect(dates).toContain("2026-04-16");
  });

  it("promotes inactive course to active when tee times found", async () => {
    mockedPollCourse.mockResolvedValue("success");
    const db = makeMockDb([inactiveCourse]);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auto-activated")
    );
    consoleSpy.mockRestore();
  });

  it("does not probe inactive courses if polled less than 1 hour ago", async () => {
    const recentPoll = new Date("2026-04-15T06:30:00-05:00").toISOString();
    const db = makeMockDb(
      [inactiveCourse],
      [{ course_id: "test-inactive", date: "2026-04-15", last_polled: recentPoll }]
    );

    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });

  it("continues polling after one course throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedShouldPollDate.mockImplementation((offset: number) => offset === 0);

    const active2 = { ...activeCourse, id: "test-active-2", name: "Active 2" };
    let callCount = 0;
    mockedPollCourse.mockImplementation(async (_db, course) => {
      callCount++;
      if (course.id === "test-active") throw new Error("adapter crash");
      return "no_data";
    });

    const db = makeMockDb([activeCourse, active2]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    // Both courses should have been attempted for today
    expect(callCount).toBe(2);
    consoleSpy.mockRestore();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: FAIL — `runCronPoll` signature mismatch (doesn't accept cron param), no `batchIndex`/`budgetExhausted` in return type

**Step 3: Rewrite the cron handler**

Replace the entire contents of `src/lib/cron-handler.ts` with:

```typescript
// ABOUTME: Cron polling orchestrator that distributes courses across 5 batched invocations.
// ABOUTME: Uses weighted bin-packing, date-priority loop ordering, and subrequest budget tracking.
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
import { sqliteIsoNow, logPoll } from "@/lib/db";
import { assignBatches, cronToBatchIndex, platformWeight } from "@/lib/batch";
import type { CourseRow } from "@/types";

const SUBREQUEST_BUDGET = 45; // 50 limit minus 5 headroom

/**
 * Determine whether this cron invocation should actually poll,
 * based on current Central Time hour.
 *
 * Each batch fires every 5 min (staggered by 1 min). Effective intervals:
 * - 5am–10am CT: every 5 min (every invocation)
 * - 10am–2pm CT: every 10 min
 * - 2pm–8pm CT: every 15 min
 * - 8pm–5am CT: every 60 min
 */
export function shouldRunThisCycle(now: Date): boolean {
  const centralHour = parseInt(
    now.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    })
  );
  const minute = now.getMinutes();

  if (centralHour >= 5 && centralHour < 10) return true;
  if (centralHour >= 10 && centralHour < 14) return minute % 10 < 5;
  if (centralHour >= 14 && centralHour < 20) return minute % 15 < 5;
  return minute < 5; // 8pm–5am: once per hour
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main cron polling logic. Called by the Worker's scheduled() handler.
 *
 * Each invocation processes one batch of courses (determined by cronExpression).
 * Courses are assigned to batches via weighted bin-packing (CPS=3, others=1).
 * Loop order is date-outer, course-inner to prioritize today for all courses.
 * A subrequest budget tracker prevents exceeding the 50-per-invocation limit.
 *
 * Housekeeping (cleanup, auto-deactivation) runs only in batch 0.
 */
export async function runCronPoll(
  env: CloudflareEnv,
  cronExpression: string
): Promise<{
  pollCount: number;
  courseCount: number;
  inactiveProbeCount: number;
  skipped: boolean;
  batchIndex: number;
  budgetExhausted: boolean;
}> {
  const batchIndex = cronToBatchIndex(cronExpression);
  const now = new Date();

  if (!shouldRunThisCycle(now)) {
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: true, batchIndex, budgetExhausted: false };
  }

  try {
    const db = env.DB;

    // Fetch ALL courses and assign to batches
    const coursesResult = await db
      .prepare("SELECT * FROM courses")
      .all<CourseRow>();
    const allCourses = coursesResult.results;
    const batches = assignBatches(allCourses);
    const batchCourses = batches[batchIndex];

    const activeCourses = batchCourses.filter((c) => c.is_active === 1);
    const inactiveCourses = batchCourses.filter((c) => c.is_active === 0);

    const todayStr = now.toLocaleDateString("en-CA", {
      timeZone: "America/Chicago",
    }); // YYYY-MM-DD
    const dates = getPollingDates(todayStr);

    // Batch-fetch the most recent poll time for every course+date combo
    const recentPolls = await db
      .prepare(
        `SELECT course_id, date, MAX(polled_at) as last_polled
         FROM poll_log
         WHERE polled_at > ${sqliteIsoNow("-24 hours")}
         GROUP BY course_id, date`
      )
      .all<{ course_id: string; date: string; last_polled: string }>();

    const pollTimeMap = new Map<string, string>();
    for (const row of recentPolls.results) {
      pollTimeMap.set(`${row.course_id}:${row.date}`, row.last_polled);
    }

    let pollCount = 0;
    let inactiveProbeCount = 0;
    let budget = SUBREQUEST_BUDGET;
    let budgetExhausted = false;

    // --- Active courses: date-outer, course-inner ---
    for (let i = 0; i < dates.length && !budgetExhausted; i++) {
      for (const course of activeCourses) {
        const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
        const minutesSinceLast = lastPolled
          ? (Date.now() - new Date(lastPolled).getTime()) / 60000
          : Infinity;

        if (!shouldPollDate(i, minutesSinceLast)) continue;

        const weight = platformWeight(course.platform);
        if (budget < weight) {
          budgetExhausted = true;
          console.warn(
            `Batch ${batchIndex}: subrequest budget exhausted (${SUBREQUEST_BUDGET - budget}/${SUBREQUEST_BUDGET} used), skipping remaining polls`
          );
          break;
        }

        try {
          const status = await pollCourse(db, course, dates[i], env);
          pollCount++;
          budget -= weight;

          if (status === "success") {
            await db
              .prepare("UPDATE courses SET last_had_tee_times = ? WHERE id = ?")
              .bind(now.toISOString(), course.id)
              .run();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error polling ${course.id} for ${dates[i]}:`, err);
          try {
            await logPoll(db, course.id, dates[i], "error", 0, message);
          } catch (logErr) {
            console.error(`Failed to log poll error for ${course.id}:`, logErr);
          }
          pollCount++;
          budget -= weight;
        }

        await sleep(250);
      }
    }

    // --- Inactive courses: hourly probe of today + tomorrow ---
    const probeDates = dates.slice(0, 2);

    for (const course of inactiveCourses) {
      if (budgetExhausted) break;

      try {
        const lastProbed = pollTimeMap.get(`${course.id}:${probeDates[0]}`);
        const minutesSinceProbe = lastProbed
          ? (Date.now() - new Date(lastProbed).getTime()) / 60000
          : Infinity;

        if (minutesSinceProbe < 60) continue;

        let foundTeeTimes = false;

        for (const date of probeDates) {
          const weight = platformWeight(course.platform);
          if (budget < weight) {
            budgetExhausted = true;
            console.warn(
              `Batch ${batchIndex}: subrequest budget exhausted during inactive probing`
            );
            break;
          }

          const status = await pollCourse(db, course, date, env);
          inactiveProbeCount++;
          budget -= weight;

          if (status === "success") {
            foundTeeTimes = true;
          }

          await sleep(250);
        }

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

    return {
      pollCount,
      courseCount: activeCourses.length,
      inactiveProbeCount,
      skipped: false,
      batchIndex,
      budgetExhausted,
    };
  } catch (err) {
    console.error("Cron poll fatal error:", err);
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: false, batchIndex, budgetExhausted: false };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: All tests PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "feat: rewrite cron handler with batch support, budget tracking, and date-priority loop"
```

---

### Task 6: Verify full build and type-check

**Files:** None (verification only)

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors

---

### Task 7: Update ABOUTME comments in modified files

**Files:**
- Verify: `src/lib/cron-handler.ts` — already updated in Task 5
- Verify: `worker.ts` — existing ABOUTME is fine (still wraps OpenNext + cron)

No changes expected here — just verify the ABOUTME comments are accurate after the rewrite.

---

### Task 8: Final commit and push

**Step 1: Verify clean working tree**

Run: `git status`
Expected: Nothing to commit, working tree clean

**Step 2: Push**

```bash
git push
```
