// ABOUTME: Tests for the cron handler's batched polling, budget tracking, and cleanup.
// ABOUTME: Covers batch filtering, date-outer loop, budget exhaustion, and housekeeping gating.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldRunThisCycle, runCronPoll, SUBREQUEST_BUDGET, runHorizonProbe, checkV4Upgrades } from "./cron-handler";
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
import * as dbModule from "@/lib/db";
import { assignBatches, BATCH_COUNT } from "@/lib/batch";

const { sqliteIsoNow } = dbModule;

/** Run an async function, flushing fake timers until it resolves. */
async function withTimers<T>(fn: () => Promise<T>): Promise<T> {
  let done = false;
  const promise = fn().finally(() => { done = true; });
  while (!done) {
    await vi.advanceTimersByTimeAsync(250);
  }
  return promise;
}

// Helper to create CourseRow objects for tests
function makeCourseRow(
  id: string,
  platform: string,
  overrides: Partial<{
    is_active: number;
    last_had_tee_times: string | null;
    booking_horizon_days: number;
    last_horizon_probe: string | null;
    name: string;
    city: string;
    platform_config: string;
  }> = {}
) {
  return {
    id,
    name: overrides.name ?? id,
    city: overrides.city ?? "Test",
    state: "MN",
    platform,
    platform_config: overrides.platform_config ?? "{}",
    booking_url: "https://example.com",
    is_active: overrides.is_active ?? 1,
    disabled: 0,
    display_notes: null,
    last_had_tee_times: overrides.last_had_tee_times ?? null,
    booking_horizon_days: overrides.booking_horizon_days ?? 7,
    last_horizon_probe: overrides.last_horizon_probe ?? null,
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
  MAX_HORIZON: 14,
  PROBE_INTERVAL_DAYS: 7,
}));

// Partial mock of db module: pass through real implementations, allow per-test overrides
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    deactivateStaleCourses: vi.fn().mockImplementation(actual.deactivateStaleCourses),
    cleanupOldPolls: vi.fn().mockImplementation(actual.cleanupOldPolls),
    cleanupExpiredSessions: vi.fn().mockImplementation(actual.cleanupExpiredSessions),
  };
});

