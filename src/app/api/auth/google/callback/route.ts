// ABOUTME: OAuth callback route that exchanges Google's auth code for tokens and creates a session.
// ABOUTME: Upserts user in D1, creates session with refresh token, and redirects to returnTo.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { Google } from "arctic";
import {
  sha256,
  createJWT,
  decodeJwt,
  validateReturnTo,
  REFRESH_EXPIRY_DAYS,
} from "@/lib/auth";

const MAX_SESSIONS = 10;

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB as D1Database;

  const stateCookie = request.cookies.get("tct-oauth-state")?.value;
  const codeVerifier = request.cookies.get("tct-oauth-verifier")?.value;

  // Parse returnTo from state cookie (used for error and cancel redirects)
  let returnTo = "/";
  if (stateCookie) {
    try {
      const parsed = JSON.parse(decodeURIComponent(stateCookie));
      returnTo = validateReturnTo(parsed.returnTo);
    } catch {
      // If cookie is malformed, fall back to /
    }
  }

  // User cancelled at Google's consent screen
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    const redirectUrl = new URL(returnTo, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Missing OAuth cookies
  if (!stateCookie || !codeVerifier) {
    const redirectUrl = new URL("/?error=missing_cookies", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Validate state matches
  let expectedState: string;
  try {
    const parsed = JSON.parse(decodeURIComponent(stateCookie));
    expectedState = parsed.state;
    returnTo = validateReturnTo(parsed.returnTo);
  } catch {
    const redirectUrl = new URL("/?error=state_parse", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  const stateParam = request.nextUrl.searchParams.get("state");
  if (stateParam !== expectedState) {
    const redirectUrl = new URL("/?error=state_mismatch", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Exchange auth code for tokens
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    const redirectUrl = new URL(returnTo, request.url);
    redirectUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirectUrl);
  }
  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
  const google = new Google(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  let tokens;
  try {
    tokens = await google.validateAuthorizationCode(code, codeVerifier);
  } catch (exchangeErr) {
    const redirectUrl = new URL(returnTo, request.url);
    redirectUrl.searchParams.set("error", "code_exchange");
    redirectUrl.searchParams.set("detail", String(exchangeErr));
    return NextResponse.redirect(redirectUrl);
  }

  // Decode ID token to get user info
  const claims = decodeJwt(tokens.idToken());
  const googleId = claims.sub as string;
  const email = claims.email as string;
  const name = (claims.name as string) || "";

  try {
    // Upsert user
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(google_id) DO UPDATE SET email = excluded.email, name = excluded.name"
      )
      .bind(userId, googleId, email, name, now)
      .run();

    // Get the actual user ID (may differ from generated UUID if user already existed)
    const userRow = await db
      .prepare("SELECT id FROM users WHERE google_id = ?")
      .bind(googleId)
      .first<{ id: string }>();

    if (!userRow) {
      const redirectUrl = new URL(returnTo, request.url);
      redirectUrl.searchParams.set("error", "auth_failed");
      return NextResponse.redirect(redirectUrl);
    }

    const actualUserId = userRow.id;

    // Create session with hashed refresh token
    const refreshToken = crypto.randomUUID();
    const tokenHash = await sha256(refreshToken);
    const expiresAt = new Date(
      Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    await db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(tokenHash, actualUserId, expiresAt, now)
      .run();

    // Enforce max sessions per user — delete all excess, not just one
    const countRow = await db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE user_id = ?")
      .bind(actualUserId)
      .first<{ count: number }>();

    const excess = (countRow?.count ?? 0) - MAX_SESSIONS;
    if (excess > 0) {
      await db
        .prepare(
          "DELETE FROM sessions WHERE token_hash IN " +
            "(SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT ?)"
        )
        .bind(actualUserId, excess)
        .run();
    }

    // Sign JWT
    const jwt = await createJWT({ userId: actualUserId, email }, env.JWT_SECRET);

    // Build redirect URL
    const redirectUrl = new URL(returnTo, request.url);
    redirectUrl.searchParams.set("justSignedIn", "true");

    // Set auth cookies and clear OAuth cookies via response.cookies.set() —
    // raw headers.append("Set-Cookie") is silently stripped by OpenNext on
    // Cloudflare Workers redirect responses.
    const isSecure = request.url.startsWith("https://");
    const response = NextResponse.redirect(redirectUrl);
    const baseCookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: isSecure,
    };
    response.cookies.set("tct-session", jwt, { ...baseCookieOpts, maxAge: 900 });
    response.cookies.set("tct-refresh", refreshToken, {
      ...baseCookieOpts,
      maxAge: REFRESH_EXPIRY_DAYS * 24 * 60 * 60,
    });
    response.cookies.set("tct-oauth-state", "", { ...baseCookieOpts, maxAge: 0 });
    response.cookies.set("tct-oauth-verifier", "", { ...baseCookieOpts, maxAge: 0 });

    return response;
  } catch (err) {
    console.error("OAuth callback D1 error:", err);
    const redirectUrl = new URL(returnTo, request.url);
    redirectUrl.searchParams.set("error", "db_error");
    redirectUrl.searchParams.set("detail", String(err));
    return NextResponse.redirect(redirectUrl);
  }
}
