// ABOUTME: Integration tests for the tee-times SQL query with dynamic filter building.
// ABOUTME: Verifies date, course, time range, holes, minSlots filters, and ordering.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, makeTeeTime } from "@/test/d1-test-helper";
import { upsertTeeTimes, sqliteIsoNow } from "@/lib/db";

/**
 * Insert a poll_log row at a controlled polled_at offset from now.
 * Mirrors logPoll's columns but lets the test pin polled_at for freshness tests.
 */
async function seedPoll(
  db: D1Database,
  courseId: string,
  date: string,
  status: "success" | "error" | "no_data",
  polledAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO poll_log (course_id, date, polled_at, status, tee_time_count, error_message, content_changed)
       VALUES (?, ?, ?, ?, 0, NULL, 0)`
    )
    .bind(courseId, date, polledAt, status)
    .run();
}

/** ISO timestamp `hoursAgo` hours before now. */
function hoursAgoIso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

/**
 * Build and execute the same dynamic SQL query as src/app/api/tee-times/route.ts.
 * This replicates the route's query builder logic exactly.
 */
async function queryTeeTimes(
  db: D1Database,
  params: {
    date: string;
    courseIds?: string[];
    startTime?: string;
    endTime?: string;
    holes?: string;
    minSlots?: string;
  }
) {
  let query = `
    SELECT t.*, c.name as course_name, c.city as course_city, c.state as course_state,
           p.polled_at as polled_at
    FROM tee_times t
    JOIN courses c ON t.course_id = c.id
    LEFT JOIN (
      SELECT course_id, date, polled_at,
             ROW_NUMBER() OVER (PARTITION BY course_id, date ORDER BY polled_at DESC) as rn
      FROM poll_log
      WHERE polled_at > ${sqliteIsoNow("-24 hours")}
        AND status IN ('success', 'no_data')
    ) p ON t.course_id = p.course_id AND t.date = p.date AND p.rn = 1
    WHERE t.date = ? AND c.disabled = 0
  `;
  const bindings: unknown[] = [params.date];

  if (params.courseIds && params.courseIds.length > 0) {
    const placeholders = params.courseIds.map(() => "?").join(",");
    query += ` AND t.course_id IN (${placeholders})`;
    bindings.push(...params.courseIds);
  }

  if (params.startTime) {
    query += " AND t.time >= ?";
    bindings.push(params.startTime);
  }

  if (params.endTime) {
    query += " AND t.time <= ?";
    bindings.push(params.endTime);
  }

  if (params.holes === "9" || params.holes === "18") {
    query += " AND t.holes = ?";
    bindings.push(parseInt(params.holes));
  }

  if (params.minSlots) {
    query += " AND t.open_slots >= ?";
    bindings.push(parseInt(params.minSlots));
  }

  query += " ORDER BY c.state DESC, t.time ASC";

  return db.prepare(query).bind(...bindings).all<{
    course_id: string;
    date: string;
    time: string;
    price: number | null;
    holes: number;
    open_slots: number;
    course_name: string;
    course_state: string;
    polled_at: string | null;
  }>();
}

describe("tee-times query", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "c1", name: "Alpha" });
    await seedCourse(db, { id: "c2", name: "Bravo" });
  });

  it("date filter returns only matching date", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c1", "2026-03-17", [
      makeTeeTime({ time: "2026-03-17T09:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].date).toBe("2026-03-16");
  });

  it("course filter (IN clause) works with multiple IDs", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c2", "2026-03-16", [
      makeTeeTime({ courseId: "c2", time: "2026-03-16T09:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16", courseIds: ["c1"] });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].course_id).toBe("c1");
  });

  it("time range filter with startTime and endTime", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T07:00:00" }),
      makeTeeTime({ time: "2026-03-16T10:00:00" }),
      makeTeeTime({ time: "2026-03-16T14:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, {
      date: "2026-03-16",
      startTime: "09:00",
      endTime: "12:00",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].time).toBe("10:00");
  });

  it("holes filter returns only matching tee times", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00", holes: 18 }),
      makeTeeTime({ time: "2026-03-16T09:00:00", holes: 9 }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16", holes: "9" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].holes).toBe(9);
  });

  it("results ordered by time ASC", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T14:00:00" }),
      makeTeeTime({ time: "2026-03-16T07:00:00" }),
      makeTeeTime({ time: "2026-03-16T10:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    const times = result.results.map((r) => r.time);
    expect(times).toEqual(["07:00", "10:00", "14:00"]);
  });

  it("multi-course multi-date returns correct cross-section", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c2", "2026-03-16", [
      makeTeeTime({ courseId: "c2", time: "2026-03-16T09:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c1", "2026-03-17", [
      makeTeeTime({ time: "2026-03-17T10:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, {
      date: "2026-03-16",
      courseIds: ["c1"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].course_id).toBe("c1");
  });

  it("combined filters all active simultaneously", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00", holes: 18, openSlots: 4 }),
      makeTeeTime({ time: "2026-03-16T09:00:00", holes: 9, openSlots: 2 }),
      makeTeeTime({ time: "2026-03-16T14:00:00", holes: 18, openSlots: 1 }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c2", "2026-03-16", [
      makeTeeTime({ courseId: "c2", time: "2026-03-16T08:30:00", holes: 18, openSlots: 4 }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, {
      date: "2026-03-16",
      courseIds: ["c1"],
      startTime: "07:00",
      endTime: "10:00",
      holes: "18",
      minSlots: "2",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].time).toBe("08:00");
  });

  it("minSlots filter returns only tee times with sufficient open slots", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00", openSlots: 1 }),
      makeTeeTime({ time: "2026-03-16T09:00:00", openSlots: 3 }),
      makeTeeTime({ time: "2026-03-16T10:00:00", openSlots: 4 }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16", minSlots: "3" });
    expect(result.results).toHaveLength(2);
  });

  it("excludes tee times from disabled courses", async () => {
    await seedCourse(db, { id: "c3", name: "Charlie", disabled: 1 });
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c3", "2026-03-16", [
      makeTeeTime({ courseId: "c3", time: "2026-03-16T09:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].course_id).toBe("c1");
  });

  it("sorts by state DESC then time ASC", async () => {
    await seedCourse(db, { id: "ca1", name: "Cali Course", state: "CA" });
    await upsertTeeTimes(db, "ca1", "2026-03-16", [
      makeTeeTime({ courseId: "ca1", time: "2026-03-16T07:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T09:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].course_id).toBe("c1");
    expect(result.results[0].course_state).toBe("MN");
    expect(result.results[1].course_id).toBe("ca1");
    expect(result.results[1].course_state).toBe("CA");
  });

  it("includes course_state in results", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results[0].course_state).toBe("MN");
  });

  it("returns polled_at from the most recent matching poll for the (course, date)", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    // An older poll and a newer poll for the same (course, date).
    const older = hoursAgoIso(3);
    const newer = hoursAgoIso(1);
    await seedPoll(db, "c1", "2026-03-16", "success", older);
    await seedPoll(db, "c1", "2026-03-16", "success", newer);

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].polled_at).toBe(newer);
  });

  it("returns null polled_at when no poll exists in the last 24h", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    // No poll_log rows seeded for this (course, date) at all.

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].polled_at).toBeNull();
  });

  it("ignores polls older than 24h (proves the freshness filter is present)", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    // Only a stale poll exists — 25h old — so it must be filtered out.
    await seedPoll(db, "c1", "2026-03-16", "success", hoursAgoIso(25));

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].polled_at).toBeNull();
  });

  it("ignores error-status polls when reporting freshness", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    // A recent error poll plus an older success poll: the success wins.
    const success = hoursAgoIso(2);
    await seedPoll(db, "c1", "2026-03-16", "error", hoursAgoIso(1));
    await seedPoll(db, "c1", "2026-03-16", "success", success);

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].polled_at).toBe(success);
  });

  it("includes no_data polls when reporting freshness", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    const polled = hoursAgoIso(1);
    await seedPoll(db, "c1", "2026-03-16", "no_data", polled);

    const result = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].polled_at).toBe(polled);
  });

  it("scopes polled_at to the matching date (no cross-date bleed)", async () => {
    await upsertTeeTimes(db, "c1", "2026-03-16", [
      makeTeeTime({ time: "2026-03-16T08:00:00" }),
    ], new Date().toISOString());
    await upsertTeeTimes(db, "c1", "2026-03-17", [
      makeTeeTime({ time: "2026-03-17T08:00:00" }),
    ], new Date().toISOString());
    const poll16 = hoursAgoIso(2);
    await seedPoll(db, "c1", "2026-03-16", "success", poll16);
    // No poll for 2026-03-17.

    const day17 = await queryTeeTimes(db, { date: "2026-03-17" });
    expect(day17.results).toHaveLength(1);
    expect(day17.results[0].polled_at).toBeNull();

    const day16 = await queryTeeTimes(db, { date: "2026-03-16" });
    expect(day16.results[0].polled_at).toBe(poll16);
  });
});
