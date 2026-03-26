// ABOUTME: Pipeline integration tests: fixture → adapter → real DB → query → verify.
// ABOUTME: Tests the seam between adapter output and DB storage for all 3 adapters.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedCourse } from "@/test/d1-test-helper";
import { pollCourse } from "./poller";
import { sqliteIsoNow } from "./db";
import type { CourseRow } from "@/types";

import cpsFixture from "@/test/fixtures/cps-golf-tee-times.json";
import foreupFixture from "@/test/fixtures/foreup-tee-times.json";
import teeitupFixture from "@/test/fixtures/teeitup-tee-times.json";

vi.mock("@/lib/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));

// --- Helpers ---

function makeCourseRow(overrides: Partial<CourseRow> = {}): CourseRow {
  return {
    id: "test-course",
    name: "Test Course",
    city: "Minneapolis",
    state: "MN",
    platform: "foreup",
    platform_config: JSON.stringify({ scheduleId: "1234" }),
    booking_url: "https://example.com/book",
    is_active: 1,
    last_had_tee_times: null,
    ...overrides,
  };
}

const tokenResponse = () =>
  new Response(
    JSON.stringify({
      access_token: "test-token",
      expires_in: 600,
      token_type: "Bearer",
      scope: "onlinereservation references",
    }),
    { status: 200 }
  );

const registerResponse = () =>
  new Response(JSON.stringify(true), { status: 200 });

function mockCpsFlow(teeTimesBody: unknown) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(registerResponse())
    .mockResolvedValueOnce(
      new Response(JSON.stringify(teeTimesBody), { status: 200 })
    );
}

/** The courses freshness SQL (same as src/app/api/courses/route.ts) */
const FRESHNESS_SQL = `
  SELECT c.id, c.name,
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
  ORDER BY c.name
`;

describe("pipeline integration: CPS Golf", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "sd-encinitas",
    name: "Encinitas Ranch",
    platform: "cps_golf",
    platform_config: JSON.stringify({
      subdomain: "jcgsc5",
      websiteId: "94ce5060-0b39-444f-2756-08d8d81fed21",
      siteId: "16",
      terminalId: "3",
      courseIds: "2",
      timezone: "America/Los_Angeles",
    }),
    booking_url: "https://jcgsc5.cps.golf/onlineresweb",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("fixture → adapter → DB → query returns correct fields", async () => {
    mockCpsFlow(cpsFixture);

    const status = await pollCourse(db, courseRow, "2026-03-12");
    expect(status).toBe("success");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ? ORDER BY time")
      .bind("sd-encinitas", "2026-03-12")
      .all<{ time: string; price: number; holes: number; open_slots: number }>();

    expect(rows.results.length).toBe(3);
    expect(rows.results[0]).toMatchObject({
      time: "07:21",
      price: 95,
      holes: 18,
      open_slots: 1,
    });
  });
});

describe("pipeline integration: ForeUp", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ facilityId: "21445", scheduleId: "7829" }),
    booking_url: "https://foreupsoftware.com/index.php/booking/21445/7829",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("fixture → adapter → DB → query returns correct fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(foreupFixture), { status: 200 })
    );

    const status = await pollCourse(db, courseRow, "2026-04-15");
    expect(status).toBe("success");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ? ORDER BY time")
      .bind("braemar", "2026-04-15")
      .all<{ time: string; price: number; holes: number; open_slots: number }>();

    expect(rows.results.length).toBe(3);
    expect(rows.results[0]).toMatchObject({
      time: "07:00",
      price: 45,
      holes: 18,
      open_slots: 4,
    });
    // 9-hole tee time
    expect(rows.results[2]).toMatchObject({ time: "15:00", holes: 9 });
  });
});

describe("pipeline integration: TeeItUp", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "keller",
    name: "Keller Golf Course",
    platform: "teeitup",
    platform_config: JSON.stringify({
      alias: "ramsey-county-golf",
      apiBase: "https://phx-api-be-east-1b.kenna.io",
      facilityId: "17055",
    }),
    booking_url: "https://ramsey-county-golf.book.teeitup.com",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("fixture → adapter → DB → query returns correct fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(teeitupFixture), { status: 200 })
    );

    const status = await pollCourse(db, courseRow, "2026-03-11");
    expect(status).toBe("success");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ? ORDER BY time")
      .bind("keller", "2026-03-11")
      .all<{ time: string; price: number; holes: number; open_slots: number }>();

    expect(rows.results.length).toBe(3);
    // TeeItUp converts UTC to Central: 17:50 UTC → 12:50 CDT
    expect(rows.results[0]).toMatchObject({
      time: "12:50",
      price: 35,
      holes: 18,
      open_slots: 1,
    });
  });
});

