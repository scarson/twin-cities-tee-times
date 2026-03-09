import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

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

  let query = `
    SELECT t.*, c.name as course_name, c.city as course_city
    FROM tee_times t
    JOIN courses c ON t.course_id = c.id
    WHERE t.date = ?
  `;
  const bindings: unknown[] = [date];

  if (courseIds && courseIds.length > 0) {
    const placeholders = courseIds.map(() => "?").join(",");
    query += ` AND t.course_id IN (${placeholders})`;
    bindings.push(...courseIds);
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

  query += " ORDER BY t.time ASC";

  const result = await db.prepare(query).bind(...bindings).all();

  return NextResponse.json({
    date,
    teeTimes: result.results,
  });
}
