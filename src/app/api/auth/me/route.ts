// ABOUTME: GET /api/auth/me — returns the authenticated user's profile info.
// ABOUTME: Used by the client to check login state and display user details.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const row = await db
      .prepare("SELECT name FROM users WHERE id = ?")
      .bind(user.userId)
      .first<{ name: string }>();

    if (!row) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    const response = NextResponse.json({
      userId: user.userId,
      email: user.email,
      name: row.name,
    });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("GET /api/auth/me:", err);
    const response = NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
