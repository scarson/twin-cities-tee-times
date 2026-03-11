// ABOUTME: Cron polling orchestrator that runs on a 5-minute schedule.
// ABOUTME: Controls polling frequency by time of day and polls active courses via adapters.
import { pollCourse, shouldPollDate, getPollingDates } from "@/lib/poller";
import { sqliteIsoNow } from "@/lib/db";
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
 *
 * Two-tier polling:
 * - Active courses: full 7-date polling at dynamic frequency
 * - Inactive courses: hourly probe of today + tomorrow to detect reopening
 */
export async function runCronPoll(db: D1Database): Promise<{
  pollCount: number;
  courseCount: number;
  inactiveProbeCount: number;
  skipped: boolean;
}> {
  const now = new Date();

  if (!shouldRunThisCycle(now)) {
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: true };
  }

  try {
    // Fetch ALL courses (active and inactive)
    const coursesResult = await db
      .prepare("SELECT * FROM courses")
      .all<CourseRow>();
    const allCourses = coursesResult.results;

    const activeCourses = allCourses.filter((c) => c.is_active === 1);
    const inactiveCourses = allCourses.filter((c) => c.is_active === 0);

    const todayStr = now.toLocaleDateString("en-CA", {
      timeZone: "America/Chicago",
    }); // YYYY-MM-DD
    const dates = getPollingDates(todayStr);

    // Batch-fetch the most recent poll time for every course+date combo (one query)
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

    // --- Active courses: full 7-date polling at dynamic frequency ---
    for (const course of activeCourses) {
      for (let i = 0; i < dates.length; i++) {
        const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
        const minutesSinceLast = lastPolled
          ? (Date.now() - new Date(lastPolled).getTime()) / 60000
          : Infinity;

        if (shouldPollDate(i, minutesSinceLast)) {
          try {
            const status = await pollCourse(db, course, dates[i]);
            pollCount++;

            if (status === "success") {
              await db
                .prepare("UPDATE courses SET last_had_tee_times = ? WHERE id = ?")
                .bind(now.toISOString(), course.id)
                .run();
            }
          } catch (err) {
            console.error(`Error polling ${course.id} for ${dates[i]}:`, err);
            pollCount++;
          }

          await sleep(250);
        }
      }
    }

    // --- Inactive courses: hourly probe of today + tomorrow ---
    const probeDates = dates.slice(0, 2); // today + tomorrow

    for (const course of inactiveCourses) {
      try {
        // Check if this course was probed in the last hour
        const lastProbed = pollTimeMap.get(`${course.id}:${probeDates[0]}`);
        const minutesSinceProbe = lastProbed
          ? (Date.now() - new Date(lastProbed).getTime()) / 60000
          : Infinity;

        if (minutesSinceProbe < 60) continue;

        let foundTeeTimes = false;

        for (const date of probeDates) {
          const status = await pollCourse(db, course, date);
          inactiveProbeCount++;

          if (status === "success") {
            foundTeeTimes = true;
          }

          await sleep(250);
        }

        // Auto-promote: flip to active if tee times were found
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

    // --- Auto-deactivate: courses with no tee times for 30 days ---
    // Safe after auto-promote: just-promoted courses have fresh last_had_tee_times,
    // so they won't match the stale-tee-times condition.
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

    // Purge poll_log entries older than 7 days to prevent unbounded growth
    try {
      await db
        .prepare(`DELETE FROM poll_log WHERE polled_at < ${sqliteIsoNow("-7 days")}`)
        .run();
    } catch (err) {
      console.error("poll_log cleanup error:", err);
    }

    // Remove expired sessions
    try {
      await db
        .prepare(`DELETE FROM sessions WHERE expires_at < ${sqliteIsoNow()}`)
        .run();
    } catch (err) {
      console.error("session cleanup error:", err);
    }

    return { pollCount, courseCount: activeCourses.length, inactiveProbeCount, skipped: false };
  } catch (err) {
    console.error("Cron poll fatal error:", err);
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: false };
  }
}
