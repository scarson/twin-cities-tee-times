// ABOUTME: Tests for the course detail API route.
// ABOUTME: Covers course lookup, 404 handling, and D1 error propagation.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

import { GET } from "./route";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/courses/[id]", () => {
  let mockFirst: ReturnType<typeof createMockD1>["mockFirst"];
  let db: ReturnType<typeof createMockD1>["db"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockFirst = mock.mockFirst;
    const env = createMockEnv(mock.db);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env, ctx: {} } as any);
  });

  it("returns 200 with course data", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", name: "Braemar" });
    const res = await GET(
      new Request("http://localhost"),
      makeParams("braemar")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { course: { id: string } };
    expect(body.course.id).toBe("braemar");
  });

  it("returns 404 for unknown course", async () => {
    mockFirst.mockResolvedValueOnce(null);
    const res = await GET(
      new Request("http://localhost"),
      makeParams("nonexistent")
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when D1 query fails", async () => {
    mockFirst.mockRejectedValueOnce(new Error("D1 error"));
    const res = await GET(
      new Request("http://localhost"),
      makeParams("braemar")
    );
    expect(res.status).toBe(500);
  });

  it("query filters poll_log to recent entries", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar" });
    await GET(new Request("http://localhost"), makeParams("braemar"));
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("-24 hours");
  });
});
