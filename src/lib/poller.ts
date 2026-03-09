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
  if (dayOffset <= 3) {
    // Offsets 2-3 (day after tomorrow + next): every 30 minutes
    return minutesSinceLastPoll >= 30;
  }
  // Days 5-7: twice daily (roughly every 10 hours)
  return minutesSinceLastPoll >= 600;
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
  date: string
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
    const teeTimes = await adapter.fetchTeeTimes(config, date);

    if (teeTimes.length === 0) {
      await logPoll(db, course.id, date, "no_data", 0, undefined);
      return "no_data";
    }

    const now = new Date().toISOString();
    await upsertTeeTimes(db, course.id, date, teeTimes, now);
    await logPoll(db, course.id, date, "success", teeTimes.length, undefined);
    return "success";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logPoll(db, course.id, date, "error", 0, message);
    return "error";
  }
}
