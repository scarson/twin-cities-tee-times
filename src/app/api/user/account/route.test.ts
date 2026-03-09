// ABOUTME: Tests for DELETE /api/user/account route.
// ABOUTME: Verifies user deletion, cookie clearing, and unauthorized responses.

import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest, clearAuthCookies } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateRequest: vi.fn(),
  clearAuthCookies: vi.fn(),
}));

describe("DELETE /api/user/account", () => {
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

  it("deletes user, clears cookies, returns 200", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/account",
      { method: "DELETE" }
    );
    const response = await DELETE(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, clearLocalStorage: true });

    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM users WHERE id = ?"
    );
    expect(clearAuthCookies).toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/account",
      { method: "DELETE" }
    );
    const response = await DELETE(request);

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

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/account",
      { method: "DELETE" }
    );
    const response = await DELETE(request);

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain("tct-session=new-jwt; Max-Age=900");
  });
});
