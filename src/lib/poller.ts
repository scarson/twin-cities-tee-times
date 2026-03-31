// ABOUTME: Core polling logic for fetching tee times from platform adapters.
// ABOUTME: Handles per-date polling frequency and result logging to poll_log.
import { getAdapter } from "@/adapters";
import { upsertTeeTimes, logPoll } from "@/lib/db";
// D1Database is a global type from @cloudflare/workers-types
import type { CourseRow, CourseConfig } from "@/types";

/**
 * Determine whether a given date offset should be polled this cycle.
 * @param dayOffset 0 = today, 1 = tomorrow, etc.
 * @param minutesSinceLastPoll minutes since this course+date was last polled
 */
export function shouldPollDate(
  dayOffset: number,
  minutesSinceLastPoll: number
): boolean {
  if (dayOffset <= 1) {
    // Today + tomorrow: always poll (frequency controlled by time-of-day cron)
    return true;
  }
  if (dayOffset <= 7) {
    // Days 2-7: every 30 minutes
    return minutesSinceLastPoll >= 30;
  }
  // Days 8+: hourly
  return minutesSinceLastPoll >= 60;
}

/**
 * Generate an array of 7 date strings starting from the given date.
 */
export function getPollingDates(todayStr: string): string[] {
  const dates: string[] = [];
  const [year, month, day] = todayStr.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(year, month - 1, day + i));
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

/**
 * Poll a single course for a single date.
 */
export async function pollCourse(
  db: D1Database,
  course: CourseRow,
  date: string,
  env?: CloudflareEnv
): Promise<"success" | "no_data" | "error"> {
  const adapter = getAdapter(course.platform);

  if (!adapter) {
    await logPoll(db, course.id, date, "error", 0, `No adapter for platform: ${course.platform}`);
    return "error";
  }

  const config: CourseConfig = {
    id: course.id,
    name: course.name,
    platform: course.platform,
    platformConfig: JSON.parse(course.platform_config),
    bookingUrl: course.booking_url,
  };

  try {
    const teeTimes = await adapter.fetchTeeTimes(config, date, env);
    const now = new Date().toISOString();

    // Always upsert — when empty, this deletes stale rows so we don't
    // show ghost availability from a previous poll.
    await upsertTeeTimes(db, course.id, date, teeTimes, now);

    const status = teeTimes.length === 0 ? "no_data" : "success";
    await logPoll(db, course.id, date, status, teeTimes.length, undefined);
    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await logPoll(db, course.id, date, "error", 0, message);
    } catch (logErr) {
      console.error(`Failed to log poll error for ${course.id}:`, logErr);
    }
    return "error";
  }
}
