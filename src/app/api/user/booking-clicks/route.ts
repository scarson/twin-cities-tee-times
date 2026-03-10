// ABOUTME: POST /api/user/booking-clicks — tracks when a user clicks a booking link.
// ABOUTME: Uses JWT-only auth (no token rotation) because sendBeacon discards responses.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyJWT } from "@/lib/auth";

const COOKIE_SESSION = "tct-session";

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  const sessionCookie = request.cookies.get(COOKIE_SESSION)?.value;
  if (!sessionCookie) {
    return NextResponse.json({ ok: true });
  }

  const user = await verifyJWT(sessionCookie, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  try {
    const { courseId, date, time } = (await request.json()) as {
      courseId?: string;
      date?: string;
      time?: string;
    };

    if (!courseId || !date || !time) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    await db
      .prepare(
        `INSERT OR IGNORE INTO booking_clicks (user_id, course_id, date, time, clicked_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(user.userId, courseId, date, time, new Date().toISOString())
      .run();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/user/booking-clicks:", err);
    return NextResponse.json({ ok: true });
  }
}
