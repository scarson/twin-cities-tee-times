// ABOUTME: Tests for the tee-times API route's input validation and error handling.
// ABOUTME: Covers date format validation, filter parameters, and D1 error propagation.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

import { GET } from "./route";

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/tee-times");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe("GET /api/tee-times", () => {
  let mockAll: ReturnType<typeof createMockD1>["mockAll"];
  let db: ReturnType<typeof createMockD1>["db"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockAll = mock.mockAll;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env, ctx: {} } as any);
  });

  it("returns 400 when date is missing", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("date");
  });

  it("returns 400 for invalid date format", async () => {
    const res = await GET(makeRequest({ date: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid startTime format", async () => {
    const res = await GET(
      makeRequest({ date: "2026-04-15", startTime: "7am" })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("startTime");
  });

  it("returns 400 for invalid endTime format", async () => {
    const res = await GET(
      makeRequest({ date: "2026-04-15", endTime: "bad" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when too many course IDs provided", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `course-${i}`).join(",");
    const res = await GET(makeRequest({ date: "2026-04-15", courses: ids }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("50");
  });

  it("returns 200 with tee times for valid request", async () => {
    mockAll.mockResolvedValueOnce({
      results: [{ course_id: "braemar", time: "07:00", date: "2026-04-15" }],
    });
    const res = await GET(makeRequest({ date: "2026-04-15" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { teeTimes: unknown[] };
    expect(body.teeTimes).toHaveLength(1);
  });

  it("returns 500 when D1 query fails", async () => {
    mockAll.mockRejectedValueOnce(new Error("D1 timeout"));
    const res = await GET(makeRequest({ date: "2026-04-15" }));
    expect(res.status).toBe(500);
  });

  it("filters by course IDs when provided", async () => {
    mockAll.mockResolvedValueOnce({ results: [] });
    await GET(makeRequest({ date: "2026-04-15", courses: "braemar,como" }));

    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("IN");
  });
});
