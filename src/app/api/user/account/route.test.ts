// ABOUTME: Tests for DELETE /api/user/account route.
// ABOUTME: Verifies user deletion, actual cookie clearing in response, and unauthorized responses.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// Partial mock: mock authenticateRequest only, use real clearAuthCookies
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    authenticateRequest: vi.fn(),
  };
});

describe("DELETE /api/user/account", () => {
  let db: ReturnType<typeof createMockD1>["db"];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    const mock = createMockD1();
    db = mock.db;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("deletes user and sets Max-Age=0 cookies in response", async () => {
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

    // Verify D1 delete was called
    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM users WHERE id = ?"
    );

    // Verify actual response contains cookie-clearing headers
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("tct-session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.includes("tct-refresh=") && c.includes("Max-Age=0"))).toBe(true);
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

  it("merges auth headers (e.g., rotated cookies) into response", async () => {
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
    // Should contain both the auth rotation cookie AND the clearing cookies
    expect(cookies.some((c) => c.includes("tct-session=new-jwt"))).toBe(true);
    expect(cookies.some((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});
