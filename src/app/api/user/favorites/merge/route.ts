// ABOUTME: POST /api/user/favorites/merge — bulk-merges local favorites into server storage.
// ABOUTME: Validates each course exists before inserting, returns merged and total counts.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const { courseIds } = (await request.json()) as { courseIds: string[] };

    // Count existing favorites before merge
    const before = await db
      .prepare("SELECT COUNT(*) AS count FROM user_favorites WHERE user_id = ?")
      .bind(user.userId)
      .first<{ count: number }>();
    const countBefore = before?.count ?? 0;

    // Insert each valid course
    const now = new Date().toISOString();
    for (const courseId of courseIds) {
      const course = await db
        .prepare("SELECT id FROM courses WHERE id = ?")
        .bind(courseId)
        .first<{ id: string }>();

      if (!course) continue;

      await db
        .prepare(
          "INSERT OR IGNORE INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
        )
        .bind(user.userId, courseId, now)
        .run();
    }

    // Count after merge
    const after = await db
      .prepare("SELECT COUNT(*) AS count FROM user_favorites WHERE user_id = ?")
      .bind(user.userId)
      .first<{ count: number }>();
    const countAfter = after?.count ?? 0;

    const response = NextResponse.json({
      merged: countAfter - countBefore,
      total: countAfter,
    });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("POST /api/user/favorites/merge:", err);
    const response = NextResponse.json(
      { error: "Failed to merge favorites" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
