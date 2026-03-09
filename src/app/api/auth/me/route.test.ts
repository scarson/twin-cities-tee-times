// ABOUTME: Tests for GET /api/auth/me route.
// ABOUTME: Verifies authenticated user info retrieval and unauthorized responses.

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

describe("GET /api/auth/me", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockFirst: ReturnType<typeof createMockD1>["mockFirst"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockFirst = mock.mockFirst;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("returns user info with 200 when authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });
    mockFirst.mockResolvedValueOnce({ name: "Test User" });

    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/me");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      userId: "user-1",
      email: "test@example.com",
      name: "Test User",
    });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/me");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user deleted from D1", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });
    mockFirst.mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/me");
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
    mockFirst.mockResolvedValueOnce({ name: "Test User" });

    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/me");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain("tct-session=new-jwt; Max-Age=900");
  });
});
