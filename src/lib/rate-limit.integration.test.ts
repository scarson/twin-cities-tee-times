// ABOUTME: Integration tests for rate-limit SQL queries against real SQLite.
// ABOUTME: Verifies per-course cooldown and global rate cap using sqliteIsoNow.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { checkRefreshAllowed } from "./rate-limit";

describe("checkRefreshAllowed", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "c1" });
    await seedCourse(db, { id: "c2", name: "Course 2" });
  });

  it("allows refresh when no recent polls exist", async () => {
    const result = await checkRefreshAllowed(db, "c1");
    expect(result).toEqual({ allowed: true });
  });

  it("rejects refresh within per-course cooldown", async () => {
    // Insert a poll from right now
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("c1", "2026-03-16", new Date().toISOString(), "success", 5)
      .run();

    const result = await checkRefreshAllowed(db, "c1");
    expect(result.allowed).toBe(false);
  });

  it("allows refresh after cooldown expires", async () => {
    // Insert a poll from 31 seconds ago
    const oldTime = new Date(Date.now() - 31 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("c1", "2026-03-16", oldTime, "success", 5)
      .run();

    const result = await checkRefreshAllowed(db, "c1");
    expect(result).toEqual({ allowed: true });
  });

  it("rejects when global rate cap is exceeded", async () => {
    // Insert 21 polls from different courses within the last 60 seconds
    const now = new Date();
    for (let i = 0; i < 21; i++) {
      const courseId = i % 2 === 0 ? "c1" : "c2";
      const t = new Date(now.getTime() - i * 1000).toISOString(); // stagger by 1 second
      await db
        .prepare(
          "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(courseId, `2026-03-${16 + i}`, t, "success", 3)
        .run();
    }

    // Use a different course to avoid per-course cooldown
    await seedCourse(db, { id: "c3", name: "Course 3" });
    const result = await checkRefreshAllowed(db, "c3");
    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toContain("busy");
  });
});
