import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { pollCourse } from "@/lib/poller";
import { checkRefreshAllowed } from "@/lib/rate-limit";
import type { CourseRow } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { env } = await getCloudflareContext();
  const db = env.DB;

  // Look up the course
  const course = await db
    .prepare("SELECT * FROM courses WHERE id = ?")
    .bind(id)
    .first<CourseRow>();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // Get date from query param or default to today
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const date = dateParam ?? new Date().toISOString().split("T")[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Invalid date format (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const rateCheck = await checkRefreshAllowed(db, id);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { message: rateCheck.reason },
      { status: 429 }
    );
  }

  await pollCourse(db, course, date);

  return NextResponse.json({ message: "Refreshed", courseId: id, date });
}
