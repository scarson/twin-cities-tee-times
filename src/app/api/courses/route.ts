// ABOUTME: API route listing all courses with their most recent poll status.
// ABOUTME: Returns course metadata joined with latest poll_log entry.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { sqliteIsoNow } from "@/lib/db";

export async function GET() {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  try {
    const result = await db
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
         ORDER BY c.state DESC, c.name ASC`
      )
      .all();

    return NextResponse.json({ courses: result.results });
  } catch (err) {
    console.error("courses list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
