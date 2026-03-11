// ABOUTME: Server-side rate limiting for the refresh endpoint.
// ABOUTME: Enforces per-course cooldown and global poll rate cap using poll_log.
import { sqliteIsoNow } from "@/lib/db";

export const COURSE_COOLDOWN_SECONDS = 30;
export const GLOBAL_MAX_PER_MINUTE = 20;

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export async function checkRefreshAllowed(
  db: D1Database,
  courseId: string
): Promise<RateLimitResult> {
  // Per-course cooldown: any date
  // Note: COURSE_COOLDOWN_SECONDS is interpolated (not bound) because SQLite's
  // strftime() modifier string cannot accept parameter bindings. The value is a
  // module-level constant, not user input.
  const recentPoll = await db
    .prepare(
      `SELECT polled_at FROM poll_log
       WHERE course_id = ? AND polled_at > ${sqliteIsoNow(`-${COURSE_COOLDOWN_SECONDS} seconds`)}
       ORDER BY polled_at DESC LIMIT 1`
    )
    .bind(courseId)
    .first<{ polled_at: string }>();

  if (recentPoll) {
    return { allowed: false, reason: "This course was recently refreshed" };
  }

  // Global rate limit: total polls across all courses in last 60 seconds
  const globalCount = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM poll_log
       WHERE polled_at > ${sqliteIsoNow("-60 seconds")}`
    )
    .bind()
    .first<{ cnt: number }>();

  if (globalCount && globalCount.cnt > GLOBAL_MAX_PER_MINUTE) {
    return { allowed: false, reason: "Server is busy, try again shortly" };
  }

  return { allowed: true };
}
