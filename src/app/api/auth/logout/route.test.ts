// ABOUTME: Tests for POST /api/auth/logout route.
// ABOUTME: Verifies session deletion, actual cookie clearing in response, and always-200 behavior.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// No mock of @/lib/auth — using real sha256 and clearAuthCookies

describe("POST /api/auth/logout", () => {
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

  it("deletes session, sets Max-Age=0 cookies, and returns 200", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/logout", {
      method: "POST",
    });
    request.cookies.set("tct-refresh", "some-refresh-token");

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // Verify D1 delete was called
    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE token_hash = ?"
    );

    // Verify actual response headers contain cookie-clearing directives
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("tct-session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.includes("tct-refresh=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("clears cookies and returns 200 even with no auth cookies", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/logout", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // Should NOT have tried to delete any session
    expect(db.prepare).not.toHaveBeenCalled();

    // Should still clear cookies in response
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("tct-session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.includes("tct-refresh=") && c.includes("Max-Age=0"))).toBe(true);
  });
});
