// ABOUTME: POST /api/auth/logout — destroys the user's session and clears auth cookies.
// ABOUTME: Always returns 200 regardless of auth state to ensure clean client-side logout.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256, clearAuthCookies } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const isSecure = request.url.startsWith("https://");
  const headers = new Headers();

  const refreshToken = request.cookies.get("tct-refresh")?.value;
  if (refreshToken) {
    const tokenHash = await sha256(refreshToken);
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  clearAuthCookies(headers, isSecure);

  const response = NextResponse.json({ ok: true });
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}
