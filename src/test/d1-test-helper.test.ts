// ABOUTME: Tests for the D1-compatible SQLite wrapper used in integration tests.
// ABOUTME: Verifies the wrapper matches D1's async API surface and FK enforcement.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./d1-test-helper";

describe("D1 test helper", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("applies all migrations successfully", async () => {
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all<{ name: string }>();

    const names = tables.results.map((t) => t.name);
    expect(names).toContain("courses");
    expect(names).toContain("tee_times");
    expect(names).toContain("poll_log");
    expect(names).toContain("users");
    expect(names).toContain("sessions");
    expect(names).toContain("user_favorites");
    expect(names).toContain("booking_clicks");
  });

  it("first() returns null when no row matches", async () => {
    const result = await db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .bind("nonexistent")
      .first();

    expect(result).toBeNull();
  });

  it("all() returns { results: [] } when no rows match", async () => {
    const result = await db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .bind("nonexistent")
      .all();

    expect(result).toEqual({ results: [] });
  });

  it("run() returns { meta: { changes } }", async () => {
    await db
      .prepare(
        `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind("test", "Test", "City", "foreup", "{}", "https://example.com", 1)
      .run();

    const result = await db
      .prepare("DELETE FROM courses WHERE id = ?")
      .bind("test")
      .run();

    expect(result.meta.changes).toBe(1);
  });

  it("bind() is chainable", async () => {
    const stmt = db.prepare("SELECT * FROM courses WHERE id = ?");
    const bound = stmt.bind("test");
    // bind() should return an object with first/all/run
    expect(typeof bound.first).toBe("function");
    expect(typeof bound.all).toBe("function");
    expect(typeof bound.run).toBe("function");
  });

  it("enforces foreign key constraints", async () => {
    // Inserting a tee time for a non-existent course should fail
    await expect(
      db
        .prepare(
          `INSERT INTO tee_times (course_id, date, time, holes, open_slots, booking_url, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          "nonexistent",
          "2026-03-16",
          "08:00",
          18,
          4,
          "https://x.com",
          "2026-03-16T00:00:00Z"
        )
        .run()
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("batch() executes atomically — rolls back on failure", async () => {
    // Insert a course first
    await db
      .prepare(
        `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind("c1", "Course 1", "City", "foreup", "{}", "https://example.com", 1)
      .run();

    // Insert a valid tee time
    await db
      .prepare(
        `INSERT INTO tee_times (course_id, date, time, holes, open_slots, booking_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        "c1",
        "2026-03-16",
        "08:00",
        18,
        4,
        "https://x.com",
        "2026-03-16T00:00:00Z"
      )
      .run();

    // Batch: delete existing + insert with NULL time (should fail NOT NULL constraint)
    const deleteStmt = db
      .prepare("DELETE FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("c1", "2026-03-16");
    const badInsert = db
      .prepare(
        `INSERT INTO tee_times (course_id, date, time, holes, open_slots, booking_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        "c1",
        "2026-03-16",
        null,
        18,
        4,
        "https://x.com",
        "2026-03-16T00:00:00Z"
      );

    await expect(db.batch([deleteStmt, badInsert])).rejects.toThrow();

    // Original row should still exist (transaction rolled back)
    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ?")
      .bind("c1")
      .all();
    expect(rows.results).toHaveLength(1);
  });

  it("strftime works for sqliteIsoNow compatibility", async () => {
    // Verify strftime produces ISO 8601 format (same as our sqliteIsoNow helper)
    const result = await db
      .prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as ts")
      .bind()
      .first<{ ts: string }>();

    expect(result).not.toBeNull();
    // Should match ISO 8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(result!.ts).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});
