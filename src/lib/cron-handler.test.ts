// ABOUTME: Tests for the cron handler's time-of-day polling frequency logic and cleanup tasks.
// ABOUTME: Covers shouldRunThisCycle at different Central Time hours and expired session cleanup.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldRunThisCycle, runCronPoll } from "./cron-handler";

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
    await runCronPoll(mockDb as unknown as D1Database);

    const sessionCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM sessions")
    );
    expect(sessionCleanup).toBe(
      "DELETE FROM sessions WHERE expires_at < datetime('now')"
    );
  });

  it("does not error when sessions table is empty", async () => {
    // The mock already returns { success: true } for .run(), simulating an
    // empty table where DELETE affects zero rows. Verify no exception thrown.
    await expect(
      runCronPoll(mockDb as unknown as D1Database)
    ).resolves.not.toThrow();
  });
});
