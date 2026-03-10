// ABOUTME: OAuth initiation route that redirects users to Google's consent screen.
// ABOUTME: Sets CSRF state and PKCE verifier cookies, then redirects to Google OAuth.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { Google, generateCodeVerifier } from "arctic";
import { validateReturnTo } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();

  const returnTo = validateReturnTo(
    request.nextUrl.searchParams.get("returnTo")
  );

  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();

  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
  const google = new Google(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const authUrl = google.createAuthorizationURL(
    state,
    codeVerifier,
    ["openid", "email", "profile"]
  );

  const isSecure = request.url.startsWith("https://");
  const stateValue = JSON.stringify({ state, returnTo });

  const response = NextResponse.redirect(authUrl);
  // Use response.cookies.set() — raw headers.append("Set-Cookie") is
  // silently stripped by OpenNext on Cloudflare Workers redirect responses.
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
    secure: isSecure,
  };
  response.cookies.set("tct-oauth-state", stateValue, cookieOpts);
  response.cookies.set("tct-oauth-verifier", codeVerifier, cookieOpts);

  return response;
}
