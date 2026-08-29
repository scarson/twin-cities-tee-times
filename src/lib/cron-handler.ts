// ABOUTME: Cron polling orchestrator that distributes courses across 5 batched invocations.
// ABOUTME: Uses weighted bin-packing, date-priority loop ordering, and subrequest budget tracking.
import { pollCourse, shouldPollDate, getPollingDates, MAX_HORIZON, PROBE_INTERVAL_DAYS } from "@/lib/poller";
import { sqliteIsoNow, logPoll, cleanupOldPolls, cleanupPastTeeTimes, deactivateStaleCourses, cleanupExpiredSessions } from "@/lib/db";
import { assignBatches, cronToBatchIndex, platformWeight, sleepAfterPoll, CHRONOGOLF_LANE } from "@/lib/batch";
import { todayCT } from "@/lib/format";
import type { CourseRow } from "@/types";

export const SUBREQUEST_BUDGET = 500; // Paid plan allows 10,000; headroom for ~80 courses

/**
 * Wall-clock budget for each Chronogolf lane invocation. 3.5 min leaves margin
 * under the 5-min peak cron period, so active polling or horizon maintenance
 * never runs past the lane's next firing and creates cross-invocation overlap.
 * At the adapter's ~4s/request spacing that's ≤ ~52 requests/cycle;
 * oldest-first ordering rotates which course/date pairs get covered each cycle.
 * See docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md (Volume Math)
 * and docs/plans/2026-07-12-chronogolf-429-backoff.md (measured rate ceiling).
 */
export const CHRONOGOLF_LANE_BUDGET_MS = 210_000;

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

