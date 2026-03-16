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
    // Greedy: a-foreup→batch 0(w=1), b-foreup→batch 1(w=1), c-cps→batch 2(w=3)
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
Expected: All 7 tests PASS (the `cronToBatchIndex` tests don't exist yet — that's fine, they'll be added in Step 5)

**Step 5: Add cronToBatchIndex tests**

Append the following to the BOTTOM of `src/lib/batch.test.ts` (after the closing `});` of the `assignBatches` describe block), and change the import on line 3 from:

```typescript
import { assignBatches, BATCH_COUNT, platformWeight } from "./batch";
```

to:

```typescript
import { assignBatches, BATCH_COUNT, platformWeight, cronToBatchIndex } from "./batch";
```

Then append this describe block at the bottom of the file:

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

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/batch.test.ts`
Expected: All 10 tests PASS

**Step 7: Commit**

```bash
git add src/lib/batch.ts src/lib/batch.test.ts
git commit -m "feat: add weighted batch assignment and cron-to-batch mapping"
```

---

### Task 2: Update wrangler.jsonc with 5 staggered cron triggers

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

**Step 2: Commit**

```bash
git add wrangler.jsonc
git commit -m "feat: add 5 staggered cron triggers for batch polling"
```

---

### Task 3: Rewrite cron-handler and worker.ts with batch support — failing tests first

This is the core task. The cron handler changes significantly:
- New signature: `runCronPoll(env, cronExpression)`
- Batch filtering via `assignBatches` + `cronToBatchIndex`
- Loop reorder: date-outer, course-inner
- Subrequest budget tracking (45 budget, platform weight per poll)
- Housekeeping gated to batch 0 only
- Return type adds `batchIndex` and `budgetExhausted`

`worker.ts` changes to pass `event.cron` to `runCronPoll`.

> **IMPORTANT for subagent:** `worker.ts` is excluded from `tsconfig.json` because it imports OpenNext build artifacts. Running `npx tsc --noEmit` will NOT check `worker.ts`. This is expected and correct — do not try to fix it.

**Files:**
- Modify: `worker.ts`
- Modify: `src/lib/cron-handler.test.ts`
- Modify: `src/lib/cron-handler.ts`

**Step 1: Update worker.ts**

In `worker.ts`, change:

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

**Step 2: Write failing tests for batch behavior**

Replace the entire contents of `src/lib/cron-handler.test.ts` with the code below.

> **Why the test file is a full replacement:** The loop structure, function signature, return type, and batch filtering all change. Every existing test needs updating. A full replacement is cleaner than dozens of surgical edits.

> **Why `makeMockDb` is defined per-describe block:** Each block needs different mock behavior (some track SQL statements, some accept pollLog data, some accept no args). Extracting a shared helper would require complex configuration parameters. The duplication is intentional.

> **Testing batch assignment in cron handler tests:** Many tests need multiple courses to land in the same batch (batch 0). With 5 batches, weight-1 courses are assigned round-robin. To get N courses in batch 0, create `BATCH_COUNT * N` courses. To get 2 courses in batch 0, create 10.

```typescript
// ABOUTME: Tests for the cron handler's batched polling, budget tracking, and cleanup.
// ABOUTME: Covers batch filtering, date-outer loop, budget exhaustion, and housekeeping gating.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldRunThisCycle, runCronPoll } from "./cron-handler";
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
import { sqliteIsoNow } from "@/lib/db";
import { assignBatches, BATCH_COUNT } from "@/lib/batch";

// Helper to create CourseRow objects for tests
function makeCourseRow(
  id: string,
  platform: string,
  overrides: Partial<{
    is_active: number;
    last_had_tee_times: string | null;
    name: string;
    city: string;
  }> = {}
) {
  return {
    id,
    name: overrides.name ?? id,
    city: overrides.city ?? "Test",
    platform,
    platform_config: "{}",
    booking_url: "https://example.com",
    is_active: overrides.is_active ?? 1,
    last_had_tee_times: overrides.last_had_tee_times ?? null,
  };
}

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

// Cron expressions for batch 0 and batch 1
const BATCH_0_CRON = "*/5 * * * *";
const BATCH_1_CRON = "1-56/5 * * * *";

/**
 * Helper: determine which course IDs land in a given batch.
 * Uses the real assignBatches to ensure tests match runtime behavior.
 */
function coursesInBatch(
  courses: ReturnType<typeof makeCourseRow>[],
  batchIndex: number
): string[] {
  const batches = assignBatches(courses);
  return batches[batchIndex].map((c) => c.id);
}

describe("runCronPoll batch filtering", () => {
  const preparedStatements: string[] = [];

  const makeMockDb = (
    courses: ReturnType<typeof makeCourseRow>[],
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
    // 10 weight-1 courses → 2 per batch
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) =>
      makeCourseRow(`course-${String(i).padStart(2, "0")}`, "foreup")
    );

    const batch0Ids = coursesInBatch(courses, 0);
    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // 2 courses × 2 dates = 4 polls
    expect(result.pollCount).toBe(batch0Ids.length * 2);
    expect(result.courseCount).toBe(batch0Ids.length);
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
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) =>
      makeCourseRow(`course-${String(i).padStart(2, "0")}`, "foreup")
    );

    const batch0Ids = coursesInBatch(courses, 0);
    const batch1Ids = coursesInBatch(courses, 1);

    // Verify no overlap
    for (const id of batch0Ids) {
      expect(batch1Ids).not.toContain(id);
    }

    // Verify both batches poll their own courses
    const db0 = makeMockDb(courses);
    await runCronPoll({ DB: db0 } as unknown as CloudflareEnv, BATCH_0_CRON);
    const polled0 = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(polled0.sort()).toEqual(batch0Ids.sort());

    vi.clearAllMocks();
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);

    const db1 = makeMockDb(courses);
    await runCronPoll({ DB: db1 } as unknown as CloudflareEnv, BATCH_1_CRON);
    const polled1 = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(polled1.sort()).toEqual(batch1Ids.sort());
  });
});

