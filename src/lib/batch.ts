// ABOUTME: Weighted bin-packing for distributing courses across cron batches.
// ABOUTME: Balances subrequest cost (CPS=3, others=1) across 5 batches.
import type { CourseRow } from "@/types";

export const BATCH_COUNT = 5;

/**
 * Subrequest weight per platform. CPS Golf requires 3 external fetches
 * per date (token + register + tee times). All others require 1.
 */
export function platformWeight(platform: string): number {
  return platform === "cps_golf" ? 3 : 1;
}

/**
 * Per-platform recovery sleep after a cron pollCourse call. Chronogolf
 * rate-limits more aggressively than other providers (observed ~1 req/sec
 * ceiling per IP; the 2026-04-20 catalog expansion surfaced this as a 59%
 * 429 rate on the chronogolf platform). 1500ms post-Chronogolf keeps us
 * under that ceiling. Other platforms retain the 250ms default we've used
 * since launch; none of them have produced 429s in production.
 */
const SLEEP_AFTER_POLL_MS: Record<string, number> = {
  chronogolf: 1500,
};
const DEFAULT_SLEEP_AFTER_POLL_MS = 250;

export function sleepAfterPoll(platform: string): number {
  return SLEEP_AFTER_POLL_MS[platform] ?? DEFAULT_SLEEP_AFTER_POLL_MS;
}

/**
 * Distribute courses across BATCH_COUNT batches using greedy bin-packing
 * by platform weight. Courses are sorted by ID for determinism, then each
 * is assigned to the batch with the lowest total weight (ties broken by
 * lowest batch index).
 */
export function assignBatches(courses: CourseRow[]): CourseRow[][] {
  const batches: CourseRow[][] = Array.from({ length: BATCH_COUNT }, () => []);
  const weights = new Array(BATCH_COUNT).fill(0);

  const sorted = [...courses].sort((a, b) => a.id.localeCompare(b.id));

  for (const course of sorted) {
    // Find batch with minimum weight (lowest index breaks ties)
    let minIdx = 0;
    for (let i = 1; i < BATCH_COUNT; i++) {
      if (weights[i] < weights[minIdx]) {
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
