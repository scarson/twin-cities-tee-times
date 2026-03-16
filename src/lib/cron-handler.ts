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
