// ABOUTME: Tests for auth utility functions — JWT, hashing, cookies, and request authentication.
// ABOUTME: Covers pure helpers and authenticateRequest with D1 mock for session rotation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1 } from "@/test/d1-mock";

// ── Pure function tests ──────────────────────────────────────

describe("sha256", () => {
  it("returns a consistent 64-character hex string", async () => {
    const { sha256 } = await import("./auth");
    const hash = await sha256("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // deterministic
    expect(await sha256("hello")).toBe(hash);
  });
});

describe("createJWT", () => {
  it("returns a string with 3 dot-separated parts", async () => {
    const { createJWT } = await import("./auth");
    const token = await createJWT(
      { userId: "u1", email: "a@b.com" },
      "test-secret-that-is-at-least-32-chars-long"
    );
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("verifyJWT", () => {
  const secret = "test-secret-that-is-at-least-32-chars-long";

  it("returns { userId, email } for a valid token", async () => {
    const { createJWT, verifyJWT } = await import("./auth");
    const token = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    const result = await verifyJWT(token, secret);
    expect(result).toEqual({ userId: "u1", email: "a@b.com" });
  });

  it("returns null for an expired token", async () => {
    const { createJWT, verifyJWT } = await import("./auth");
    vi.useFakeTimers();
    const token = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes past 15-min expiry
    const result = await verifyJWT(token, secret);
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("returns null for a token signed with wrong secret", async () => {
    const { createJWT, verifyJWT } = await import("./auth");
    const token = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    const result = await verifyJWT(token, "wrong-secret-that-is-at-least-32-chars");
    expect(result).toBeNull();
  });

  it("returns null for garbage input", async () => {
    const { verifyJWT } = await import("./auth");
    const result = await verifyJWT("garbage", secret);
    expect(result).toBeNull();
  });

  it("rejects a JWT with alg: none", async () => {
    const { verifyJWT } = await import("./auth");
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=/g, "");
    const payload = btoa(JSON.stringify({ userId: "u1", email: "a@b.com", exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, "");
    const noneToken = `${header}.${payload}.`;

    const result = await verifyJWT(noneToken, secret);
    expect(result).toBeNull();
  });
});

describe("validateReturnTo", () => {
  it("accepts a valid relative path", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("/courses/braemar")).toBe("/courses/braemar");
  });

  it("accepts root path", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("/")).toBe("/");
  });

  it("rejects protocol-relative URLs", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("//evil.com")).toBe("/");
  });

  it("rejects absolute URLs", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("https://evil.com")).toBe("/");
  });

  it("rejects paths with backslashes", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("/path\\with\\backslash")).toBe("/");
  });

  it("returns / for null", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo(null)).toBe("/");
  });

  it("returns / for empty string", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("")).toBe("/");
  });
});

// ── authenticateRequest tests ────────────────────────────────

function makeRequest(
  cookies: Record<string, string> = {},
  url = "https://example.com/api/test"
): NextRequest {
  const req = new NextRequest(url);
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("authenticateRequest", () => {
  const secret = "test-secret-that-is-at-least-32-chars-long";

  it("returns user for a valid JWT", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db } = createMockD1();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    const req = makeRequest({ "tct-session": jwt });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toEqual({ userId: "u1", email: "a@b.com" });
    // No Set-Cookie headers needed when JWT is still valid
    expect(result.headers.has("Set-Cookie")).toBe(false);
  });

  it("rotates tokens when JWT is expired but refresh token is valid", async () => {
    const { createJWT, authenticateRequest, sha256 } = await import("./auth");
    const { db, mockFirst, mockRun } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // expire the JWT

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);

    // DELETE RETURNING: atomically claim session
    mockFirst.mockResolvedValueOnce({
      token_hash: tokenHash,
      user_id: "u1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });
    // Second query: find user email
    mockFirst.mockResolvedValueOnce({ email: "a@b.com" });

    const req = makeRequest({
      "tct-session": jwt,
      "tct-refresh": refreshToken,
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toEqual({ userId: "u1", email: "a@b.com" });

    // Should have Set-Cookie headers for rotated tokens
    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("tct-session=");
    expect(setCookies[1]).toContain("tct-refresh=");

    // Should have deleted old session and inserted new one
    expect(mockRun).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("clears cookies when JWT is expired and refresh token is expired in D1", async () => {
    const { createJWT, authenticateRequest, sha256 } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    const refreshToken = "expired-refresh-token";

    // Session found but expired
    mockFirst.mockResolvedValueOnce({
      token_hash: await sha256(refreshToken),
      user_id: "u1",
      expires_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
      created_at: new Date().toISOString(),
    });

    const req = makeRequest({
      "tct-session": jwt,
      "tct-refresh": refreshToken,
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    // Should clear cookies
    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("Max-Age=0");
    expect(setCookies[1]).toContain("Max-Age=0");

    vi.useRealTimers();
  });

  it("returns null when JWT is expired and no refresh cookie exists", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    const req = makeRequest({ "tct-session": jwt });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    // Should clear cookies
    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("Max-Age=0");

    vi.useRealTimers();
  });

  it("returns null when no session cookie exists", async () => {
    const { authenticateRequest } = await import("./auth");
    const { db } = createMockD1();

    const req = makeRequest({});
    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();
    expect(result.headers.has("Set-Cookie")).toBe(false);
  });

  it("returns null for malformed session cookie", async () => {
    const { authenticateRequest } = await import("./auth");
    const { db } = createMockD1();

    const req = makeRequest({ "tct-session": "not-a-jwt" });
    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();
  });

  it("sets Secure flag on cookies when request is HTTPS", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    mockFirst.mockResolvedValueOnce({
      user_id: "u1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    mockFirst.mockResolvedValueOnce({ email: "a@b.com" });

    const req = makeRequest(
      { "tct-session": jwt, "tct-refresh": "refresh-token" },
      "https://example.com/api/test"
    );
    const result = await authenticateRequest(req, db, secret);

    const cookies = result.headers.getSetCookie();
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
    }

    vi.useRealTimers();
  });

  it("omits Secure flag on cookies when request is HTTP", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    mockFirst.mockResolvedValueOnce({
      user_id: "u1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    mockFirst.mockResolvedValueOnce({ email: "a@b.com" });

    const req = makeRequest(
      { "tct-session": jwt, "tct-refresh": "refresh-token" },
      "http://localhost:3000/api/test"
    );
    const result = await authenticateRequest(req, db, secret);

    const cookies = result.headers.getSetCookie();
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("Secure");
    }

    vi.useRealTimers();
  });

  it("returns null without clearing cookies when session was already claimed (race condition)", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // expire the JWT

    // DELETE RETURNING returns null — session was already claimed by another request
    mockFirst.mockResolvedValueOnce(null);

    const req = makeRequest({
      "tct-session": jwt,
      "tct-refresh": "claimed-refresh-token",
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    // CRITICAL: must NOT clear cookies — the winning request already set new ones
    expect(result.headers.has("Set-Cookie")).toBe(false);

    vi.useRealTimers();
  });
});
