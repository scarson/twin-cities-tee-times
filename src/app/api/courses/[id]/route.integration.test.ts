// ABOUTME: Integration tests for the course detail SQL query.
// ABOUTME: Verifies single-course freshness lookup and handling of missing courses.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { logPoll, sqliteIsoNow } from "@/lib/db";

const COURSE_DETAIL_SQL = `
  SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
         p.polled_at as last_polled,
         p.status as last_poll_status
  FROM courses c
  LEFT JOIN (
    SELECT course_id, polled_at, status,
           ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
    FROM poll_log
    WHERE polled_at > ${sqliteIsoNow("-24 hours")}
      AND status IN ('success', 'no_data')
  ) p ON c.id = p.course_id AND p.rn = 1
  WHERE c.id = ?
`;

describe("course detail query", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("returns correct single-course freshness", async () => {
    await seedCourse(db, { id: "c1" });
    await logPoll(db, "c1", "2026-03-16", "success", 10);

    const result = await db.prepare(COURSE_DETAIL_SQL).bind("c1")
      .first<{ id: string; last_poll_status: string }>();

    expect(result).not.toBeNull();
    expect(result!.id).toBe("c1");
    expect(result!.last_poll_status).toBe("success");
  });

  it("non-existent course ID returns null", async () => {
    const result = await db.prepare(COURSE_DETAIL_SQL).bind("nonexistent").first();
    expect(result).toBeNull();
  });
});
