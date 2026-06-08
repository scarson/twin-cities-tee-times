// ABOUTME: Weighted bin-packing for distributing courses across cron batches.
// ABOUTME: Balances subrequest cost (CPS=3, others=1) across 5 batches.
import type { CourseRow } from "@/types";

export const BATCH_COUNT = 5;

/**
 * Batch index reserved as the Chronogolf "lane". Every Chronogolf course is
 * assigned here so that only one cron invocation ever polls Chronogolf at a
 * time. Chronogolf enforces a per-IP rate limit shared across all concurrent
 * Worker invocations, so spreading Chronogolf across the staggered, overlapping
 * batches sums their request rates at the shared egress IP and trips HTTP 429.
 * Batch 0 is chosen because the batch-0-gated housekeeping/horizon probe also
 * issues Chronogolf requests — co-locating them keeps the single-lane invariant
 * intact across every code path.
 */
export const CHRONOGOLF_LANE = 0;

const CHRONOGOLF_PLATFORM = "chronogolf";

/**
 * Subrequest weight per platform. CPS Golf requires 3 external fetches
 * per date (token + register + tee times). All others require 1.
 */
export function platformWeight(platform: string): number {
  return platform === "cps_golf" ? 3 : 1;
}

/**
 * Per-platform recovery sleep after a cron pollCourse call. Chronogolf
 * rate-limits more aggressively than other providers — the 2026-04-20
 * catalog expansion surfaced this as a 59% 429 rate on the chronogolf
 * platform. Initial fix at 1500ms reduced the acute spike to 0% in a
 * short post-deploy window, but a follow-up 1-hour check found the
 * steady-state rate at 25% (still all 429s). Bumped to 2500ms per the
 * design doc's tuning rubric. Other platforms retain the 250ms default
 * we've used since launch; none have produced 429s in production.
 * See docs/plans/2026-04-20-chronogolf-rate-limit-fix.md.
 */
const SLEEP_AFTER_POLL_MS: Record<string, number> = {
  chronogolf: 2500,
};
const DEFAULT_SLEEP_AFTER_POLL_MS = 250;

export function sleepAfterPoll(platform: string): number {
  return SLEEP_AFTER_POLL_MS[platform] ?? DEFAULT_SLEEP_AFTER_POLL_MS;
}

/**
 * Distribute courses across BATCH_COUNT batches. Chronogolf courses are all
 * placed in the single dedicated lane (batch CHRONOGOLF_LANE); see that
 * constant for why. Every other platform is greedily bin-packed by subrequest
 * weight across the remaining batches — each course goes to the lowest-total-
 * weight batch (ties broken by lowest batch index). Courses are sorted by ID
 * first for deterministic assignment.
 */
export function assignBatches(courses: CourseRow[]): CourseRow[][] {
  const batches: CourseRow[][] = Array.from({ length: BATCH_COUNT }, () => []);
  const weights = new Array(BATCH_COUNT).fill(0);

  const sorted = [...courses].sort((a, b) => a.id.localeCompare(b.id));

  for (const course of sorted) {
    if (course.platform === CHRONOGOLF_PLATFORM) {
      batches[CHRONOGOLF_LANE].push(course);
      weights[CHRONOGOLF_LANE] += platformWeight(course.platform);
      continue;
    }

    // Bin-pack non-Chronogolf courses across the batches other than the lane:
    // pick the minimum-weight batch, lowest index breaking ties.
    let minIdx = -1;
    for (let i = 0; i < BATCH_COUNT; i++) {
      if (i === CHRONOGOLF_LANE) continue;
      if (minIdx === -1 || weights[i] < weights[minIdx]) {
        minIdx = i;
      }
    }
    batches[minIdx].push(course);
    weights[minIdx] += platformWeight(course.platform);
  }

  return batches;
}

const CRON_TO_BATCH: Record<string, number> = {
  "*/5 * * * *": 0,
  "1-56/5 * * * *": 1,
  "2-57/5 * * * *": 2,
  "3-58/5 * * * *": 3,
  "4-59/5 * * * *": 4,
};

/**
 * Map a cron expression string (from event.cron) to a batch index.
 */
export function cronToBatchIndex(cron: string): number {
  const index = CRON_TO_BATCH[cron];
  if (index === undefined) {
    throw new Error(`Unknown cron expression: ${cron}`);
  }
  return index;
}
