// ABOUTME: One-time script to look up Google Place IDs for all courses.
// ABOUTME: Uses the Places API (New) to find place_id for direct Google Maps links.

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error("Missing GOOGLE_MAPS_API_KEY. Set it in .dev.vars or environment.");
  process.exit(1);
}

interface Course {
  id: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googlePlaceId?: string;
  [key: string]: unknown;
}

const COURSES_PATH = join(__dirname, "../src/config/courses.json");

async function findPlaceId(course: Course): Promise<string | null> {
  // Use Text Search with the course name + address for best results
  const query = `${course.name} Golf ${course.address ?? ""}`.trim();

  const url = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery: query,
    maxResultCount: 1,
  };

  // If we have coordinates, bias results to that location
  if (course.latitude != null && course.longitude != null) {
    Object.assign(body, {
      locationBias: {
        circle: {
          center: { latitude: course.latitude, longitude: course.longitude },
          radius: 1000, // 1km radius
        },
      },
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY!,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      // API key is referrer-restricted; supply a referer allowed by the key.
      Referer: "http://localhost/",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  API error for ${course.name}: ${res.status} ${text}`);
    return null;
  }

  const data: { places?: Array<{ id: string; displayName?: { text: string }; formattedAddress?: string }> } = await res.json();
  const places = data.places ?? [];
  if (places.length === 0) {
    console.warn(`  No results for ${course.name}`);
    return null;
  }

  const place = places[0];
  console.log(`  ✓ ${course.name} → ${place.displayName?.text} (${place.formattedAddress})`);
  return place.id;
}

async function main() {
  const courses: Course[] = JSON.parse(readFileSync(COURSES_PATH, "utf8"));

  console.log(`Looking up Place IDs for ${courses.length} courses...\n`);

  let found = 0;
  let failed = 0;

  for (const course of courses) {
    if (course.googlePlaceId) {
      console.log(`  ⏭ ${course.name} — already has Place ID`);
      found++;
      continue;
    }

    const placeId = await findPlaceId(course);
    if (placeId) {
      course.googlePlaceId = placeId;
      found++;
    } else {
      failed++;
    }

    // 200ms delay between requests
    await new Promise((r) => setTimeout(r, 200));
  }

  writeFileSync(COURSES_PATH, JSON.stringify(courses, null, 2) + "\n");

  console.log(`\nDone. ${found} found, ${failed} failed.`);
  if (failed > 0) {
    console.log("Failed courses will need manual Place ID lookup.");
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
