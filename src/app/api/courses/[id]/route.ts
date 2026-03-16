// ABOUTME: API route returning detail for a single course by ID.
// ABOUTME: Includes latest poll status from poll_log.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { sqliteIsoNow } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { env } = await getCloudflareContext();
  const db = env.DB;

  try {
    const course = await db
      .prepare(
        `SELECT c.id, c.name, c.city, c.platform, c.booking_url, c.is_active,
                p.polled_at as last_polled,
                p.status as last_poll_status
         FROM courses c
         LEFT JOIN (
           SELECT course_id, polled_at, status,
                  ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC) as rn
           FROM poll_log
           WHERE polled_at > ${sqliteIsoNow("-24 hours")}
             AND status IN ('success', 'no_data')
         ) p ON c.id = p.course_id AND p.rn = 1
         WHERE c.id = ?`
      )
      .bind(id)
      .first();

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    return NextResponse.json({ course });
  } catch (err) {
    console.error("course detail error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
