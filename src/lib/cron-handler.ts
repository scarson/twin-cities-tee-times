// ABOUTME: Cron polling orchestrator that distributes courses across 5 batched invocations.
// ABOUTME: Uses weighted bin-packing, date-priority loop ordering, and subrequest budget tracking.
import { pollCourse, shouldPollDate, getPollingDates, MAX_HORIZON, PROBE_INTERVAL_DAYS } from "@/lib/poller";
import { sqliteIsoNow, logPoll, cleanupOldPolls, deactivateStaleCourses, cleanupExpiredSessions } from "@/lib/db";
import { assignBatches, cronToBatchIndex, platformWeight, sleepAfterPoll } from "@/lib/batch";
import type { CourseRow } from "@/types";

export const SUBREQUEST_BUDGET = 500; // Paid plan allows 10,000; headroom for ~80 courses

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
 * Probe dates beyond each course's known booking horizon to detect extended availability.
 * Runs weekly per course, ratchets horizon up (never down).
 */
export async function runHorizonProbe(
  db: D1Database,
  courses: CourseRow[],
  todayStr: string,
  budget: { remaining: number },
  env?: CloudflareEnv
): Promise<{ probeCount: number; updatedCourses: string[] }> {
  let probeCount = 0;
  const updatedCourses: string[] = [];

  for (const course of courses) {
    if (budget.remaining <= 0) break;

    try {
      let maxFound = course.booking_horizon_days;

      const weight = platformWeight(course.platform);
      const [year, month, day] = todayStr.split("-").map(Number);

      for (let dayOffset = course.booking_horizon_days; dayOffset < MAX_HORIZON; dayOffset++) {
        if (budget.remaining < weight) break;

        const d = new Date(Date.UTC(year, month - 1, day + dayOffset));
        const dateStr = d.toISOString().split("T")[0];

        try {
          const status = await pollCourse(db, course, dateStr, env);
          probeCount++;
          budget.remaining -= weight;

          if (status === "success" && dayOffset + 1 > maxFound) {
            maxFound = dayOffset + 1;
          }
        } catch (err) {
          console.error(`Horizon probe error for ${course.id} on ${dateStr}:`, err);
          probeCount++;
          budget.remaining -= weight;
        }

        await sleep(sleepAfterPoll(course.platform));
      }

      if (maxFound > course.booking_horizon_days) {
        await db
          .prepare("UPDATE courses SET booking_horizon_days = ? WHERE id = ? AND booking_horizon_days < ?")
          .bind(maxFound, course.id, maxFound)
          .run();
        updatedCourses.push(course.id);
        console.log(`Horizon probe: ${course.id} extended to ${maxFound} days`);
      }

      await db
        .prepare("UPDATE courses SET last_horizon_probe = ? WHERE id = ?")
        .bind(new Date().toISOString(), course.id)
        .run();
    } catch (err) {
      console.error(`Horizon probe error for course ${course.id}:`, err);
    }
  }

  return { probeCount, updatedCourses };
}

/**
 * Check whether v4 CPS Golf courses have upgraded to v5.
 * Tries the v5 token endpoint for each unique subdomain.
 * If it returns 200, removes authType from platform_config.
 */