export function shouldRunHorizonMaintenance(scheduledAt: Date, batchIndex: number): boolean {
  if (batchIndex !== CHRONOGOLF_LANE || scheduledAt.getMinutes() !== 30) {
    return false;
  }

  const centralHour = parseInt(
    scheduledAt.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    })
  );

  return centralHour >= 20 || centralHour < 5;
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
  budget: { remaining: number; deadlineMs?: number },
  env?: CloudflareEnv
): Promise<{
  probeCount: number;
  updatedCourses: string[];
  completedCourses: string[];
  partialCourses: string[];
}> {
  let probeCount = 0;
  const updatedCourses: string[] = [];
  const completedCourses: string[] = [];
  const partialCourses: string[] = [];
  const deadlineMs = budget.deadlineMs ?? Infinity;

  for (const course of courses) {
    try {
      let maxFound = course.booking_horizon_days;
      let completed = true;

      const weight = platformWeight(course.platform);
      const [year, month, day] = todayStr.split("-").map(Number);

      for (let dayOffset = course.booking_horizon_days; dayOffset < MAX_HORIZON; dayOffset++) {
        if (budget.remaining < weight || Date.now() >= deadlineMs) {
          completed = false;
          break;
        }

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

      if (!completed) {
        partialCourses.push(course.id);
        break;
      }

      await db
        .prepare("UPDATE courses SET last_horizon_probe = ? WHERE id = ?")
        .bind(new Date().toISOString(), course.id)
        .run();
      completedCourses.push(course.id);
    } catch (err) {
      console.error(`Horizon probe error for course ${course.id}:`, err);
      partialCourses.push(course.id);
    }
  }

  return { probeCount, updatedCourses, completedCourses, partialCourses };
}

/**
 * Check whether v4 CPS Golf courses have upgraded to v5.
 * Tries the v5 token endpoint for each unique subdomain.
 * If it returns 200, removes authType from platform_config.
 *
 * Caveat: the token endpoint (/identityapi/) is NOT behind CPS's Cloudflare
 * bot-challenge, but the v5 reservation API (/onlineres/) IS, and is only
 * reachable through the impersonating fetch proxy (see lambda/fetch-proxy).
 * So a token-200 here proves the identity service is on v5, not that the
 * reservation API is currently reachable. If the proxy's impersonation profile
 * ages out of Cloudflare's allowlist, a promoted course's v5 polls fail with
 * the distinct "blocked by Cloudflare challenge" error until the profile is
 * refreshed; promotion is not auto-reverted. The canary makes that visible in
 * poll_log. The remaining v4 population is small and promotion is gated on CPS
 * migrating a facility, so this is accepted rather than gating promotion on a
 * full proxied reservation probe.
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
 * A subrequest budget tracker (SUBREQUEST_BUDGET) caps work per invocation, well
 * under the paid plan's 10,000-subrequest-per-invocation platform limit.
 *
 * Housekeeping (cleanup, auto-deactivation) runs only in batch 0.
 */
export async function runCronPoll(
  env: CloudflareEnv,
  cronExpression: string,
  opts: { chronogolfLaneBudgetMs?: number; scheduledTimeMs?: number } = {}
): Promise<{
  pollCount: number;
  courseCount: number;
  inactiveProbeCount: number;
  skipped: boolean;
  batchIndex: number;
  budgetExhausted: boolean;
}> {
  const batchIndex = cronToBatchIndex(cronExpression);
  const scheduledAt = new Date(opts.scheduledTimeMs ?? Date.now());
  const operationalNow = new Date();

  if (shouldRunHorizonMaintenance(scheduledAt, batchIndex)) {
    try {
      const db = env.DB;
      const laneBudgetMs = opts.chronogolfLaneBudgetMs ?? CHRONOGOLF_LANE_BUDGET_MS;
      const laneDeadline = Date.now() + laneBudgetMs;
      const eligibleForProbe = await db
        .prepare(
          `SELECT * FROM courses
           WHERE disabled = 0 AND is_active = 1
             AND (last_horizon_probe IS NULL OR last_horizon_probe < ${sqliteIsoNow(`-${PROBE_INTERVAL_DAYS} days`)})
           ORDER BY CASE WHEN last_horizon_probe IS NULL THEN 0 ELSE 1 END,
                    last_horizon_probe ASC,
                    id ASC`
        )
        .all<CourseRow>();

      const probeResult = await runHorizonProbe(
        db,
        eligibleForProbe.results,
        todayCT(scheduledAt),
        { remaining: SUBREQUEST_BUDGET, deadlineMs: laneDeadline },
        env
      );

      console.log(
        `Horizon maintenance: eligible=${eligibleForProbe.results.length}, completed=${probeResult.completedCourses.length}, partial=${probeResult.partialCourses.length}, probes=${probeResult.probeCount}, partial_ids=${probeResult.partialCourses.join(",") || "none"}`
      );

      return {
        pollCount: probeResult.probeCount,
        courseCount: eligibleForProbe.results.length,
        inactiveProbeCount: 0,
        skipped: false,
        batchIndex,
        budgetExhausted: false,
      };
    } catch (err) {
      console.error("Horizon maintenance fatal error:", err);
      return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: false, batchIndex, budgetExhausted: false };
    }
  }

  if (!shouldRunThisCycle(scheduledAt)) {
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

    const todayStr = todayCT(scheduledAt);
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

    // Chronogolf lane: bound total wall-clock so the lane never runs past its own
    // next cron firing (which would re-introduce the cross-invocation concurrency
    // this fix removes), and poll least-recently-polled course/date pairs first so
    // that deadline truncation rotates coverage fairly across courses. Non-lane
    // batches get an Infinity deadline → these guards are no-ops for them.
    const inLane = batchIndex === CHRONOGOLF_LANE;
    const laneBudgetMs = opts.chronogolfLaneBudgetMs ?? CHRONOGOLF_LANE_BUDGET_MS;
    const laneDeadline = inLane ? Date.now() + laneBudgetMs : Infinity;
    let laneTimeUp = false;
    const laneExpired = (): boolean => {
      if (!laneTimeUp && Date.now() > laneDeadline) {
        laneTimeUp = true;
        console.warn(
          `Batch ${batchIndex}: chronogolf lane time budget reached (${laneBudgetMs}ms), deferring remaining polls`
        );
      }
      return laneTimeUp;
    };
    const lastPolledMs = (course: CourseRow, date: string): number => {
      const lp = pollTimeMap.get(`${course.id}:${date}`);
      return lp ? new Date(lp).getTime() : 0; // never-polled (0) sorts first
    };

    // --- Active courses: date-outer, course-inner ---
    for (let i = 0; i < dates.length && !budgetExhausted; i++) {
      if (laneExpired()) break;
      // In the lane, poll the least-recently-polled courses for this date first.
      const orderedCourses = inLane
        ? [...activeCourses].sort((a, b) => lastPolledMs(a, dates[i]) - lastPolledMs(b, dates[i]))
        : activeCourses;
      for (const course of orderedCourses) {
        if (laneExpired()) break;
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
              .bind(operationalNow.toISOString(), course.id)
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
      if (budgetExhausted || laneExpired()) break;

      try {
        const lastProbed = pollTimeMap.get(`${course.id}:${probeDates[0]}`);
        const minutesSinceProbe = lastProbed
          ? (Date.now() - new Date(lastProbed).getTime()) / 60000
          : Infinity;

        if (minutesSinceProbe < 60) continue;

        let foundTeeTimes = false;

        for (const date of probeDates) {
          if (laneExpired()) break;
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
            .bind(operationalNow.toISOString(), course.id)
            .run();
          console.log(`Auto-activated course ${course.id}: tee times detected`);
        }
      } catch (err) {
        console.error(`Error probing inactive course ${course.id}:`, err);
      }
    }

    // --- Housekeeping: runs only in the lane batch ---
    // The cleanup tasks are batch-agnostic and ride along with batch 0.
    if (batchIndex === CHRONOGOLF_LANE) {
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
        const deletedTeeTimes = await cleanupPastTeeTimes(db, todayStr);
        if (deletedTeeTimes > 0) {
          console.log(`Cleaned up ${deletedTeeTimes} past-date tee_times rows`);
        }
      } catch (err) {
        console.error("tee_times cleanup error:", err);
      }

      try {
        const deletedSessions = await cleanupExpiredSessions(db);
        if (deletedSessions > 0) {
          console.log(`Cleaned up ${deletedSessions} expired session(s)`);
        }
      } catch (err) {
        console.error("session cleanup error:", err);
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
