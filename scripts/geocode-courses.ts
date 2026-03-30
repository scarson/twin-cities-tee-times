// ABOUTME: One-time geocoding script to add lat/lng to courses.json.
// ABOUTME: Uses Census Bureau geocoder to convert addresses to coordinates.

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

interface Course {
  [key: string]: unknown;
  address: string;
  name: string;
}

interface CensusResponse {
  result: {
    addressMatches: Array<{
      coordinates: {
        x: number; // longitude
        y: number; // latitude
      };
    }>;
  };
}

const COURSES_PATH = resolve(__dirname, "../src/config/courses.json");
const CENSUS_API =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocode(
  address: string
): Promise<{ latitude: number; longitude: number } | null> {
  const url = `${CENSUS_API}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    console.error(
      `Census API error: ${response.status} ${response.statusText}`
    );
    process.exit(1);
  }

  const data = (await response.json()) as CensusResponse;

  if (!data.result?.addressMatches?.length) {
    return null;
  }

  const { x, y } = data.result.addressMatches[0].coordinates;
  return {
    latitude: Math.round(y * 10000) / 10000,
    longitude: Math.round(x * 10000) / 10000,
  };
}

async function main() {
  const courses: Course[] = JSON.parse(readFileSync(COURSES_PATH, "utf-8"));
  console.log(`Geocoding ${courses.length} courses...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    console.log(`[${i + 1}/${courses.length}] ${course.name}: ${course.address}`);

    const coords = await geocode(course.address);

    if (coords) {
      // Insert latitude/longitude right after the address field
      const entries = Object.entries(course);
      const newEntries: [string, unknown][] = [];
      for (const [key, value] of entries) {
        newEntries.push([key, value]);
        if (key === "address") {
          newEntries.push(["latitude", coords.latitude]);
          newEntries.push(["longitude", coords.longitude]);
        }
      }
      courses[i] = Object.fromEntries(newEntries) as Course;
      console.log(`  ✓ ${coords.latitude}, ${coords.longitude}`);
      success++;
    } else {
      console.warn(`  ⚠ No match for: ${course.address}`);
      failed++;
    }

    if (i < courses.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  writeFileSync(COURSES_PATH, JSON.stringify(courses, null, 2) + "\n");
  console.log(`\nDone: ${success} geocoded, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
