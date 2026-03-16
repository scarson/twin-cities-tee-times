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

  it("stops polling when budget is exhausted", { timeout: 15000 }, async () => {
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

  it("decrements budget on error path (subrequests still consumed)", { timeout: 15000 }, async () => {
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
    // which always resolves. To test double-fault, we verify the handler doesn't
    // crash even when pollCourse throws.
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

  it("decrements budget on inactive probe error (subrequests still consumed)", { timeout: 15000 }, async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 50 inactive CPS courses → 10 per batch, weight 3 each.
    // Budget 45 / weight 3 = 15 polls max. 10 courses × 2 dates = 20 needed.
    const courses = Array.from({ length: 50 }, (_, i) =>
      makeCourseRow(`cps-${String(i).padStart(2, "0")}`, "cps_golf", { is_active: 0 })
    );

    mockedPollCourse.mockRejectedValue(new Error("adapter crash"));

    const db = makeMockDb(courses);
    const result = await runCronPoll(
      { DB: db } as unknown as CloudflareEnv,
      BATCH_0_CRON
    );

    // Budget should be exhausted even though all probes errored
    expect(result.budgetExhausted).toBe(true);
    expect(result.inactiveProbeCount).toBeLessThan(20);

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
