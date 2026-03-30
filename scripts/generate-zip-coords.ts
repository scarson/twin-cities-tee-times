// ABOUTME: One-time script to generate US zip code coordinate lookup table.
// ABOUTME: Downloads Census Bureau ZCTA data and outputs public/zip-coords.json.

import { writeFileSync } from "fs";
import { join } from "path";

const GAZETTEER_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip";

async function main() {
  console.log("Downloading Census Bureau ZCTA gazetteer...");

  let response: Response;
  try {
    response = await fetch(GAZETTEER_URL);
  } catch (err) {
    console.error("Failed to reach Census Bureau URL:", err);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(
      `Census Bureau returned HTTP ${response.status}: ${response.statusText}`
    );
    process.exit(1);
  }

  // Download to a temp file, unzip, and read the .txt inside
  const { mkdtempSync, rmSync } = await import("fs");
  const { execSync } = await import("child_process");
  const { tmpdir } = await import("os");
  const tempDir = mkdtempSync(join(tmpdir(), "zcta-"));
  const zipPath = join(tempDir, "zcta.zip");

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(zipPath, buffer);

  // Extract using system unzip or PowerShell
  try {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`,
      { stdio: "pipe" }
    );
  } catch {
    // Try Unix unzip as fallback
    execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { stdio: "pipe" });
  }

  // Find the .txt file
  const { readdirSync, readFileSync } = await import("fs");
  const files = readdirSync(tempDir).filter((f) => f.endsWith(".txt"));
  if (files.length === 0) {
    console.error("No .txt file found in zip archive");
    process.exit(1);
  }

  const text = readFileSync(join(tempDir, files[0]), "utf8");

  // Clean up temp dir
  rmSync(tempDir, { recursive: true, force: true });

  const lines = text.split("\n");

  // First line is the header; column names are whitespace-padded
  const header = lines[0].split("\t").map((col) => col.trim());
  const geoidIdx = header.indexOf("GEOID");
  const latIdx = header.indexOf("INTPTLAT");
  const lngIdx = header.indexOf("INTPTLONG");

  if (geoidIdx === -1 || latIdx === -1 || lngIdx === -1) {
    console.error("Unexpected header format:", header);
    process.exit(1);
  }

  const result: Record<string, [number, number]> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split("\t").map((col) => col.trim());
    const zip = cols[geoidIdx];
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);

    if (!zip || zip.length !== 5 || isNaN(lat) || isNaN(lng)) continue;

    result[zip] = [
      Math.round(lat * 10000) / 10000,
      Math.round(lng * 10000) / 10000,
    ];
  }

  const outPath = join(__dirname, "..", "public", "zip-coords.json");
  writeFileSync(outPath, JSON.stringify(result));
  console.log(`Wrote ${Object.keys(result).length} entries to ${outPath}`);
}

main();
