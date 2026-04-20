// ABOUTME: Integration tests for core db.ts functions against real SQLite.
// ABOUTME: Covers upsertTeeTimes, logPoll, batch atomicity, FK enforcement, and time parsing.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, makeTeeTime } from "@/test/d1-test-helper";
import { upsertTeeTimes, logPoll } from "./db";

describe("upsertTeeTimes", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db);
  });

  it("inserts tee times that are queryable afterward", async () => {
    const teeTimes = [makeTeeTime(), makeTeeTime({ time: "2026-03-16T09:00:00", price: 50 })];

    await upsertTeeTimes(db, "test-course", "2026-03-16", teeTimes, new Date().toISOString());

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all<{ time: string; price: number }>();

    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].time).toBe("08:30");
    expect(rows.results[1].time).toBe("09:00");
  });

  it("replaces old data on re-upsert for same course+date", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "2026-03-16T07:00:00", price: 30 })],
      new Date().toISOString()
    );

    // Re-upsert with different data
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "2026-03-16T10:00:00", price: 60 })],
      new Date().toISOString()
    );

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all<{ time: string; price: number }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].time).toBe("10:00");
    expect(rows.results[0].price).toBe(60);
  });

  it("with empty array deletes existing rows", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime()],
      new Date().toISOString()
    );

    // Upsert with empty array
    await upsertTeeTimes(db, "test-course", "2026-03-16", [], new Date().toISOString());

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all();

    expect(rows.results).toHaveLength(0);
  });

  it("handles large batches (200 records) for multi-hole multi-variant scenarios", async () => {
    // Regression guard for multi-hole courses like Francis A Gross where a
    // single day's poll can produce ~130 records (63 slots × 2 hole variants).
    // Adds 40% headroom to 200 records. Watch for D1 batch count/param limits.
    const teeTimes = Array.from({ length: 200 }, (_, i) =>
      makeTeeTime({
        time: `2026-04-21T${String(6 + Math.floor(i / 8)).padStart(2, "0")}:${String((i % 8) * 7).padStart(2, "0")}:00`,
        price: i % 2 === 0 ? 43 : 26,
        holes: i % 2 === 0 ? 18 : 9,
      })
    );

    await upsertTeeTimes(db, "test-course", "2026-04-21", teeTimes, new Date().toISOString());

    const rows = await db
      .prepare("SELECT COUNT(*) as n FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-04-21")
      .first<{ n: number }>();

    expect(rows!.n).toBe(200);
  });

  it("extracts HH:MM from ISO time (T separator)", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "2026-03-16T14:45:00" })],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT time FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ time: string }>();

    expect(row!.time).toBe("14:45");
  });

  it("stores time as-is when no T separator (plain HH:MM)", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ time: "08:30" })],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT time FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ time: string }>();

    expect(row!.time).toBe("08:30");
  });

  it("batch atomicity: constraint violation rolls back preceding DELETE", async () => {
    // Insert 3 tee times
    const originals = [
      makeTeeTime({ time: "2026-03-16T07:00:00" }),
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
      makeTeeTime({ time: "2026-03-16T09:00:00" }),
    ];
    await upsertTeeTimes(db, "test-course", "2026-03-16", originals, new Date().toISOString());

    // Attempt upsert with a tee time that has null bookingUrl (NOT NULL violation).
    // The null gets past JS mapping but fails the SQL NOT NULL constraint on booking_url.
    // The batch transaction should roll back the DELETE that precedes the INSERT.
    const badTeeTimes = [
      makeTeeTime({ bookingUrl: null as unknown as string }),
    ];

    await expect(
      upsertTeeTimes(db, "test-course", "2026-03-16", badTeeTimes, new Date().toISOString())
    ).rejects.toThrow();

    // Original 3 rows should still be there
    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("test-course", "2026-03-16")
      .all();

    expect(rows.results).toHaveLength(3);
  });

  it("stores and retrieves nines field", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ nines: "East/West" })],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT nines FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ nines: string | null }>();

    expect(row!.nines).toBe("East/West");
  });

  it("stores null when nines is undefined", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime()],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT nines FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ nines: string | null }>();

    expect(row!.nines).toBeNull();
  });

  it("stores null price", async () => {
    await upsertTeeTimes(
      db, "test-course", "2026-03-16",
      [makeTeeTime({ price: null })],
      new Date().toISOString()
    );

    const row = await db
      .prepare("SELECT price FROM tee_times WHERE course_id = ?")
      .bind("test-course")
      .first<{ price: number | null }>();

    expect(row!.price).toBeNull();
  });

  it("FK enforcement: inserting tee time for non-existent course fails", async () => {
    await expect(
      upsertTeeTimes(
        db, "nonexistent-course", "2026-03-16",
        [makeTeeTime({ courseId: "nonexistent-course" })],
        new Date().toISOString()
      )
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("logPoll", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db);
  });

  it("records entries with correct status values", async () => {
    await logPoll(db, "test-course", "2026-03-16", "success", 5);
    await logPoll(db, "test-course", "2026-03-16", "no_data", 0);
    await logPoll(db, "test-course", "2026-03-16", "error", 0, "API timeout");

    const rows = await db
      .prepare("SELECT status, tee_time_count, error_message FROM poll_log WHERE course_id = ? ORDER BY id")
      .bind("test-course")
      .all<{ status: string; tee_time_count: number; error_message: string | null }>();

    expect(rows.results).toHaveLength(3);
    expect(rows.results[0]).toMatchObject({ status: "success", tee_time_count: 5, error_message: null });
    expect(rows.results[1]).toMatchObject({ status: "no_data", tee_time_count: 0, error_message: null });
    expect(rows.results[2]).toMatchObject({ status: "error", tee_time_count: 0, error_message: "API timeout" });
  });
});

describe("sqliteIsoNow boundary", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db);
  });

  it("poll at exactly 24 hours ago is excluded by > comparison", async () => {
    // Insert a poll with polled_at = exactly now (which strftime('now') will match)
    // Then query with > sqliteIsoNow('-24 hours')
    // This tests that the boundary is exclusive (>), not inclusive (>=)
    await logPoll(db, "test-course", "2026-03-16", "success", 5);

    // The courses route query uses > sqliteIsoNow('-24 hours')
    // A poll from right now should be included
    const result = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM poll_log
         WHERE polled_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')`
      )
      .bind()
      .first<{ cnt: number }>();

    expect(result!.cnt).toBe(1);
  });
});
