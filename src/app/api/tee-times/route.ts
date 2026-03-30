// ABOUTME: API route querying cached tee times with optional date, course, time, and slot filters.
// ABOUTME: Returns tee times joined with course metadata.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { todayCT, nowTimeCT } from "@/lib/format";

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date parameter required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // Optional filters
  const courseIds = searchParams.get("courses")?.split(",").filter(Boolean);
  const startTime = searchParams.get("startTime"); // HH:MM
  const endTime = searchParams.get("endTime"); // HH:MM
  const holes = searchParams.get("holes"); // "9" or "18"
  const minSlots = searchParams.get("minSlots"); // minimum open slots

  // Validate startTime/endTime format (HH:MM)
  const timeRegex = /^\d{2}:\d{2}$/;
  if (startTime && !timeRegex.test(startTime)) {
    return NextResponse.json(
      { error: "Invalid startTime format (HH:MM)" },
      { status: 400 }
    );
  }
  if (endTime && !timeRegex.test(endTime)) {
    return NextResponse.json(
      { error: "Invalid endTime format (HH:MM)" },
      { status: 400 }
    );
  }

  // Validate minSlots is a positive integer
  if (minSlots && (Number.isNaN(parseInt(minSlots)) || parseInt(minSlots) < 1)) {
    return NextResponse.json(
      { error: "minSlots must be a positive integer" },
      { status: 400 }
    );
  }

  // Cap courses list to prevent unbounded IN clause
  if (courseIds && courseIds.length > 50) {
    return NextResponse.json(
      { error: "Too many course IDs (max 50)" },
      { status: 400 }
    );
  }

  let query = `
    SELECT t.*, c.name as course_name, c.city as course_city, c.state as course_state
    FROM tee_times t
    JOIN courses c ON t.course_id = c.id
    WHERE t.date = ? AND c.disabled = 0
  `;
  const bindings: unknown[] = [date];

  if (courseIds && courseIds.length > 0) {
    const placeholders = courseIds.map(() => "?").join(",");
    query += ` AND t.course_id IN (${placeholders})`;
    bindings.push(...courseIds);
  }

  // Hide tee times that have already passed when viewing today
  if (date === todayCT()) {
    query += " AND t.time > ?";
    bindings.push(nowTimeCT());
  }

  if (startTime) {
    query += " AND t.time >= ?";
    bindings.push(startTime);
  }

  if (endTime) {
    query += " AND t.time <= ?";
    bindings.push(endTime);
  }

  if (holes === "9" || holes === "18") {
    query += " AND t.holes = ?";
    bindings.push(parseInt(holes));
  }

  if (minSlots) {
    query += " AND t.open_slots >= ?";
    bindings.push(parseInt(minSlots));
  }

  query += " ORDER BY c.state DESC, t.time ASC";

  try {
    const result = await db.prepare(query).bind(...bindings).all();
    return NextResponse.json({
      date,
      teeTimes: result.results,
    });
  } catch (err) {
    console.error("tee-times query error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
