// ABOUTME: Tests for the cron handler's time-of-day polling frequency logic and cleanup tasks.
// ABOUTME: Covers shouldRunThisCycle at different Central Time hours and expired session cleanup.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldRunThisCycle, runCronPoll } from "./cron-handler";
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
import { sqliteIsoNow } from "@/lib/db";

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

// Mock poller to isolate cron handler cleanup logic
vi.mock("@/lib/poller", () => ({
  pollCourse: vi.fn(),
  shouldPollDate: vi.fn().mockReturnValue(false),
  getPollingDates: vi.fn().mockReturnValue(["2026-04-15"]),
}));

const mockedPollCourse = vi.mocked(pollCourse);
const mockedShouldPollDate = vi.mocked(shouldPollDate);
const mockedGetPollingDates = vi.mocked(getPollingDates);

describe("runCronPoll cleanup", () => {
  // Track all SQL statements passed to db.prepare
  const preparedStatements: string[] = [];

  const mockDb = {
    prepare: vi.fn().mockImplementation((sql: string) => {
      preparedStatements.push(sql);
      return {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    preparedStatements.length = 0;
    // Force shouldRunThisCycle to return true by mocking Date to 7am CT
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T07:00:00-05:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes expired sessions during cron run", async () => {
    await runCronPoll({ DB: mockDb } as unknown as CloudflareEnv);

    const sessionCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM sessions")
    );
    expect(sessionCleanup).toBe(
      `DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`
    );
  });

  it("uses ISO format for poll_log cleanup", async () => {
    await runCronPoll({ DB: mockDb } as unknown as CloudflareEnv);

    const pollLogCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM poll_log")
    );
    expect(pollLogCleanup).toBe(
      `DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`
    );
  });

  it("uses ISO format for recent polls batch query", async () => {
    await runCronPoll({ DB: mockDb } as unknown as CloudflareEnv);

    const batchQuery = preparedStatements.find(
      (sql) => sql.includes("MAX(polled_at)") && sql.includes("poll_log")
    );
    expect(batchQuery).toContain(sqliteIsoNow("-24 hours"));
  });

  it("does not error when sessions table is empty", async () => {
    // The mock already returns { success: true } for .run(), simulating an
    // empty table where DELETE affects zero rows. Verify no exception thrown.
    await expect(
      runCronPoll({ DB: mockDb } as unknown as CloudflareEnv)
    ).resolves.not.toThrow();
  });
});

