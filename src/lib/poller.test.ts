// ABOUTME: Tests for polling logic including date frequency, month boundaries, and error handling.
// ABOUTME: Covers shouldPollDate, getPollingDates, and pollCourse with mocked adapters.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollCourse, shouldPollDate, getPollingDates } from "./poller";

// Mock the adapter registry
vi.mock("@/adapters", () => ({
  getAdapter: vi.fn(),
}));

// Mock the db helpers
vi.mock("@/lib/db", () => ({
  upsertTeeTimes: vi.fn(),
  logPoll: vi.fn(),
}));

import { getAdapter } from "@/adapters";
import { upsertTeeTimes, logPoll } from "@/lib/db";

describe("shouldPollDate", () => {
  it("always polls today and tomorrow", () => {
    expect(shouldPollDate(0, 0)).toBe(true); // offset 0 = today
    expect(shouldPollDate(1, 0)).toBe(true); // offset 1 = tomorrow
  });

  it("polls days 3-4 every 30 min", () => {
    // minutesSinceLast < 30 → skip
    expect(shouldPollDate(2, 20)).toBe(false);
    // minutesSinceLast >= 30 → poll
    expect(shouldPollDate(2, 31)).toBe(true);
    expect(shouldPollDate(3, 30)).toBe(true);
  });

  it("polls days 5-7 only at 8am and 6pm", () => {
    // This is controlled by the cron caller, but the function
    // uses minutesSinceLast with a 10-hour threshold
    expect(shouldPollDate(4, 60)).toBe(false);
    expect(shouldPollDate(4, 600)).toBe(true);
    expect(shouldPollDate(6, 601)).toBe(true);
  });
});

describe("getPollingDates", () => {
  it("returns 7 dates starting from today", () => {
    const dates = getPollingDates("2026-04-15");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-04-15");
    expect(dates[6]).toBe("2026-04-21");
  });

  it("handles month boundary rollover", () => {
    const dates = getPollingDates("2026-03-28");
    expect(dates).toEqual([
      "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31",
      "2026-04-01", "2026-04-02", "2026-04-03",
    ]);
  });
});

describe("pollCourse", () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    }),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn(),
  };

  const mockCourse = {
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ facilityId: "21445", scheduleId: "7829" }),
    booking_url: "https://foreupsoftware.com/index.php/booking/21445/7829",
    is_active: 1,
    city: "Edina",
    last_active_check: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tee times and writes to db on success", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockResolvedValue([
        {
          courseId: "braemar",
          time: "2026-04-15T07:00:00",
          price: 45,
          holes: 18,
          openSlots: 4,
          bookingUrl: "https://foreupsoftware.com/index.php/booking/21445/7829",
        },
      ]),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(mockAdapter.fetchTeeTimes).toHaveBeenCalledOnce();
    expect(upsertTeeTimes).toHaveBeenCalledOnce();
    expect(logPoll).toHaveBeenCalledWith(
      mockDb,
      "braemar",
      "2026-04-15",
      "success",
      1,
      undefined
    );
  });

  it("logs error when adapter is not found", async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(logPoll).toHaveBeenCalledWith(
      mockDb,
      "braemar",
      "2026-04-15",
      "error",
      0,
      expect.stringContaining("No adapter")
    );
  });

  it("logs no_data when adapter returns empty array", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);

    await pollCourse(mockDb as any, mockCourse, "2026-04-15");

    expect(logPoll).toHaveBeenCalledWith(mockDb, "braemar", "2026-04-15", "no_data", 0, undefined);
  });

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
});
