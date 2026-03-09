// ABOUTME: Tests for POST /api/user/favorites/merge route.
// ABOUTME: Verifies bulk merging of favorites, empty input, and auth.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateRequest: vi.fn(),
}));

describe("POST /api/user/favorites/merge", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockFirst: ReturnType<typeof createMockD1>["mockFirst"];
  let mockAll: ReturnType<typeof createMockD1>["mockAll"];
  let mockRun: ReturnType<typeof createMockD1>["mockRun"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockFirst = mock.mockFirst;
    mockAll = mock.mockAll;
    mockRun = mock.mockRun;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("merges new courses into favorites", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    // Count before merge
    mockFirst.mockResolvedValueOnce({ count: 1 });
    // Course exists checks
    mockFirst.mockResolvedValueOnce({ id: "course-1" });
    mockFirst.mockResolvedValueOnce({ id: "course-2" });
    // INSERT OR IGNORE runs
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // Count after merge
    mockFirst.mockResolvedValueOnce({ count: 3 });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/merge",
      {
        method: "POST",
        body: JSON.stringify({ courseIds: ["course-1", "course-2"] }),
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ merged: 2, total: 3 });
  });

  it("returns zero merged for empty courseIds", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    // Count before
    mockFirst.mockResolvedValueOnce({ count: 2 });
    // Count after (same)
    mockFirst.mockResolvedValueOnce({ count: 2 });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/merge",
      {
        method: "POST",
        body: JSON.stringify({ courseIds: [] }),
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ merged: 0, total: 2 });
  });

  it("skips courseIds that don't exist in courses table", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    // Count before
    mockFirst.mockResolvedValueOnce({ count: 0 });
    // Course exists: first exists, second doesn't
    mockFirst.mockResolvedValueOnce({ id: "course-1" });
    mockFirst.mockResolvedValueOnce(null);
    // INSERT OR IGNORE for the one valid course
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // Count after
    mockFirst.mockResolvedValueOnce({ count: 1 });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/merge",
      {
        method: "POST",
        body: JSON.stringify({ courseIds: ["course-1", "nonexistent"] }),
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ merged: 1, total: 1 });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/merge",
      {
        method: "POST",
        body: JSON.stringify({ courseIds: ["course-1"] }),
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });
});
