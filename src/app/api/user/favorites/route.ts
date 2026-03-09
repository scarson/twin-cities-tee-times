// ABOUTME: GET /api/user/favorites — returns the authenticated user's favorite courses.
// ABOUTME: Joins user_favorites with courses table to return course details.

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
    const { results } = await db
      .prepare(
        `SELECT uf.course_id AS courseId, c.name AS courseName, c.city
         FROM user_favorites uf
         JOIN courses c ON c.id = uf.course_id
         WHERE uf.user_id = ?
         ORDER BY uf.created_at DESC`
      )
      .bind(user.userId)
      .all();

    const response = NextResponse.json({ favorites: results });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("GET /api/user/favorites:", err);
    const response = NextResponse.json(
      { error: "Failed to fetch favorites" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
