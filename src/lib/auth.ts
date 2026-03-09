// ABOUTME: Auth utility functions for JWT, session management, and request authentication.
// ABOUTME: Central auth module used by all authenticated API route handlers.

import { SignJWT, jwtVerify, decodeJwt } from "jose";
import { NextRequest } from "next/server";
import type { SessionRow } from "@/types";

const COOKIE_SESSION = "tct-session";
const COOKIE_REFRESH = "tct-refresh";
export const REFRESH_EXPIRY_DAYS = 90;

// ── Pure helpers ──────────────────────────────────────────────

/** SHA-256 hash a string, return hex. Used to hash refresh tokens before storing in D1. */
export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sign a JWT with { userId, email } claims. Expires in 15 minutes. */
export async function createJWT(
  payload: { userId: string; email: string },
  secret: string
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .setIssuedAt()
    .sign(key);
}

/** Verify a JWT and return claims, or null if invalid/expired. */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    if (
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

/** Re-export decodeJwt for use in OAuth callback (decodes Google's ID token without verification). */
export { decodeJwt };

/** Validate a returnTo URL to prevent open redirects. Must start with / but not //. No backslashes. */
export function validateReturnTo(returnTo: string | null): string {
  if (
    !returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\")
  ) {
    return "/";
  }
  return returnTo;
}

// ── Request authentication ───────────────────────────────────

/**
 * Authenticate an incoming request via JWT cookie.
 * If the JWT is expired but a valid refresh token exists, rotates both tokens.
 * Callers MUST merge the returned headers into their response (they may contain Set-Cookie).
 */
export async function authenticateRequest(
  request: NextRequest,
  db: D1Database,
  jwtSecret: string
): Promise<{
  user: { userId: string; email: string } | null;
  headers: Headers;
}> {
  const headers = new Headers();
  const sessionCookie = request.cookies.get(COOKIE_SESSION)?.value;
  const refreshCookie = request.cookies.get(COOKIE_REFRESH)?.value;
  const isSecure = request.url.startsWith("https://");

  // No session cookie at all
  if (!sessionCookie) {
    return { user: null, headers };
  }

  // Try to verify the JWT
  const user = await verifyJWT(sessionCookie, jwtSecret);
  if (user) {
    return { user, headers };
  }

  // JWT invalid/expired — try refresh
  if (!refreshCookie) {
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  const tokenHash = await sha256(refreshCookie);
  const session = await db
    .prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<SessionRow>();

  if (!session || new Date(session.expires_at) < new Date()) {
    // Refresh token not found or expired — clean up
    if (session) {
      await db
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .run();
    }
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Refresh token valid — rotate tokens
  const userId = session.user_id;
  const userRow = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();

  if (!userRow) {
    // User was deleted — clean up session
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Delete old session
  await db
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .run();

  // Create new session
  const newRefreshToken = crypto.randomUUID();
  const newTokenHash = await sha256(newRefreshToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = new Date().toISOString();

  await db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    )
    .bind(newTokenHash, userId, expiresAt, now)
    .run();

  // Sign new JWT
  const newJwt = await createJWT(
    { userId, email: userRow.email },
    jwtSecret
  );

  // Set new cookies
  setAuthCookies(headers, newJwt, newRefreshToken, isSecure);

  return { user: { userId, email: userRow.email }, headers };
}

// ── Cookie helpers ───────────────────────────────────────────

function cookieOptions(isSecure: boolean): string {
  return `HttpOnly; SameSite=Lax; Path=/${isSecure ? "; Secure" : ""}`;
}

export function setAuthCookies(
  headers: Headers,
  jwt: string,
  refreshToken: string,
  isSecure: boolean
): void {
  const opts = cookieOptions(isSecure);
  headers.append(
    "Set-Cookie",
    `${COOKIE_SESSION}=${jwt}; Max-Age=900; ${opts}`
  );
  headers.append(
    "Set-Cookie",
    `${COOKIE_REFRESH}=${refreshToken}; Max-Age=${REFRESH_EXPIRY_DAYS * 24 * 60 * 60}; ${opts}`
  );
}

export function clearAuthCookies(
  headers: Headers,
  isSecure: boolean
): void {
  const opts = cookieOptions(isSecure);
  headers.append(
    "Set-Cookie",
    `${COOKIE_SESSION}=; Max-Age=0; ${opts}`
  );
  headers.append(
    "Set-Cookie",
    `${COOKIE_REFRESH}=; Max-Age=0; ${opts}`
  );
}