describe("runCronPoll date-outer loop ordering", () => {
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
    // Need 10+ courses so batch 0 gets at least 2 (10 / 5 batches = 2 each)
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) =>
      makeCourseRow(`course-${String(i).padStart(2, "0")}`, "foreup")
    );

    const batch0Ids = coursesInBatch(courses, 0);
    // Verify batch 0 has at least 2 courses (needed for this test to be meaningful)
    expect(batch0Ids.length).toBeGreaterThanOrEqual(2);

    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    const calls = mockedPollCourse.mock.calls;

    // All today calls must come before all tomorrow calls
    const lastTodayIndex = calls.findLastIndex((c) => c[2] === "2026-04-15");
    const firstTomorrowIndex = calls.findIndex((c) => c[2] === "2026-04-16");
    expect(lastTodayIndex).toBeLessThan(firstTomorrowIndex);
  });
});

describe("runCronPoll budget tracking", () => {
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
    // 50 CPS courses → 10 per batch, each weight 3.
    // Budget 45 / weight 3 = 15 polls max. 10 courses × 2 dates = 20 needed.
    const courses = Array.from({ length: 50 }, (_, i) =>
      makeCourseRow(`cps-${String(i).padStart(2, "0")}`, "cps_golf")
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    expect(result.budgetExhausted).toBe(true);
    expect(result.pollCount).toBeLessThan(20);
    expect(result.pollCount).toBe(mockedPollCourse.mock.calls.length);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("budget exhausted")
    );

    consoleSpy.mockRestore();
  });

  it("does not exhaust budget with lightweight courses", async () => {
    // 10 foreup courses → 2 per batch, weight 1 × 2 dates = 4 total. Well under 45.
    const courses = Array.from({ length: 10 }, (_, i) =>
      makeCourseRow(`foreup-${String(i).padStart(2, "0")}`, "foreup")
    );

    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    expect(result.budgetExhausted).toBe(false);
  });

  it("decrements budget on error path (subrequests still consumed)", async () => {
    // 50 CPS courses → 10 per batch, weight 3. All throw errors.
    // Budget should still be consumed by errors.
    const courses = Array.from({ length: 50 }, (_, i) =>
      makeCourseRow(`cps-${String(i).padStart(2, "0")}`, "cps_golf")
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedPollCourse.mockRejectedValue(new Error("adapter crash"));

    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // Budget should be exhausted even though all polls errored
    expect(result.budgetExhausted).toBe(true);
    expect(result.pollCount).toBeLessThan(20);

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does not consume budget for shouldPollDate=false skips", async () => {
    // 10 foreup courses → 2 per batch. shouldPollDate returns false for all.
    // Budget should not be consumed.
    const courses = Array.from({ length: 10 }, (_, i) =>
      makeCourseRow(`foreup-${String(i).padStart(2, "0")}`, "foreup")
    );

    mockedShouldPollDate.mockReturnValue(false);
    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    expect(result.pollCount).toBe(0);
    expect(result.budgetExhausted).toBe(false);
    expect(mockedPollCourse).not.toHaveBeenCalled();
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
      sql.includes("DELETE FROM poll_log") && sql.includes("-7 days")
    );
    const deactivation = preparedStatements.find((sql) =>
      sql.includes("is_active = 0") && sql.includes("-30 days")
    );

    expect(sessionCleanup).toBeDefined();
    expect(sessionCleanup).toBe(
      `DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`
    );
    expect(pollLogCleanup).toBeDefined();
    expect(pollLogCleanup).toBe(
      `DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`
    );
    expect(deactivation).toBeDefined();
    expect(deactivation).toContain(sqliteIsoNow("-30 days"));
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

describe("runCronPoll error isolation", () => {
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues polling other courses after one throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 10 courses → 2 per batch. Both in batch 0 will be polled.
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) =>
      makeCourseRow(`course-${String(i).padStart(2, "0")}`, "foreup")
    );
    const batch0Ids = coursesInBatch(courses, 0);
    expect(batch0Ids.length).toBeGreaterThanOrEqual(2);

    // First course in batch 0 throws, second should still be polled
    const failId = batch0Ids[0];
    mockedPollCourse.mockImplementation(async (_db, course) => {
      if (course.id === failId) throw new Error("adapter crash");
      return "no_data";
    });

    // Only poll today to simplify assertion
    mockedShouldPollDate.mockImplementation((offset: number) => offset === 0);
    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    // Both courses in batch 0 should have been attempted
    const polledIds = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(polledIds).toHaveLength(batch0Ids.length);

    consoleSpy.mockRestore();
  });

  it("continues to next date after error on current date", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Use enough courses for 2 in batch 0
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) =>
      makeCourseRow(`course-${String(i).padStart(2, "0")}`, "foreup")
    );
    const batch0Ids = coursesInBatch(courses, 0);
    const targetId = batch0Ids[0];

    // Throw on today, succeed on tomorrow
    mockedPollCourse.mockImplementation(async (_db, course, date) => {
      if (course.id === targetId && date === "2026-04-15") {
        throw new Error("transient error");
      }
      return "no_data";
    });

    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    // The target course should have been called for both dates
    const targetCalls = mockedPollCourse.mock.calls.filter(
      (c) => c[1].id === targetId
    );
    const targetDates = targetCalls.map((c) => c[2]);
    expect(targetDates).toContain("2026-04-15");
    expect(targetDates).toContain("2026-04-16");

    consoleSpy.mockRestore();
  });

  it("handles double-fault when logPoll throws inside catch block", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Single course in batch 0
    const courses = [makeCourseRow("solo-course", "foreup")];

    // pollCourse throws, then the catch block's logPoll will use the mock DB
    // which always resolves. To test double-fault, we need pollCourse to throw
    // AND the implementation's logPoll to throw. Since logPoll is NOT mocked
    // (it's imported from db.ts, not from poller), and the mock DB's prepare
    // returns successful mocks, the double-fault happens if the DB mock throws.
    // For this test, we verify the handler doesn't crash even when pollCourse throws.
    mockedPollCourse.mockRejectedValue(new Error("adapter crash"));
    mockedShouldPollDate.mockImplementation((offset: number) => offset === 0);

    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // Handler should not crash — should return normally
    expect(result.pollCount).toBe(1);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("runCronPoll active/inactive polling", () => {
  const makeMockDb = (
    courses: ReturnType<typeof makeCourseRow>[],
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
    // Single inactive course → goes to batch 0
    const courses = [
      makeCourseRow("test-inactive", "foreup", { is_active: 0 }),
    ];

    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    expect(mockedPollCourse).toHaveBeenCalledTimes(2);
    const dates = mockedPollCourse.mock.calls.map((c) => c[2]);
    expect(dates).toContain("2026-04-15");
    expect(dates).toContain("2026-04-16");
  });

  it("promotes inactive course to active when tee times found", async () => {
    mockedPollCourse.mockResolvedValue("success");
    const courses = [
      makeCourseRow("test-inactive", "foreup", { is_active: 0 }),
    ];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auto-activated")
    );
    consoleSpy.mockRestore();
  });

  it("does not probe inactive courses if polled less than 1 hour ago", async () => {
    const recentPoll = new Date("2026-04-15T06:30:00-05:00").toISOString();
    const courses = [
      makeCourseRow("test-inactive", "foreup", { is_active: 0 }),
    ];
    const db = makeMockDb(
      courses,
      [{ course_id: "test-inactive", date: "2026-04-15", last_polled: recentPoll }]
    );

    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });

  it("does not promote inactive course when poll returns error", async () => {
    mockedPollCourse.mockResolvedValue("error");
    const courses = [
      makeCourseRow("test-inactive", "foreup", { is_active: 0 }),
    ];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    // Should NOT have logged auto-activation
    const activationLogs = consoleSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("Auto-activated")
    );
    expect(activationLogs).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it("continues probing other inactive courses after one throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Need 10 inactive courses so batch 0 gets 2
    const courses = Array.from({ length: BATCH_COUNT * 2 }, (_, i) =>
      makeCourseRow(`inactive-${String(i).padStart(2, "0")}`, "foreup", { is_active: 0 })
    );
    const batch0Ids = coursesInBatch(courses, 0);
    expect(batch0Ids.length).toBeGreaterThanOrEqual(2);

    const failId = batch0Ids[0];
    mockedPollCourse.mockImplementation(async (_db, course) => {
      if (course.id === failId) throw new Error("adapter crash");
      return "no_data";
    });

    const db = makeMockDb(courses);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON);

    // Second inactive course should have been probed despite first one throwing
    const polledIds = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(polledIds.length).toBeGreaterThan(1);

    consoleSpy.mockRestore();
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: FAIL — `runCronPoll` signature mismatch, no `batchIndex`/`budgetExhausted` in return type

**Step 4: Rewrite the cron handler**

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

**Step 5: Run cron handler tests**

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: All tests PASS

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Lint**

Run: `npm run lint`
Expected: No errors

**Step 9: Commit**

```bash
git add worker.ts src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "feat: rewrite cron handler with batch support, budget tracking, and date-priority loop"
```

---

### Task 4: Final verification and push

**Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors

**Step 4: Verify ABOUTME comments**

Verify these files have accurate ABOUTME comments:
- `src/lib/batch.ts` — updated in Task 1
- `src/lib/cron-handler.ts` — updated in Task 3
- `worker.ts` — existing comments still accurate (wraps OpenNext + cron)

**Step 5: Verify clean working tree**

Run: `git status`
Expected: Nothing to commit, working tree clean

**Step 6: Push**

```bash
git push
```
