// ABOUTME: D1 database helpers for upserting tee times and logging poll attempts.
// ABOUTME: Uses batch transactions for atomic delete+insert of tee time data.
import type { TeeTime } from "@/types";

// D1Database, D1PreparedStatement, etc. are global types from
// @cloudflare/workers-types (included by the Cloudflare scaffold in tsconfig).
// No import needed — they're ambient.

/**
 * Replace all tee times for a course+date in a single transaction.
 * DELETEs existing rows, INSERTs fresh results.
 */
export async function upsertTeeTimes(
  db: D1Database,
  courseId: string,
  date: string,
  teeTimes: TeeTime[],
  fetchedAt: string
): Promise<void> {
  const deleteStmt = db
    .prepare("DELETE FROM tee_times WHERE course_id = ? AND date = ?")
    .bind(courseId, date);

  const insertStmts = teeTimes.map((tt) => {
    const timeOnly = tt.time.includes("T")
      ? tt.time.split("T")[1].substring(0, 5)
      : tt.time;
    return db
      .prepare(
        `INSERT INTO tee_times (course_id, date, time, price, holes, open_slots, booking_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        courseId,
        date,
        timeOnly,
        tt.price,
        tt.holes,
        tt.openSlots,
        tt.bookingUrl,
        fetchedAt
      );
  });

  await db.batch([deleteStmt, ...insertStmts]);
}

/**
 * Log a poll attempt for debugging and freshness display.
 */
export async function logPoll(
  db: D1Database,
  courseId: string,
  date: string,
  status: "success" | "error" | "no_data",
  teeTimeCount: number,
  errorMessage?: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(courseId, date, new Date().toISOString(), status, teeTimeCount, errorMessage ?? null)
    .run();
}

/**
 * SQL fragment for ISO 8601 "now" timestamps compatible with JS toISOString().
 *
 * SQLite's datetime() returns "YYYY-MM-DD HH:MM:SS" (space separator) but
 * JS toISOString() returns "YYYY-MM-DDTHH:MM:SS.sssZ" (T separator).
 * Lexicographic comparisons between these formats produce wrong results
 * because 'T' (ASCII 84) > ' ' (ASCII 32).
 *
 * This helper returns a strftime() expression that produces ISO 8601 format,
 * ensuring correct comparisons with stored JS timestamps.
 */
export function sqliteIsoNow(modifier?: string): string {
  if (modifier) {
    return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${modifier}')`;
  }
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}