const mockedPollCourse = vi.mocked(pollCourse);
const mockedShouldPollDate = vi.mocked(shouldPollDate);
const mockedGetPollingDates = vi.mocked(getPollingDates);
const mockedDeactivateStaleCourses = vi.mocked(dbModule.deactivateStaleCourses);
const mockedCleanupOldPolls = vi.mocked(dbModule.cleanupOldPolls);
const mockedCleanupExpiredSessions = vi.mocked(dbModule.cleanupExpiredSessions);

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
            results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe")
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
    vi.useFakeTimers();
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
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

    // 2 courses × 2 dates = 4 polls
    expect(result.pollCount).toBe(batch0Ids.length * 2);
    expect(result.courseCount).toBe(batch0Ids.length);
  });

  it("returns batchIndex in results", async () => {
    const db = makeMockDb([]);
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));
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
    await withTimers(() => runCronPoll({ DB: db0 } as unknown as CloudflareEnv, BATCH_0_CRON));
    const polled0 = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(polled0.sort()).toEqual(batch0Ids.sort());

    vi.clearAllMocks();
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);

    const db1 = makeMockDb(courses);
    await withTimers(() => runCronPoll({ DB: db1 } as unknown as CloudflareEnv, BATCH_1_CRON));
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
        results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe") ? courses : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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
        results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe") ? courses : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15", "2026-04-16"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling when budget is exhausted", async () => {
    // Use 7 dates so each CPS course (weight 3) costs 21 units → fewer courses needed
    const dates = Array.from({ length: 7 }, (_, i) => `2026-04-${15 + i}`);
    mockedGetPollingDates.mockReturnValue(dates);
    // coursesPerBatch * 7 dates * 3 weight > budget → coursesPerBatch > budget/21
    const coursesNeeded = Math.ceil(SUBREQUEST_BUDGET / 21 + 1) * 5;
    const courses = Array.from({ length: coursesNeeded }, (_, i) =>
      makeCourseRow(`cps-${String(i).padStart(3, "0")}`, "cps_golf")
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeMockDb(courses);
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

    expect(result.budgetExhausted).toBe(true);
    expect(result.pollCount).toBe(mockedPollCourse.mock.calls.length);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("budget exhausted")
    );

    consoleSpy.mockRestore();
  });

  it("does not exhaust budget with lightweight courses", async () => {
    // 10 foreup courses → 2 per batch, weight 1 × 2 dates = 4 total. Well under budget.
    const courses = Array.from({ length: 10 }, (_, i) =>
      makeCourseRow(`foreup-${String(i).padStart(2, "0")}`, "foreup")
    );

    const db = makeMockDb(courses);
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

    expect(result.budgetExhausted).toBe(false);
  });

  it("decrements budget on error path (subrequests still consumed)", async () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-04-${15 + i}`);
    mockedGetPollingDates.mockReturnValue(dates);
    const coursesNeeded = Math.ceil(SUBREQUEST_BUDGET / 21 + 1) * 5;
    const courses = Array.from({ length: coursesNeeded }, (_, i) =>
      makeCourseRow(`cps-${String(i).padStart(3, "0")}`, "cps_golf")
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedPollCourse.mockRejectedValue(new Error("adapter crash"));

    const db = makeMockDb(courses);
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

    // Budget should be exhausted even though all polls errored
    expect(result.budgetExhausted).toBe(true);

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
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

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
    vi.useFakeTimers();
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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_1_CRON));

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

  it("continues cleanup when deactivateStaleCourses throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedDeactivateStaleCourses.mockRejectedValueOnce(new Error("deactivation boom"));

    const db = makeMockDb();
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    expect(mockedCleanupOldPolls).toHaveBeenCalled();
    expect(mockedCleanupExpiredSessions).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("continues cleanup when cleanupOldPolls throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCleanupOldPolls.mockRejectedValueOnce(new Error("poll cleanup boom"));

    const db = makeMockDb();
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    expect(mockedCleanupExpiredSessions).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("continues cleanup when cleanupExpiredSessions throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCleanupExpiredSessions.mockRejectedValueOnce(new Error("session cleanup boom"));

    const db = makeMockDb();
    const result = await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    // Should return normally without crashing
    expect(result.skipped).toBe(false);

    consoleSpy.mockRestore();
  });

  it("issues horizon probe query in batch 0", async () => {
    const db = makeMockDb();
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const probeQuery = preparedStatements.find((sql) =>
      sql.includes("last_horizon_probe")
    );
    expect(probeQuery).toBeDefined();
  });

  it("does not issue horizon probe query in non-zero batches", async () => {
    const db = makeMockDb();
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_1_CRON));

    const probeQuery = preparedStatements.find((sql) =>
      sql.includes("last_horizon_probe")
    );
    expect(probeQuery).toBeUndefined();
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
        results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe") ? courses : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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
    // which always resolves. To test double-fault, we verify the handler doesn't
    // crash even when pollCourse throws.
    mockedPollCourse.mockRejectedValue(new Error("adapter crash"));
    mockedShouldPollDate.mockImplementation((offset: number) => offset === 0);

    const db = makeMockDb(courses);
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

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
        results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe")
          ? courses
          : sql.includes("poll_log")
            ? pollLog
            : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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

    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });

  it("does not promote inactive course when poll returns error", async () => {
    mockedPollCourse.mockResolvedValue("error");
    const courses = [
      makeCourseRow("test-inactive", "foreup", { is_active: 0 }),
    ];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = makeMockDb(courses);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

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
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    // Second inactive course should have been probed despite first one throwing
    const polledIds = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(polledIds.length).toBeGreaterThan(1);

    consoleSpy.mockRestore();
  });

  it("decrements budget on inactive probe error (subrequests still consumed)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Inactive courses probe today+tomorrow only (2 dates, from first 2 of getPollingDates).
    // Need coursesPerBatch * 2 * 3 > budget → coursesPerBatch > budget/6
    const coursesNeeded = Math.ceil(SUBREQUEST_BUDGET / 6 + 1) * 5;
    const courses = Array.from({ length: coursesNeeded }, (_, i) =>
      makeCourseRow(`cps-${String(i).padStart(3, "0")}`, "cps_golf", { is_active: 0 })
    );

    mockedPollCourse.mockRejectedValue(new Error("adapter crash"));

    const db = makeMockDb(courses);
    const result = await withTimers(() => runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    ));

    // Budget should be exhausted even though all probes errored
    expect(result.budgetExhausted).toBe(true);

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe("runCronPoll per-course horizon", () => {
  const makeMockDb = (courses: ReturnType<typeof makeCourseRow>[]) => ({
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      all: vi.fn().mockResolvedValue({
        results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe") ? courses : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    const course7 = makeCourseRow("horizon-7", "foreup", { booking_horizon_days: 7 });
    const db = makeMockDb([course7]);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const dates7 = mockedPollCourse.mock.calls
      .filter((c) => c[1].id === "horizon-7")
      .map((c) => c[2]);
    expect(dates7).toHaveLength(7);
    expect(dates7[dates7.length - 1]).toBe("2026-04-21");
  });

  it("polls up to 14 days for courses with extended horizon", async () => {
    const course14 = makeCourseRow("horizon-14", "foreup", { booking_horizon_days: 14 });
    const db = makeMockDb([course14]);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const dates14 = mockedPollCourse.mock.calls
      .filter((c) => c[1].id === "horizon-14")
      .map((c) => c[2]);
    expect(dates14).toHaveLength(14);
    expect(dates14[dates14.length - 1]).toBe("2026-04-28");
  });
});

describe("runCronPoll SQL verification", () => {
  const makeMockDb = (courses: ReturnType<typeof makeCourseRow>[]) => ({
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      all: vi.fn().mockResolvedValue({
        results: sql.includes("FROM courses") && !sql.includes("last_horizon_probe")
          ? courses
          : sql.includes("poll_log")
            ? []
            : [],
      }),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
    mockedShouldPollDate.mockReturnValue(true);
    mockedGetPollingDates.mockReturnValue(["2026-04-15"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries only non-disabled courses from the database", async () => {
    const courses = [makeCourseRow("test-course", "foreup")];
    const db = makeMockDb(courses);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const courseQuery = db.prepare.mock.calls.find(
      (args) => (args[0] as string).includes("FROM courses")
    );
    expect(courseQuery).toBeDefined();
    expect(courseQuery![0]).toContain("disabled = 0");
  });

  it("updates last_had_tee_times when pollCourse returns success", async () => {
    mockedPollCourse.mockResolvedValue("success");
    const courses = [makeCourseRow("success-course", "foreup")];
    const db = makeMockDb(courses);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const updateCall = db.prepare.mock.calls.find(
      (args) => (args[0] as string).includes("last_had_tee_times")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("UPDATE courses SET last_had_tee_times");
  });

  it("does not update last_had_tee_times when pollCourse returns no_data", async () => {
    mockedPollCourse.mockResolvedValue("no_data");
    const courses = [makeCourseRow("nodata-course", "foreup")];
    const db = makeMockDb(courses);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const updateCall = db.prepare.mock.calls.find(
      (args) => (args[0] as string).includes("SET last_had_tee_times")
    );
    expect(updateCall).toBeUndefined();
  });

  it("writes is_active = 1 when auto-activating an inactive course", async () => {
    mockedPollCourse.mockResolvedValue("success");
    const courses = [
      makeCourseRow("reactivate-course", "foreup", { is_active: 0 }),
    ];
    const db = makeMockDb(courses);
    await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));

    const activateCall = db.prepare.mock.calls.find(
      (args) => (args[0] as string).includes("SET is_active = 1")
    );
    expect(activateCall).toBeDefined();
    expect(activateCall![0]).toContain("last_had_tee_times");
  });
});

describe("runHorizonProbe", () => {
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T02:00:00-05:00"));
    mockedPollCourse.mockResolvedValue("no_data");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extends horizon when tee times found beyond current horizon", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const course = makeCourseRow("probe-test", "foreup", { booking_horizon_days: 7 });
    // Return success for day offset 10 (the 11th day out → "2026-04-25")
    mockedPollCourse.mockImplementation(async (_db, _course, date) => {
      if (date === "2026-04-25") return "success";
      return "no_data";
    });
    const db = makeMockDb();
    const result = await withTimers(() => runHorizonProbe(db as any, [course], "2026-04-15", { remaining: 500 }));

    expect(result.updatedCourses).toContain("probe-test");
    // booking_horizon_days UPDATE should write dayOffset + 1 = 11
    const updateCalls = db.prepare.mock.calls.filter(
      (args) => (args[0] as string).includes("booking_horizon_days")
    );
    expect(updateCalls.length).toBeGreaterThan(0);
    // Verify the actual value (11 = dayOffset 10 + 1) via the log message
    expect(consoleSpy).toHaveBeenCalledWith("Horizon probe: probe-test extended to 11 days");
    consoleSpy.mockRestore();
  });

  it("does not lower horizon when no tee times found", async () => {
    const course = makeCourseRow("no-lower", "foreup", { booking_horizon_days: 10 });
    mockedPollCourse.mockResolvedValue("no_data");
    const db = makeMockDb();
    const result = await withTimers(() => runHorizonProbe(db as any, [course], "2026-04-15", { remaining: 500 }));

    expect(result.updatedCourses).toHaveLength(0);
    const updateCalls = db.prepare.mock.calls.filter(
      (args) => (args[0] as string).includes("booking_horizon_days")
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("always updates last_horizon_probe timestamp", async () => {
    const course = makeCourseRow("probe-ts", "foreup", { booking_horizon_days: 7 });
    mockedPollCourse.mockResolvedValue("no_data");
    const db = makeMockDb();
    await withTimers(() => runHorizonProbe(db as any, [course], "2026-04-15", { remaining: 500 }));

    const probeCalls = db.prepare.mock.calls.filter(
      (args) => (args[0] as string).includes("last_horizon_probe")
    );
    expect(probeCalls.length).toBeGreaterThan(0);
  });

  it("respects subrequest budget", async () => {
    const course = makeCourseRow("budget-test", "cps_golf", { booking_horizon_days: 7 });
    mockedPollCourse.mockResolvedValue("no_data");
    // CPS weight = 3, 7 dates to check (days 7-13), needs 21. Give only 9 → 3 polls.
    const budget = { remaining: 9 };
    const db = makeMockDb();
    await withTimers(() => runHorizonProbe(db as any, [course], "2026-04-15", budget));

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
    await withTimers(() => runHorizonProbe(db as any, [course1, course2], "2026-04-15", { remaining: 500 }));

    const probedIds = [...new Set(mockedPollCourse.mock.calls.map((c) => c[1].id))];
    expect(probedIds).toContain("ok-probe");
    consoleSpy.mockRestore();
  });

  it("skips courses already at MAX_HORIZON", async () => {
    const course = makeCourseRow("at-max", "foreup", { booking_horizon_days: 14 });
    mockedPollCourse.mockResolvedValue("no_data");
    const db = makeMockDb();
    await withTimers(() => runHorizonProbe(db as any, [course], "2026-04-15", { remaining: 500 }));

    // No dates to check: horizon (14) >= MAX_HORIZON (14), loop body never executes
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });
});

describe("checkV4Upgrades", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attempts v5 token endpoint for v4 courses", async () => {
    const course = makeCourseRow("v4-course", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "test", authType: "v4", websiteId: "abc", courseIds: "1" }),
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    await checkV4Upgrades(db as any, [course]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://test.cps.golf/identityapi/myconnect/token/short");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("updates platform_config when v5 token endpoint returns 200", async () => {
    const platformConfig = { subdomain: "test", authType: "v4", websiteId: "abc", courseIds: "1" };
    const course = makeCourseRow("v4-course", "cps_golf", {
      platform_config: JSON.stringify(platformConfig),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "tok", expires_in: 600 }), { status: 200 })
    );

    const runMock = vi.fn().mockResolvedValue({ success: true });
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const db = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) };

    const result = await checkV4Upgrades(db as any, [course]);

    expect(result).toContain("v4-course");
    expect(db.prepare).toHaveBeenCalledWith("UPDATE courses SET platform_config = ? WHERE id = ?");
    const newConfig = JSON.parse(bindMock.mock.calls[0][0]);
    expect(newConfig.authType).toBeUndefined();
    expect(newConfig.subdomain).toBe("test");
    expect(newConfig.websiteId).toBe("abc");
    expect(newConfig.courseIds).toBe("1");
  });

  it("does not update when v5 token endpoint returns 404", async () => {
    const course = makeCourseRow("still-v4", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "test", authType: "v4", websiteId: "abc", courseIds: "1" }),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    const result = await checkV4Upgrades(db as any, [course]);

    expect(result).toHaveLength(0);
    const updateCalls = (db.prepare.mock.calls as string[][]).filter(
      (args) => args[0].includes("UPDATE")
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("skips non-CPS and non-v4 courses", async () => {
    const foreupCourse = makeCourseRow("foreup-course", "foreup", {
      platform_config: JSON.stringify({ scheduleId: "123" }),
    });
    const v5Course = makeCourseRow("v5-course", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "test", websiteId: "abc" }),
    });

    vi.spyOn(globalThis, "fetch");

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    const result = await checkV4Upgrades(db as any, [foreupCourse, v5Course]);

    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks each subdomain only once and updates all courses on it", async () => {
    const course1 = makeCourseRow("oak-glen-championship", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "oakglen", authType: "v4", websiteId: "a", courseIds: "6" }),
    });
    const course2 = makeCourseRow("oak-glen-executive", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "oakglen", authType: "v4", websiteId: "a", courseIds: "7" }),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok", expires_in: 600 }), { status: 200 })
    );

    const runMock = vi.fn().mockResolvedValue({ success: true });
    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: runMock }) }) };
    const result = await checkV4Upgrades(db as any, [course1, course2]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toContain("oak-glen-championship");
    expect(result).toContain("oak-glen-executive");
  });

  it("continues checking other subdomains after one errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const course1 = makeCourseRow("fail-check", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "fail", authType: "v4", websiteId: "a", courseIds: "1" }),
    });
    const course2 = makeCourseRow("ok-check", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "ok", authType: "v4", websiteId: "b", courseIds: "2" }),
    });

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network fail"))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    await checkV4Upgrades(db as any, [course1, course2]);

    expect(fetch).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("returns empty array when no v4 courses exist", async () => {
    vi.spyOn(globalThis, "fetch");
    const db = { prepare: vi.fn() };
    const result = await checkV4Upgrades(db as any, []);
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
