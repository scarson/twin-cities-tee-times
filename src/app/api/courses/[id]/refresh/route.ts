// ABOUTME: API route for user-triggered tee time refresh on a single course.
// ABOUTME: Enforces rate limiting and returns poll result status.
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
  // Default to today in Central Time — all courses are in the Twin Cities metro
  const date = dateParam ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Invalid date format (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const rateCheck = await checkRefreshAllowed(db, id, date);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { message: rateCheck.reason },
      { status: 429 }
    );
  }

  try {
    const result = await pollCourse(db, course, date, env);

    if (result === "error") {
      return NextResponse.json(
        { error: "Refresh failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Refreshed", courseId: id, date, result });
  } catch (err) {
    console.error("Refresh exception:", err);
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 500 }
    );
  }
}
