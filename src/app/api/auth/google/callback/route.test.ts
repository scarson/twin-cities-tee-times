// ABOUTME: Tests for the OAuth callback route (GET /api/auth/google/callback).
// ABOUTME: Verifies token exchange, user upsert, session creation, and error handling.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const mockValidateAuth = vi.fn();
vi.mock("arctic", () => {
  class MockGoogle {
    validateAuthorizationCode = mockValidateAuth;
  }
  return { Google: MockGoogle };
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

function makeIdToken(claims: Record<string, string>): string {
  const header = btoa(JSON.stringify({ alg: "none" }));
  const payload = btoa(JSON.stringify(claims));
  return `${header}.${payload}.nosig`;
}

function makeCallbackRequest(
  params: Record<string, string>,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL("https://example.com/api/auth/google/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

function makeStateCookie(state: string, returnTo: string = "/"): string {
  return encodeURIComponent(JSON.stringify({ state, returnTo }));
}

let mockD1: ReturnType<typeof createMockD1>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockD1 = createMockD1();
  const env = createMockEnv(mockD1.db);
  vi.mocked(getCloudflareContext).mockResolvedValue({
    env,
    ctx: {},
  } as any);
});

describe("GET /api/auth/google/callback", () => {
  it("creates user, session, sets cookies, and redirects on happy path", async () => {
    const { GET } = await import("./route");

    const idToken = makeIdToken({
      sub: "google-123",
      email: "test@example.com",
      name: "Test User",
    });
    mockValidateAuth.mockResolvedValueOnce({
      idToken: () => idToken,
    });

    // Upsert user (INSERT ... ON CONFLICT) -> run
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // SELECT id FROM users WHERE google_id = ?
    mockD1.mockFirst.mockResolvedValueOnce({ id: "user-abc" });
    // INSERT session -> run
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // SELECT COUNT(*) sessions
    mockD1.mockFirst.mockResolvedValueOnce({ count: 1 });

    const state = "test-state-123";
    const request = makeCallbackRequest(
      { code: "auth-code", state },
      {
        "tct-oauth-state": makeStateCookie(state, "/courses/braemar"),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    // Should redirect
    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location")!;
    expect(location).toContain("/courses/braemar");
    expect(location).toContain("justSignedIn=true");

    // Should set session cookies
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("tct-session="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("tct-refresh="))).toBe(true);

    // Should clear OAuth cookies
    expect(
      cookies.some((c) => c.includes("tct-oauth-state") && c.includes("Max-Age=0"))
    ).toBe(true);
    expect(
      cookies.some((c) => c.includes("tct-oauth-verifier") && c.includes("Max-Age=0"))
    ).toBe(true);

    // Should have called validateAuthorizationCode
    expect(mockValidateAuth).toHaveBeenCalledWith("auth-code", "test-verifier");
  });

  it("redirects to returnTo without session cookies when user cancels", async () => {
    const { GET } = await import("./route");

    const state = "test-state-456";
    const request = makeCallbackRequest(
      { error: "access_denied", state },
      {
        "tct-oauth-state": makeStateCookie(state, "/courses/braemar"),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location")!;
    expect(location).toContain("/courses/braemar");

    // Should NOT set session cookies
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("tct-session="))).toBe(false);
    expect(cookies.some((c) => c.startsWith("tct-refresh="))).toBe(false);
  });

  it("redirects to /?error=auth_failed on state mismatch", async () => {
    const { GET } = await import("./route");

    const request = makeCallbackRequest(
      { code: "auth-code", state: "wrong-state" },
      {
        "tct-oauth-state": makeStateCookie("correct-state"),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/");
    expect(new URL(location).searchParams.get("error")).toBe("auth_failed");
  });

  it("redirects to /?error=auth_failed when OAuth cookies are missing", async () => {
    const { GET } = await import("./route");

    const request = makeCallbackRequest({ code: "auth-code", state: "some-state" });

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/");
    expect(new URL(location).searchParams.get("error")).toBe("auth_failed");
  });

  it("updates existing user on returning sign-in", async () => {
    const { GET } = await import("./route");

    const idToken = makeIdToken({
      sub: "google-existing",
      email: "updated@example.com",
      name: "Updated Name",
    });
    mockValidateAuth.mockResolvedValueOnce({
      idToken: () => idToken,
    });

    // Upsert user (ON CONFLICT updates email/name)
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // SELECT id FROM users WHERE google_id = ? -> existing user
    mockD1.mockFirst.mockResolvedValueOnce({ id: "existing-user-id" });
    // INSERT session
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // SELECT COUNT(*) sessions
    mockD1.mockFirst.mockResolvedValueOnce({ count: 3 });

    const state = "returning-state";
    const request = makeCallbackRequest(
      { code: "auth-code", state },
      {
        "tct-oauth-state": makeStateCookie(state),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);

    // Verify upsert SQL was used (INSERT ... ON CONFLICT)
    const prepareCalls = mockD1.db.prepare.mock.calls.map(
      (c: any[]) => c[0] as string
    );
    expect(prepareCalls.some((sql: string) => sql.includes("ON CONFLICT"))).toBe(true);

    // Should set session cookies
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("tct-session="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("tct-refresh="))).toBe(true);
  });

  it("deletes oldest session when user exceeds 10 sessions", async () => {
    const { GET } = await import("./route");

    const idToken = makeIdToken({
      sub: "google-many-sessions",
      email: "busy@example.com",
      name: "Busy User",
    });
    mockValidateAuth.mockResolvedValueOnce({
      idToken: () => idToken,
    });

    // Upsert user
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // SELECT id FROM users WHERE google_id = ?
    mockD1.mockFirst.mockResolvedValueOnce({ id: "busy-user-id" });
    // INSERT session
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
    // SELECT COUNT(*) sessions -> 11 (exceeds 10)
    mockD1.mockFirst.mockResolvedValueOnce({ count: 11 });
    // DELETE oldest session
    mockD1.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const state = "many-sessions-state";
    const request = makeCallbackRequest(
      { code: "auth-code", state },
      {
        "tct-oauth-state": makeStateCookie(state),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);

    // Verify DELETE was called for oldest session
    const prepareCalls = mockD1.db.prepare.mock.calls.map(
      (c: any[]) => c[0] as string
    );
    expect(
      prepareCalls.some(
        (sql: string) =>
          sql.includes("DELETE FROM sessions") &&
          sql.includes("ORDER BY created_at ASC LIMIT ?")
      )
    ).toBe(true);
  });

  it("redirects with error when code param is missing (no error param either)", async () => {
    const { GET } = await import("./route");

    const state = "no-code-state";
    const request = makeCallbackRequest(
      { state }, // no code, no error
      {
        "tct-oauth-state": makeStateCookie(state, "/"),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location")!;
    expect(new URL(location).searchParams.get("error")).toBe("auth_failed");
  });
});
