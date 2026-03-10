// ABOUTME: POST and DELETE /api/user/favorites/[courseId] — add or remove a single favorite.
// ABOUTME: POST validates course existence before inserting; DELETE is idempotent.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const { courseId } = await params;

    const course = await db
      .prepare("SELECT id FROM courses WHERE id = ?")
      .bind(courseId)
      .first<{ id: string }>();

    if (!course) {
      const response = NextResponse.json(
        { error: "Course not found" },
        { status: 404 }
      );
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }

    await db
      .prepare(
        "INSERT OR IGNORE INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind(user.userId, courseId, new Date().toISOString())
      .run();

    const response = NextResponse.json({ ok: true });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("POST /api/user/favorites/[courseId]:", err);
    const response = NextResponse.json(
      { error: "Failed to add favorite" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const { courseId } = await params;

    await db
      .prepare("DELETE FROM user_favorites WHERE user_id = ? AND course_id = ?")
      .bind(user.userId, courseId)
      .run();

    const response = NextResponse.json({ ok: true });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("DELETE /api/user/favorites/[courseId]:", err);
    const response = NextResponse.json(
      { error: "Failed to remove favorite" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
