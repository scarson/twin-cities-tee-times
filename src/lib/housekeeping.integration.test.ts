// ABOUTME: Integration tests for housekeeping functions extracted from cron handler.
// ABOUTME: Tests poll_log cleanup, course auto-deactivation, and session cleanup against real SQLite.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, seedUser } from "@/test/d1-test-helper";
import { cleanupOldPolls, deactivateStaleCourses, cleanupExpiredSessions } from "./db";

describe("cleanupOldPolls", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("deletes poll_log entries older than 7 days", async () => {
    await seedCourse(db);

    // Insert an old poll (8 days ago)
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("test-course", "2026-03-08", oldDate, "success", 5)
      .run();

    // Insert a recent poll (1 hour ago)
    const recentDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("test-course", "2026-03-16", recentDate, "success", 3)
      .run();

    const deleted = await cleanupOldPolls(db);
    expect(deleted).toBe(1);

    const remaining = await db
      .prepare("SELECT COUNT(*) as cnt FROM poll_log")
      .bind()
      .first<{ cnt: number }>();
    expect(remaining!.cnt).toBe(1);
  });
});

describe("deactivateStaleCourses", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("deactivates course with last_had_tee_times > 30 days ago", async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await seedCourse(db, { id: "stale", last_had_tee_times: oldDate });

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(1);

    const course = await db
      .prepare("SELECT is_active FROM courses WHERE id = ?")
      .bind("stale")
      .first<{ is_active: number }>();
    expect(course!.is_active).toBe(0);
  });

  it("does NOT deactivate a never-polled course with last_had_tee_times IS NULL", async () => {
    await seedCourse(db, { id: "new-course", last_had_tee_times: null });

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(0);

    const course = await db
      .prepare("SELECT is_active FROM courses WHERE id = ?")
      .bind("new-course")
      .first<{ is_active: number }>();
    expect(course!.is_active).toBe(1);
  });

  it("deactivates a never-successful course whose polling started over 3 days ago", async () => {
    await seedCourse(db, { id: "never-had-data", last_had_tee_times: null });
    const oldPoll = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("never-had-data", "2026-07-08", oldPoll, "no_data", 0)
      .run();

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(1);

    const course = await db
      .prepare("SELECT is_active FROM courses WHERE id = ?")
      .bind("never-had-data")
      .first<{ is_active: number }>();
    expect(course!.is_active).toBe(0);
  });

  it("does NOT deactivate a never-successful course polled only within the last 3 days", async () => {
    await seedCourse(db, { id: "recently-added", last_had_tee_times: null });
    const recentPoll = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("recently-added", "2026-07-11", recentPoll, "no_data", 0)
      .run();

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(0);

    const course = await db
      .prepare("SELECT is_active FROM courses WHERE id = ?")
      .bind("recently-added")
      .first<{ is_active: number }>();
    expect(course!.is_active).toBe(1);
  });

  it("does NOT deactivate already-inactive courses", async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await seedCourse(db, { id: "inactive", is_active: 0, last_had_tee_times: oldDate });

    const count = await deactivateStaleCourses(db);
    expect(count).toBe(0);
  });
});

describe("cleanupExpiredSessions", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("deletes expired sessions, preserves active ones", async () => {
    await seedUser(db);

    const now = new Date();
    const pastDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // tomorrow

    // Expired session
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind("expired-hash", "test-user", pastDate, now.toISOString())
      .run();

    // Active session
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind("active-hash", "test-user", futureDate, now.toISOString())
      .run();

    const deleted = await cleanupExpiredSessions(db);
    expect(deleted).toBe(1);

    const remaining = await db
      .prepare("SELECT COUNT(*) as cnt FROM sessions")
      .bind()
      .first<{ cnt: number }>();
    expect(remaining!.cnt).toBe(1);
  });
});
