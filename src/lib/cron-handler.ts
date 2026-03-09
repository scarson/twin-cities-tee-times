import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
// D1Database is a global type from @cloudflare/workers-types
import type { CourseRow } from "@/types";

/**
 * Determine whether this 5-minute cron invocation should actually poll,
 * based on current Central Time hour.
 *
 * Cron fires every 5 min. Effective intervals:
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

/**
 * Sleep helper for rate limiting between API calls.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main cron polling logic. Called by the Worker's scheduled() handler.
 */
export async function runCronPoll(db: D1Database): Promise<{
  pollCount: number;
  courseCount: number;
  skipped: boolean;
}> {
  const now = new Date();

  if (!shouldRunThisCycle(now)) {
    return { pollCount: 0, courseCount: 0, skipped: true };
  }

  const coursesResult = await db
    .prepare("SELECT * FROM courses WHERE is_active = 1")
    .all<CourseRow>();
  const courses = coursesResult.results;

  const todayStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  }); // YYYY-MM-DD
  const dates = getPollingDates(todayStr);

  // Batch-fetch the most recent poll time for every course+date combo (one query)
  const recentPolls = await db
    .prepare(
      `SELECT course_id, date, MAX(polled_at) as last_polled
       FROM poll_log
       WHERE polled_at > datetime('now', '-24 hours')
       GROUP BY course_id, date`
    )
    .all<{ course_id: string; date: string; last_polled: string }>();

  const pollTimeMap = new Map<string, string>();
  for (const row of recentPolls.results) {
    pollTimeMap.set(`${row.course_id}:${row.date}`, row.last_polled);
  }

  let pollCount = 0;

  for (const course of courses) {
    try {
      for (let i = 0; i < dates.length; i++) {
        const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
        const minutesSinceLast = lastPolled
          ? (Date.now() - new Date(lastPolled).getTime()) / 60000
          : Infinity;

        if (shouldPollDate(i, minutesSinceLast)) {
          await pollCourse(db, course, dates[i]);
          pollCount++;

          // Rate limit: CPS Golf allows 5 req/sec. 250ms between requests
          // gives ~4 req/sec with headroom. ForeUp has no known limit but
          // being polite doesn't hurt.
          await sleep(250);
        }
      }
    } catch (err) {
      console.error(`Error polling course ${course.id}:`, err);
    }
  }

  // Purge poll_log entries older than 7 days to prevent unbounded growth
  try {
    await db
      .prepare("DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')")
      .run();
  } catch (err) {
    console.error("poll_log cleanup error:", err);
  }

  return { pollCount, courseCount: courses.length, skipped: false };
}
