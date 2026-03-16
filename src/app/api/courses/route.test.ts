// ABOUTME: Tests for the courses list API route.
// ABOUTME: Covers successful listing, D1 error handling, and poll_log 24-hour filter.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// sqliteIsoNow is called at query-build time, so we let it run with the real impl
// (it just returns a SQL string fragment).

import { GET } from "./route";

describe("GET /api/courses", () => {
  let mockAll: ReturnType<typeof createMockD1>["mockAll"];
  let db: ReturnType<typeof createMockD1>["db"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockAll = mock.mockAll;
    // The courses list route calls db.prepare(sql).all() without .bind(),
    // so we need .all() directly on the statement object.
    (mock.statement as Record<string, unknown>).all = mockAll;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env, ctx: {} } as any);
  });

  it("returns 200 with courses array", async () => {
    mockAll.mockResolvedValueOnce({
      results: [{ id: "braemar", name: "Braemar" }],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { courses: unknown[] };
    expect(body.courses).toHaveLength(1);
  });

  it("returns 500 when D1 query fails", async () => {
    mockAll.mockRejectedValueOnce(new Error("D1 timeout"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("query filters poll_log to recent entries", async () => {
    mockAll.mockResolvedValueOnce({ results: [] });
    await GET();
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("-24 hours");
  });

  it("query includes no_data status in poll_log filter", async () => {
    mockAll.mockResolvedValueOnce({ results: [] });
    await GET();
    const sql = db.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("no_data");
  });
});