export async function checkV4Upgrades(
  db: D1Database,
  courses: CourseRow[]
): Promise<string[]> {
  const v4Courses = courses.filter((c) => {
    if (c.platform !== "cps_golf") return false;
    const config = JSON.parse(c.platform_config);
    return config.authType === "v4";
  });

  if (v4Courses.length === 0) return [];

  const bySubdomain = new Map<string, CourseRow[]>();
  for (const course of v4Courses) {
    const config = JSON.parse(course.platform_config);
    const existing = bySubdomain.get(config.subdomain) ?? [];
    existing.push(course);
    bySubdomain.set(config.subdomain, existing);
  }

  const upgraded: string[] = [];

  for (const [subdomain, subdomainCourses] of bySubdomain) {
    try {
      const url = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "client_id=onlinereswebshortlived",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) continue;

      for (const course of subdomainCourses) {
        const config = JSON.parse(course.platform_config);
        delete config.authType;
        await db
          .prepare("UPDATE courses SET platform_config = ? WHERE id = ?")
          .bind(JSON.stringify(config), course.id)
          .run();
        upgraded.push(course.id);
      }

      console.log(`CPS v4→v5 upgrade detected: ${subdomain} (${subdomainCourses.map((c) => c.id).join(", ")})`);
    } catch (err) {
      console.error(`v4→v5 check failed for ${subdomain}:`, err);
    }
  }

  return upgraded;
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
      .prepare("SELECT * FROM courses WHERE disabled = 0")
      .all<CourseRow>();
    const allCourses = coursesResult.results;
    const batches = assignBatches(allCourses);
    const batchCourses = batches[batchIndex];

    const activeCourses = batchCourses.filter((c) => c.is_active === 1);
    const inactiveCourses = batchCourses.filter((c) => c.is_active === 0);

    const todayStr = now.toLocaleDateString("en-CA", {
      timeZone: "America/Chicago",
    }); // YYYY-MM-DD
    const dates = getPollingDates(todayStr, MAX_HORIZON);

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
        if (i >= course.booking_horizon_days) continue;
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

        await sleep(sleepAfterPoll(course.platform));
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

          try {
            const status = await pollCourse(db, course, date, env);
            inactiveProbeCount++;
            budget -= weight;

            if (status === "success") {
              foundTeeTimes = true;
            }
          } catch (probeErr) {
            console.error(`Error probing inactive course ${course.id} for ${date}:`, probeErr);
            inactiveProbeCount++;
            budget -= weight;
          }

          await sleep(sleepAfterPoll(course.platform));
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
        const deactivatedCount = await deactivateStaleCourses(db);
        if (deactivatedCount > 0) {
          console.log(`Auto-deactivated ${deactivatedCount} course(s): no tee times for 30 days`);
        }
      } catch (err) {
        console.error("Auto-deactivation error:", err);
      }

      try {
        const deletedPolls = await cleanupOldPolls(db);
        if (deletedPolls > 0) {
          console.log(`Cleaned up ${deletedPolls} old poll_log entries`);
        }
      } catch (err) {
        console.error("poll_log cleanup error:", err);
      }

      try {
        const deletedSessions = await cleanupExpiredSessions(db);
        if (deletedSessions > 0) {
          console.log(`Cleaned up ${deletedSessions} expired session(s)`);
        }
      } catch (err) {
        console.error("session cleanup error:", err);
      }

      // --- Horizon probe: weekly check for courses publishing beyond their known horizon ---
      try {
        const eligibleForProbe = await db
          .prepare(
            `SELECT * FROM courses
             WHERE disabled = 0 AND is_active = 1
               AND (last_horizon_probe IS NULL OR last_horizon_probe < ${sqliteIsoNow(`-${PROBE_INTERVAL_DAYS} days`)})`
          )
          .all<CourseRow>();

        if (eligibleForProbe.results.length > 0) {
          const probeResult = await runHorizonProbe(
            db,
            eligibleForProbe.results,
            todayStr,
            { remaining: budget },
            env
          );

          if (probeResult.updatedCourses.length > 0) {
            console.log(`Horizon probe: updated ${probeResult.updatedCourses.length} course(s)`);
          }
        }
      } catch (err) {
        console.error("Horizon probe error:", err);
      }

      // --- v4→v5 auto-detection: check if v4 CPS courses have upgraded ---
      try {
        const upgradedCourses = await checkV4Upgrades(db, allCourses);
        if (upgradedCourses.length > 0) {
          console.log(`Auto-upgraded ${upgradedCourses.length} course(s) from CPS v4 to v5`);
        }
      } catch (err) {
        console.error("v4→v5 upgrade check error:", err);
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
