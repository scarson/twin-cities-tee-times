// ABOUTME: Enrich a draft course list with Google Places data: address, lat/lon, placeId.
// ABOUTME: Input: JSON array of { name, city, state, ... } objects (stdin or file arg). Output: enriched JSON to stdout.
import { readFileSync } from "node:fs";

const input = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : JSON.parse(readFileSync(0, "utf8"));
const envFile = readFileSync(".dev.vars", "utf8");
const API_KEY = envFile.match(/GOOGLE_MAPS_API_KEY=([^\s]+)/)?.[1];
if (!API_KEY) {
  console.error("GOOGLE_MAPS_API_KEY not found in .dev.vars");
  process.exit(1);
}

async function searchText(query, bias) {
  const body = { textQuery: query, maxResultCount: 1 };
  if (bias) {
    body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lon }, radius: 2000 } };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      Referer: "https://teetimes.scarson.io/",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    return { error: `${res.status}: ${t.slice(0, 120)}` };
  }
  const data = await res.json();
  const p = data.places?.[0];
  if (!p) return { error: "no results" };
  return {
    placeId: p.id,
    displayName: p.displayName?.text,
    formattedAddress: p.formattedAddress,
    lat: p.location?.latitude,
    lon: p.location?.longitude,
  };
}

const out = [];
for (const entry of input) {
  const queryParts = [entry.name, entry.city, entry.state || "MN", "golf course"].filter(Boolean);
  const query = queryParts.join(" ");
  const bias = entry.latitude && entry.longitude ? { lat: entry.latitude, lon: entry.longitude } : null;
  const result = await searchText(query, bias);
  const enriched = { ...entry, _google: result };
  out.push(enriched);
  await new Promise((f) => setTimeout(f, 150));
}

console.log(JSON.stringify(out, null, 2));
