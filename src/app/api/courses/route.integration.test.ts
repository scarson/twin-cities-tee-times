// ABOUTME: Integration tests for the courses list SQL query.
// ABOUTME: Verifies ROW_NUMBER window function, freshness filtering, and no_data status handling.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { logPoll, sqliteIsoNow } from "@/lib/db";

// This is the exact SQL from src/app/api/courses/route.ts
const COURSES_LIST_SQL = `
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
  WHERE c.disabled = 0
  ORDER BY c.state DESC, c.name ASC
`;

describe("courses list query", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("ROW_NUMBER returns only the most recent poll per course", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await logPoll(db, "c1", "2026-03-16", "success", 3);
    await logPoll(db, "c1", "2026-03-16", "success", 5);

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string; last_polled: string; last_poll_status: string;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1).toBeDefined();
    expect(c1!.last_poll_status).toBe("success");
    expect(result.results.filter((r) => r.id === "c1")).toHaveLength(1);
  });

  it("no_data status polls appear in freshness results", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await logPoll(db, "c1", "2026-03-16", "no_data", 0);

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string; last_poll_status: string;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1!.last_poll_status).toBe("no_data");
  });

  it("multiple courses with mixed statuses return correct per-course freshness", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await seedCourse(db, { id: "c2", name: "Bravo" });
    await logPoll(db, "c1", "2026-03-16", "success", 10);
    await logPoll(db, "c2", "2026-03-16", "no_data", 0);

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string; last_poll_status: string;
    }>();

    expect(result.results.find((r) => r.id === "c1")!.last_poll_status).toBe("success");
    expect(result.results.find((r) => r.id === "c2")!.last_poll_status).toBe("no_data");
  });

  it("polls older than 24 hours are excluded", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await db
      .prepare("INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)")
      .bind("c1", "2026-03-15", oldTime, "success", 5)
      .run();

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string; last_polled: string | null;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1!.last_polled).toBeNull();
  });

  it("course with zero poll history has null freshness fields", async () => {
    await seedCourse(db, { id: "c1", name: "Alpha" });

    const result = await db.prepare(COURSES_LIST_SQL).all<{
      id: string; last_polled: string | null; last_poll_status: string | null;
    }>();

    const c1 = result.results.find((r) => r.id === "c1");
    expect(c1!.last_polled).toBeNull();
    expect(c1!.last_poll_status).toBeNull();
  });

  it("excludes disabled courses from results", async () => {
    await seedCourse(db, { id: "c1", name: "Active Course", disabled: 0 });
    await seedCourse(db, { id: "c2", name: "Disabled Course", disabled: 1 });

    const result = await db.prepare(COURSES_LIST_SQL).all<{ id: string }>();

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("c1");
  });

  it("sorts MN courses before CA courses", async () => {
    await seedCourse(db, { id: "ca1", name: "Alpha", state: "CA" });
    await seedCourse(db, { id: "mn1", name: "Zulu", state: "MN" });

    const result = await db.prepare(COURSES_LIST_SQL).all<{ id: string }>();

    expect(result.results).toHaveLength(2);
    expect(result.results[0].id).toBe("mn1");
    expect(result.results[1].id).toBe("ca1");
  });
});
