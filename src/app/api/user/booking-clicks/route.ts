// ABOUTME: POST /api/user/booking-clicks — tracks when a user clicks a booking link.
// ABOUTME: Fire-and-forget endpoint; uses INSERT OR IGNORE for idempotency.

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
    const { courseId, date, time } = (await request.json()) as {
      courseId?: string;
      date?: string;
      time?: string;
    };

    if (!courseId || !date || !time) {
      const response = NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }

    await db
      .prepare(
        `INSERT OR IGNORE INTO booking_clicks (user_id, course_id, date, time, clicked_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(user.userId, courseId, date, time, new Date().toISOString())
      .run();

    const response = NextResponse.json({ ok: true });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("POST /api/user/booking-clicks:", err);
    const response = NextResponse.json(
      { error: "Failed to record click" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
