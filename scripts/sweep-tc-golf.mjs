// ABOUTME: Sweep Google Places for golf courses in the Twin Cities metro area.
// ABOUTME: Uses multiple location-biased textSearch calls to find courses, then cross-references catalog.
import { readFileSync } from "node:fs";

const envFile = readFileSync(".dev.vars", "utf8");
const API_KEY = envFile.match(/GOOGLE_MAPS_API_KEY=([^\s]+)/)?.[1];
const catalog = JSON.parse(readFileSync("src/config/courses.json", "utf8")).filter((c) => c.state === "MN");

// Catalog index by placeId AND by lowercased name (for fallback match)
const catalogByPlaceId = new Map(catalog.map((c) => [c.googlePlaceId, c]));
const catalogByName = new Map(catalog.map((c) => [c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), c]));

// Centers to sweep (roughly TC metro)
const centers = [
  { lat: 44.9778, lon: -93.265, label: "Minneapolis" },
  { lat: 44.9537, lon: -93.09, label: "St. Paul" },
  { lat: 44.82, lon: -93.48, label: "SW metro (Chaska/Shakopee/Prior Lake)" },
  { lat: 45.05, lon: -93.48, label: "NW metro (Plymouth/Maple Grove/Medina)" },
  { lat: 45.25, lon: -93.35, label: "Far north (Ham Lake/Elk River area)" },
  { lat: 44.85, lon: -92.95, label: "SE metro (Woodbury/Cottage Grove/Hastings)" },
  { lat: 45.05, lon: -92.85, label: "E metro (Stillwater/Lake Elmo)" },
  { lat: 44.7, lon: -93.25, label: "Far south (Lakeville/Apple Valley)" },
];

async function search(query, center, radiusM) {
  const body = {
    textQuery: query,
    maxResultCount: 20,
    locationBias: { circle: { center: { latitude: center.lat, longitude: center.lon }, radius: radiusM } },
    includedType: "golf_course",
  };
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.types,places.location",
      Referer: "https://teetimes.scarson.io/",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const data = await res.json();
  return { places: data.places || [] };
}

const allFound = new Map();
for (const center of centers) {
  const r = await search("public golf course", center, 15000);
  if (r.error) {
    console.log(center.label, "ERROR:", r.error);
    continue;
  }
  console.log(center.label, "→", r.places.length, "results");
  for (const p of r.places) {
    allFound.set(p.id, p);
  }
  await new Promise((f) => setTimeout(f, 200));
}

console.log("\nTotal unique places found:", allFound.size);

const NOT_IN_CATALOG = [];
for (const [placeId, place] of allFound) {
  if (catalogByPlaceId.has(placeId)) continue;
  // Fuzzy match by name
  const normName = (place.displayName?.text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fuzzyHit = [...catalogByName.keys()].some((k) => k === normName || (normName && k.includes(normName)) || (normName && normName.includes(k)));
  if (fuzzyHit) continue;
  NOT_IN_CATALOG.push(place);
}

console.log("\n=== Courses in TC metro NOT in catalog (", NOT_IN_CATALOG.length, ") ===");
for (const p of NOT_IN_CATALOG) {
  const site = p.websiteUri || "";
  const platformHint = site.match(/foreupsoftware\.com|cps\.golf|book\.teeitup|chronogolf|teesnap|membersports|teewire|eagleclub/i)?.[0] || "";
  console.log(`  ${(p.displayName?.text || "").padEnd(42)} | ${(p.formattedAddress || "").slice(0, 60)} | ${platformHint}`);
  if (site && !platformHint) console.log(`     website: ${site.slice(0, 80)}`);
}