describe("runCronPoll auto-active management", () => {
  let preparedStatements: string[] = [];
  let boundValues: unknown[][] = [];

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
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    expect(mockedPollCourse).toHaveBeenCalledTimes(2);
    expect(mockedPollCourse.mock.calls[0][2]).toBe("2026-04-15");
    expect(mockedPollCourse.mock.calls[1][2]).toBe("2026-04-16");
  });

  it("promotes inactive course to active when tee times found", async () => {
    mockedPollCourse.mockResolvedValue("success");
    const db = makeMockDb([inactiveCourse]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    const promotionSql = preparedStatements.find(
      (sql) => sql.includes("SET is_active = 1") && sql.includes("last_had_tee_times")
    );
    expect(promotionSql).toBeDefined();
  });

  it("does not probe inactive courses if polled less than 1 hour ago", async () => {
    const recentPoll = new Date("2026-04-15T06:30:00-05:00").toISOString();
    const db = makeMockDb(
      [inactiveCourse],
      [{ course_id: "test-inactive", date: "2026-04-15", last_polled: recentPoll }]
    );

    await runCronPoll({ DB: db } as unknown as CloudflareEnv);
    expect(mockedPollCourse).not.toHaveBeenCalled();
  });

  it("updates last_had_tee_times when active course poll returns success", async () => {
    mockedPollCourse.mockResolvedValue("success");
    mockedShouldPollDate.mockImplementation(
      (offset: number) => offset === 0
    );
    const db = makeMockDb([activeCourse]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    const updateSql = preparedStatements.find(
      (sql) => sql.includes("last_had_tee_times") && !sql.includes("is_active = 0")
    );
    expect(updateSql).toBeDefined();
  });

  it("deactivates courses with no tee times for 30 days", async () => {
    const db = makeMockDb([activeCourse]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    const deactivateSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 0") && sql.includes("-30 days")
    );
    expect(deactivateSql).toBeDefined();
    expect(deactivateSql).toContain(sqliteIsoNow("-30 days"));
  });

  it("does not deactivate courses with NULL last_had_tee_times", async () => {
    const courseWithNull = {
      ...activeCourse,
      id: "test-null-lhtt",
      last_had_tee_times: null,
    };
    const db = makeMockDb([courseWithNull]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    const deactivateSql = preparedStatements.find(
      (sql) => sql.includes("is_active = 0")
    );
    // The deactivation SQL must require IS NOT NULL — courses with NULL
    // last_had_tee_times have never been proven inactive and must not
    // be deactivated.
    expect(deactivateSql).toContain("last_had_tee_times IS NOT NULL");
    expect(deactivateSql).not.toContain("IS NULL OR");
  });

  it("does not promote inactive course when poll returns error", async () => {
    mockedPollCourse.mockResolvedValue("error");
    const db = makeMockDb([inactiveCourse]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    const promotionSql = preparedStatements.find(
      (sql) => sql.includes("SET is_active = 1") && sql.includes("last_had_tee_times")
    );
    expect(promotionSql).toBeUndefined();
  });

  it("continues probing other inactive courses after one throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const inactive2 = { ...inactiveCourse, id: "test-inactive-2", name: "Inactive 2" };
    mockedPollCourse
      .mockRejectedValueOnce(new Error("adapter crash"))
      .mockResolvedValue("no_data");
    const db = makeMockDb([inactiveCourse, inactive2]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    // First course: 1 call (throws), skips rest. Second course: 2 calls (today+tomorrow)
    expect(mockedPollCourse).toHaveBeenCalledTimes(3);
    // Verify the second course was actually reached
    expect(mockedPollCourse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "test-inactive-2" }),
      expect.any(String),
      expect.anything()
    );
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain("Error probing inactive course");

    consoleSpy.mockRestore();
  });

  it("polls active courses and probes inactive courses in the same run", async () => {
    mockedShouldPollDate.mockReturnValue(true);
    mockedPollCourse.mockResolvedValue("no_data");
    const db = makeMockDb([activeCourse, inactiveCourse]);
    const result = await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    // Active: 7 dates, Inactive: 2 dates = 9 total calls
    expect(mockedPollCourse).toHaveBeenCalledTimes(9);
    expect(result.courseCount).toBe(1);
    expect(result.inactiveProbeCount).toBe(2);
  });

  it("continues polling remaining dates after one date throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Make pollCourse throw on the 2nd call (date index 1), succeed on all others
    mockedPollCourse
      .mockResolvedValueOnce("success")  // date 0
      .mockRejectedValueOnce(new Error("transient D1 error"))  // date 1
      .mockResolvedValue("no_data");     // dates 2-6

    mockedShouldPollDate.mockReturnValue(true);
    const db = makeMockDb([activeCourse]);
    const result = await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    // All 7 dates should have been attempted despite the error on date 1
    expect(mockedPollCourse).toHaveBeenCalledTimes(7);
    expect(result.pollCount).toBe(7);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain("Error polling test-active");

    consoleSpy.mockRestore();
  });

  it("logs to poll_log when pollCourse throws in active course loop", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockedPollCourse
      .mockRejectedValueOnce(new Error("config parse failure"))
      .mockResolvedValue("no_data");

    mockedShouldPollDate.mockReturnValue(true);
    const db = makeMockDb([activeCourse]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    // The catch block should log the error to poll_log
    const errorLogSql = preparedStatements.find(
      (sql) => sql.includes("INSERT INTO poll_log") && sql.includes("error")
    );
    expect(errorLogSql).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("continues polling other active courses after one throws on all dates", { timeout: 10000 }, async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const active2 = { ...activeCourse, id: "test-active-2", name: "Active 2" };

    // First course: all dates throw. Second course: all succeed.
    let callCount = 0;
    mockedPollCourse.mockImplementation(async (_db, course) => {
      callCount++;
      if (course.id === "test-active") throw new Error("adapter crash");
      return "no_data";
    });

    mockedShouldPollDate.mockReturnValue(true);
    const db = makeMockDb([activeCourse, active2]);
    await runCronPoll({ DB: db } as unknown as CloudflareEnv);

    // Both courses should have all 7 dates attempted
    expect(callCount).toBe(14);
    expect(consoleSpy).toHaveBeenCalledTimes(7);

    consoleSpy.mockRestore();
  });

  it("returns inactiveProbeCount in results", async () => {
    const db = makeMockDb([inactiveCourse]);
    const result = await runCronPoll({ DB: db } as unknown as CloudflareEnv);
    expect(result).toHaveProperty("inactiveProbeCount");
  });
});
