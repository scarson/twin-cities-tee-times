// ABOUTME: Tests for POST and DELETE /api/user/favorites/[courseId] routes.
// ABOUTME: Verifies adding/removing individual favorites, course validation, and auth.

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

describe("POST /api/user/favorites/[courseId]", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockFirst: ReturnType<typeof createMockD1>["mockFirst"];
  let mockRun: ReturnType<typeof createMockD1>["mockRun"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockFirst = mock.mockFirst;
    mockRun = mock.mockRun;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("adds a favorite course", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    // Course exists
    mockFirst.mockResolvedValueOnce({ id: "course-1" });
    // INSERT OR IGNORE
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/course-1",
      { method: "POST" }
    );
    const params = Promise.resolve({ courseId: "course-1" });
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(db.prepare).toHaveBeenCalledWith(
      "SELECT id FROM courses WHERE id = ?"
    );
    expect(db.prepare).toHaveBeenCalledWith(
      "INSERT OR IGNORE INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
    );
  });

  it("returns 404 when course does not exist", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    // Course not found
    mockFirst.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/nonexistent",
      { method: "POST" }
    );
    const params = Promise.resolve({ courseId: "nonexistent" });
    const response = await POST(request, { params });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "Course not found" });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/course-1",
      { method: "POST" }
    );
    const params = Promise.resolve({ courseId: "course-1" });
    const response = await POST(request, { params });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("merges headers from authenticateRequest into response", async () => {
    const authHeaders = new Headers();
    authHeaders.append("Set-Cookie", "tct-session=new-jwt; Max-Age=900");
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: authHeaders,
    });

    mockFirst.mockResolvedValueOnce({ id: "course-1" });
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/course-1",
      { method: "POST" }
    );
    const params = Promise.resolve({ courseId: "course-1" });
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain("tct-session=new-jwt; Max-Age=900");
  });
});

describe("DELETE /api/user/favorites/[courseId]", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockRun: ReturnType<typeof createMockD1>["mockRun"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockRun = mock.mockRun;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("removes a favorite course", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/course-1",
      { method: "DELETE" }
    );
    const params = Promise.resolve({ courseId: "course-1" });
    const response = await DELETE(request, { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM user_favorites WHERE user_id = ? AND course_id = ?"
    );
  });

  it("returns ok even when favorite did not exist (idempotent)", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/course-1",
      { method: "DELETE" }
    );
    const params = Promise.resolve({ courseId: "course-1" });
    const response = await DELETE(request, { params });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites/course-1",
      { method: "DELETE" }
    );
    const params = Promise.resolve({ courseId: "course-1" });
    const response = await DELETE(request, { params });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });
});
