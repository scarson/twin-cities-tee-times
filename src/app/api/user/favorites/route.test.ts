// ABOUTME: Tests for GET /api/user/favorites route.
// ABOUTME: Verifies listing favorites with course details, empty results, and auth.

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

describe("GET /api/user/favorites", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockAll: ReturnType<typeof createMockD1>["mockAll"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockAll = mock.mockAll;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("returns favorites with course details", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    const favorites = [
      { courseId: "course-1", courseName: "Braemar", city: "Edina" },
      { courseId: "course-2", courseName: "Bunker Hills", city: "Coon Rapids" },
    ];
    mockAll.mockResolvedValueOnce({ results: favorites });

    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites",
      { method: "GET" }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ favorites });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("user_favorites")
    );
  });

  it("returns empty array when user has no favorites", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    mockAll.mockResolvedValueOnce({ results: [] });

    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites",
      { method: "GET" }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ favorites: [] });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites",
      { method: "GET" }
    );
    const response = await GET(request);

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

    mockAll.mockResolvedValueOnce({ results: [] });

    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/favorites",
      { method: "GET" }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain("tct-session=new-jwt; Max-Age=900");
  });
});
