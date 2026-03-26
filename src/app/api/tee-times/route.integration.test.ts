// ABOUTME: Integration tests for the tee-times SQL query with dynamic filter building.
// ABOUTME: Verifies date, course, time range, holes, minSlots filters, and ordering.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, makeTeeTime } from "@/test/d1-test-helper";
import { upsertTeeTimes } from "@/lib/db";

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
    SELECT t.*, c.name as course_name, c.city as course_city, c.state as course_state
    FROM tee_times t
    JOIN courses c ON t.course_id = c.id
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
});
