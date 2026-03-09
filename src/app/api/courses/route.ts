import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  const { env } = await getCloudflareContext();
  const db = env.DB;

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
       ) p ON c.id = p.course_id AND p.rn = 1
       ORDER BY c.name`
    )
    .all();

  return NextResponse.json({ courses: result.results });
}