describe("pipeline integration: poll status and freshness", () => {
  let db: D1Database;
  const courseRow = makeCourseRow({
    id: "braemar",
    name: "Braemar",
    platform: "foreup",
    platform_config: JSON.stringify({ facilityId: "21445", scheduleId: "7829" }),
    booking_url: "https://foreupsoftware.com/index.php/booking/21445/7829",
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = createTestDb();
    await seedCourse(db, {
      id: courseRow.id,
      name: courseRow.name,
      platform: courseRow.platform,
      platform_config: courseRow.platform_config,
      booking_url: courseRow.booking_url,
    });
  });

  it("success poll → freshness visible in courses query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(foreupFixture), { status: 200 })
    );

    const status = await pollCourse(db, courseRow, "2026-04-15");
    expect(status).toBe("success");

    const result = await db.prepare(FRESHNESS_SQL).all<{
      id: string;
      last_poll_status: string;
    }>();

    const course = result.results.find((r) => r.id === "braemar");
    expect(course!.last_poll_status).toBe("success");
  });

  it("empty poll → no_data freshness visible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const status = await pollCourse(db, courseRow, "2026-04-15");
    expect(status).toBe("no_data");

    const result = await db.prepare(FRESHNESS_SQL).all<{
      id: string;
      last_poll_status: string;
    }>();

    const course = result.results.find((r) => r.id === "braemar");
    expect(course!.last_poll_status).toBe("no_data");
  });

  it("error poll → excluded from freshness", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const status = await pollCourse(db, courseRow, "2026-04-15");
    expect(status).toBe("error");

    const result = await db.prepare(FRESHNESS_SQL).all<{
      id: string;
      last_poll_status: string | null;
    }>();

    const course = result.results.find((r) => r.id === "braemar");
    // Error polls are excluded from freshness (status IN ('success', 'no_data'))
    expect(course!.last_poll_status).toBeNull();
  });

  it("re-poll replaces data", async () => {
    // First poll
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(foreupFixture), { status: 200 })
    );
    await pollCourse(db, courseRow, "2026-04-15");

    // Second poll with different data
    const newFixture = [{ ...foreupFixture[0], time: "2026-04-15 11:00", green_fee: "99.00" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(newFixture), { status: 200 })
    );
    await pollCourse(db, courseRow, "2026-04-15");

    const rows = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ? AND date = ?")
      .bind("braemar", "2026-04-15")
      .all<{ time: string; price: number }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].time).toBe("11:00");
    expect(rows.results[0].price).toBe(99);
  });

  it("multi-course data isolation", async () => {
    await seedCourse(db, {
      id: "keller",
      name: "Keller",
      platform: "teeitup",
      platform_config: JSON.stringify({
        alias: "ramsey-county-golf",
        apiBase: "https://phx-api-be-east-1b.kenna.io",
        facilityId: "17055",
      }),
      booking_url: "https://ramsey-county-golf.book.teeitup.com",
    });

    const kellerRow = makeCourseRow({
      id: "keller",
      name: "Keller",
      platform: "teeitup",
      platform_config: JSON.stringify({
        alias: "ramsey-county-golf",
        apiBase: "https://phx-api-be-east-1b.kenna.io",
        facilityId: "17055",
      }),
      booking_url: "https://ramsey-county-golf.book.teeitup.com",
    });

    // Poll both courses
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(foreupFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(teeitupFixture), { status: 200 }));

    await pollCourse(db, courseRow, "2026-04-15");
    await pollCourse(db, kellerRow, "2026-03-11");

    // Query unfiltered — should have tee times from both courses
    const all = await db
      .prepare("SELECT DISTINCT course_id FROM tee_times")
      .all<{ course_id: string }>();
    expect(all.results.map((r) => r.course_id).sort()).toEqual(["braemar", "keller"]);

    // Query filtered — should only have braemar
    const filtered = await db
      .prepare("SELECT * FROM tee_times WHERE course_id = ?")
      .bind("braemar")
      .all();
    expect(filtered.results.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped D1 row in test assertion
    expect(filtered.results.every((r: any) => r.course_id === "braemar")).toBe(true);
  });
});

// --- Future adapter stubs ---
describe.todo(
  "Chronogolf/Lightspeed pipeline (Mandatory: implement when adapter exists — 35 courses, see dev/research/remaining-platforms-investigation.md)"
);
describe.todo(
  "GolfNow pipeline (Mandatory: implement when adapter exists — 6 courses, API research not yet conducted)"
);
describe.todo(
  "Teesnap pipeline (Mandatory: implement when adapter exists — 3 courses, API research not yet conducted)"
);
describe.todo(
  "Eagle Club Systems pipeline (Mandatory: implement when adapter exists — 1 course, see dev/research/remaining-platforms-investigation.md)"
);
describe.todo(
  "EZLinks pipeline (Mandatory: implement when adapter exists — 1 course, API research not yet conducted)"
);
describe.todo(
  "City/Custom pipeline (Mandatory: implement when adapter exists — 3 courses, API research not yet conducted)"
);
