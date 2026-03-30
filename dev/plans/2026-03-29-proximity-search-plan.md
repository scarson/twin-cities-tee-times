# Proximity Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add location-based proximity filtering and sorting to the tee times and courses pages, allowing users to find courses within X miles of their location (GPS or zip code).

**Architecture:** Pure client-side distance calculation using the Haversine formula. Course coordinates are static data in `courses.json`. User location comes from browser GPS (ephemeral, never stored) or zip code (persisted to localStorage / user_settings). A shared React context provides location state across pages. No API changes needed.

**Tech Stack:** React 19 context + hooks, Haversine formula, Census Bureau ZCTA data for zip lookup, browser Geolocation API.

**Design doc:** `docs/plans/2026-03-29-proximity-search-design.md`

---

## Task 1: Haversine Distance Utility

**Files:**
- Create: `src/lib/distance.ts`
- Create: `src/lib/distance.test.ts`

This task is self-contained. No dependencies on other tasks.

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`
Follow TDD: write failing test → implement fix → verify green.

**Step 1: Write the failing tests**

Create `src/lib/distance.test.ts`:

```typescript
// ABOUTME: Tests for Haversine distance calculation utility.
// ABOUTME: Validates distance accuracy for known city pairs and edge cases.
import { describe, it, expect } from "vitest";
import { haversineDistance } from "./distance";

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(44.9778, -93.2650, 44.9778, -93.2650)).toBe(0);
  });

  it("calculates Minneapolis to St. Paul (~10 miles)", () => {
    // Minneapolis City Hall to St. Paul Capitol
    const dist = haversineDistance(44.9778, -93.2650, 44.9544, -93.1022);
    expect(dist).toBeGreaterThan(8);
    expect(dist).toBeLessThan(12);
  });

  it("calculates Minneapolis to Chaska (~25 miles)", () => {
    const dist = haversineDistance(44.9778, -93.2650, 44.7894, -93.6022);
    expect(dist).toBeGreaterThan(20);
    expect(dist).toBeLessThan(30);
  });

  it("calculates Minneapolis to Duluth (~150 miles)", () => {
    const dist = haversineDistance(44.9778, -93.2650, 46.7867, -92.1005);
    expect(dist).toBeGreaterThan(140);
    expect(dist).toBeLessThan(160);
  });

  it("handles negative longitudes correctly", () => {
    // Both points in Western hemisphere — should work the same as positive
    const dist = haversineDistance(44.9778, -93.2650, 44.9544, -93.1022);
    expect(dist).toBeGreaterThan(0);
  });

  it("returns distance in miles (not km)", () => {
    // NYC to LA is ~2,451 miles. If we get ~3,944 that's km.
    const dist = haversineDistance(40.7128, -74.0060, 34.0522, -118.2437);
    expect(dist).toBeGreaterThan(2400);
    expect(dist).toBeLessThan(2500);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/distance.test.ts`
Expected: FAIL — `haversineDistance` does not exist.

**Step 3: Write the implementation**

Create `src/lib/distance.ts`:

```typescript
// ABOUTME: Haversine formula for great-circle distance between two lat/lng points.
// ABOUTME: Returns distance in miles. Used for client-side proximity filtering.

const EARTH_RADIUS_MILES = 3958.8;

/** Calculate great-circle distance between two points in miles. */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/distance.test.ts`
Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add src/lib/distance.ts src/lib/distance.test.ts
git commit -m "feat: add Haversine distance utility"
```

BEFORE marking this task complete:
1. Review your tests against `dev/testing-pitfalls.md`
2. Verify test coverage of the fix (are error paths tested? edge cases?)
3. Run tests and confirm green

---

## Task 2: Add Coordinates to courses.json

**Files:**
- Modify: `src/config/courses.json` — add `latitude` and `longitude` to every entry
- Create: `scripts/geocode-courses.ts` — one-time script to geocode addresses

This task is self-contained. No dependencies on other tasks.

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`

**Step 1: Create the geocoding script**

Create `scripts/geocode-courses.ts`. This script:
1. Reads `src/config/courses.json`
2. For each course, calls the Census Bureau geocoding API (`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress`) with the address
3. Extracts the lat/lng from the response
4. Writes updated entries back to `courses.json` with `latitude` and `longitude` fields

The Census Bureau geocoder is free, requires no API key, and handles US addresses well.

API endpoint: `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`

Response shape: `{ result: { addressMatches: [{ coordinates: { x: longitude, y: latitude } }] } }`

Note: The Census API returns `x` = longitude, `y` = latitude (GIS convention).

Add a 500ms delay between requests to be polite to the free API.

Round coordinates to 4 decimal places (~11m accuracy — more than enough for "how far is this golf course" and avoids bloating the JSON).

If a geocode fails (no `addressMatches`), log a warning and skip that course — we'll look up those coordinates manually.

**If the Census Bureau API is unreachable or returns errors**, log the error and exit the script. Do NOT try alternative geocoding APIs or workarounds — flag it for Sam.

**Step 2: Run the geocoding script**

Run: `npx tsx scripts/geocode-courses.ts`

Review the output. Verify a few courses by spot-checking coordinates on Google Maps. Each course entry in `courses.json` should now have `latitude` and `longitude` fields:

```json
{
  "index": 17,
  "id": "theodore-wirth-18",
  "name": "Theodore Wirth",
  "latitude": 44.9876,
  "longitude": -93.3201,
  ...
}
```

**Step 3: Manually fix any failed geocodes**

If the Census API returned no match for some addresses, look up the course on Google Maps and manually add the coordinates. All 43 courses must have lat/lng.

**Step 4: Commit**

```bash
git add src/config/courses.json scripts/geocode-courses.ts
git commit -m "feat: add lat/lng coordinates to all courses"
```

BEFORE marking this task complete:
1. Verify every course in `courses.json` has `latitude` and `longitude` fields
2. Spot-check 3-4 coordinates by pasting them into Google Maps — they should land on or very near the golf course
3. Run `npm test` to make sure existing tests still pass (the courses.json schema change shouldn't break anything, but verify)

---

## Task 3: Update mapsUrl() and Fix Google Maps Links

**Files:**
- Modify: `src/config/areas.ts` — change `mapsUrl()` signature and implementation
- Modify: `src/config/areas.test.ts` — update tests for new `mapsUrl()`
- Modify: `src/app/courses/page.tsx` — update `mapsUrl()` call site
- Modify: `src/app/courses/[id]/page.tsx` — add address with Maps link

This task depends on: none (but ideally runs after Task 2 since courses.json will have new fields).

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`
Follow TDD: write failing test → implement fix → verify green.

**Context:** Currently `mapsUrl(address)` in `src/config/areas.ts:87-89` generates a Google Maps link that searches by street address. This resolves to a generic pin. We want to search by course name + city + state, which resolves to the actual business listing (with hours, reviews, photos).

**Step 1: Update the test for the new mapsUrl signature**

In `src/config/areas.test.ts`, replace the existing `mapsUrl` tests (lines 157-170):

```typescript
describe("mapsUrl", () => {
  it("builds a Google Maps search URL from course name, city, and state", () => {
    const url = mapsUrl("Columbia Golf Club", "Minneapolis", "MN");
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=Columbia%20Golf%20Club%20Minneapolis%20MN"
    );
  });

  it("encodes special characters", () => {
    const url = mapsUrl("Ft. Snelling", "St. Paul", "MN");
    expect(url).toContain("Ft.%20Snelling");
    expect(url).toContain("St.%20Paul");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/areas.test.ts`
Expected: FAIL — `mapsUrl` now expects 3 args but gets 1.

**Step 3: Update mapsUrl implementation**

In `src/config/areas.ts`, change `mapsUrl` (line 87-89):

Current:
```typescript
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
```

New:
```typescript
export function mapsUrl(name: string, city: string, state: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${city} ${state}`)}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/areas.test.ts`
Expected: All tests PASS.

**Step 5: Update call site in courses page**

In `src/app/courses/page.tsx`, the `mapsUrl` call is at line 124. The `CatalogCourse` interface (line 13) needs `name`, `city`, and `state` added to it if not already present. Currently the interface has `city` but not `state`.

Add `state?: string;` to the `CatalogCourse` interface.

Change line 124 from:
```typescript
href={mapsUrl(course.address)}
```
to:
```typescript
href={mapsUrl(course.name, course.city, course.state ?? "MN")}
```

**Step 6: Add address to course detail page**

In `src/app/courses/[id]/page.tsx`, the course detail page currently shows name, city, and booking link, but NOT the address. Read `src/config/courses.json` to get the address for the current course.

Import `courseCatalog` and `mapsUrl`:
```typescript
import courseCatalog from "@/config/courses.json";
import { mapsUrl } from "@/config/areas";
```

Inside the component, derive the address from the catalog (do NOT use an inline IIFE in JSX — extract it as a const before the return):
```typescript
const catalogEntry = courseCatalog.find((c) => c.id === id) as { address?: string; state?: string; name?: string } | undefined;
```

After the city paragraph (line 79 `<p className="text-sm text-gray-500 ...`), add the address:
```typescript
{catalogEntry?.address && (
  <a
    href={mapsUrl(course.name, course.city, catalogEntry.state ?? "MN")}
    target="_blank"
    rel="noopener noreferrer"
    className="block text-xs text-gray-400 hover:text-green-700 lg:text-sm"
  >
    {catalogEntry.address}
  </a>
)}
```

**Step 7: Run full tests and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests PASS, no type errors.

**Step 8: Commit**

```bash
git add src/config/areas.ts src/config/areas.test.ts src/app/courses/page.tsx src/app/courses/\[id\]/page.tsx
git commit -m "feat: improve Maps links to show business listings, add address to course detail"
```

BEFORE marking this task complete:
1. Review your tests against `dev/testing-pitfalls.md`
2. Verify `mapsUrl` tests cover the new 3-argument signature
3. Run tests and confirm green

---

## Task 4: Generate Zip Code Lookup File

**Files:**
- Create: `scripts/generate-zip-coords.ts`
- Create: `public/zip-coords.json`

This task is self-contained. No dependencies on other tasks.

**Context:** We need a static JSON file mapping all ~42K US zip codes to their centroid latitude/longitude. This file is served from `/public` and fetched lazily by the client when the user first interacts with the proximity feature.

**Step 1: Create the generation script**

Create `scripts/generate-zip-coords.ts`. This script:
1. Downloads the Census Bureau ZCTA (Zip Code Tabulation Area) gazetteer file from `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.txt`
2. This is a tab-delimited text file with columns: GEOID (5-digit zip), ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG
3. Parses each line, extracting the GEOID (zip), INTPTLAT (latitude), and INTPTLONG (longitude)
4. Writes the result to `public/zip-coords.json` as an object: `{ "55414": [44.9631, -93.2296], "55415": [...], ... }`
5. Using `[lat, lng]` tuples instead of objects saves significant file size

The array format `{ "zip": [lat, lng] }` is compact — roughly 30 bytes per entry vs 55 for `{ "zip": { "lat": n, "lng": n } }`.

Round coordinates to 4 decimal places (~11m accuracy — more than enough for zip centroid purposes, and reduces file size significantly).

Note: ZCTAs (Zip Code Tabulation Areas) don't cover every zip code — PO box and military zips may be absent. This is fine; the UI will show "Zip code not found" for those.

**The gazetteer file header has whitespace-padded column names.** Use `.trim()` on all parsed values.

**If the Census Bureau download URL is unreachable**, log the error and exit. Do NOT try alternative data sources — flag it for Sam.

**Step 2: Run the generation script**

Run: `npx tsx scripts/generate-zip-coords.ts`

Verify:
- `public/zip-coords.json` exists and is ~1-2MB
- Spot-check a few zip codes (e.g., `"55414"` should be in Minneapolis, `"85001"` should be in Phoenix)
- The file should contain ~33K-42K entries

**Step 3: Commit**

```bash
git add scripts/generate-zip-coords.ts public/zip-coords.json
git commit -m "feat: add US zip code coordinate lookup table"
```

BEFORE marking this task complete:
1. Verify file size is reasonable (1-2MB)
2. Spot-check 3 zip codes by pasting coordinates into Google Maps
3. Verify the file is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('public/zip-coords.json', 'utf8'))"`

---

## Review Checkpoint: Tasks 1-4

After completing tasks 1-4:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.

Verify:
- `npm test` passes
- `npx tsc --noEmit` passes
- All courses in `courses.json` have `latitude` and `longitude`
- `public/zip-coords.json` exists and has data
- `mapsUrl` tests reflect the new signature

---

## Task 5: Location Context Provider and Hook

**Files:**
- Create: `src/context/location-provider.tsx`
- Create: `src/hooks/use-location.ts`
- Create: `src/hooks/use-location.test.ts`
- Modify: `src/app/layout.tsx` — wrap with LocationProvider

This task depends on: Task 4 (zip-coords.json must exist).

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`
Follow TDD: write failing test → implement fix → verify green.

**Context:** We need a React context to share location state between pages. The context provides:
- `location: { lat: number; lng: number; label: string } | null` — the user's current location (GPS or resolved from zip)
- `zip: string` — the stored zip code (persisted)
- `radiusMiles: number` — selected radius (persisted)
- `setZip(zip: string)` — sets location from a zip code (looks up coords from zip-coords.json)
- `requestGps()` — requests browser geolocation and sets location
- `setRadiusMiles(r: number)` — updates radius
- `clearLocation()` — clears the active location
- `gpsLoading: boolean` — whether GPS is being requested
- `gpsError: string | null` — GPS error message

**localStorage keys** (all use `tct-` prefix per project convention):
- `tct-zip` — stored zip code
- `tct-radius` — stored radius in miles

**Privacy rules:**
- GPS coordinates: set in React state ONLY. Never written to localStorage, never sent to server.
- Zip code: written to localStorage on entry. For authenticated users, also POST to `/api/user/settings` (key: `zip_code`) — but this API route does NOT exist yet and should NOT be built in this task. Just persist to localStorage for now.
- Label: "your location" for GPS, the zip code string for zip input.

**Step 1: Write tests for the hook logic**

The hook logic (zip validation, localStorage read/write, radius defaults) is testable. GPS and fetch are harder to unit test — focus on the pure logic.

Create `src/hooks/use-location.test.ts`:

```typescript
// ABOUTME: Tests for location hook utility functions.
// ABOUTME: Validates zip code format validation and radius options.
import { describe, it, expect } from "vitest";
import { isValidZip, RADIUS_OPTIONS, DEFAULT_RADIUS } from "@/hooks/use-location";

describe("isValidZip", () => {
  it("accepts 5-digit zip codes", () => {
    expect(isValidZip("55414")).toBe(true);
    expect(isValidZip("85001")).toBe(true);
    expect(isValidZip("00501")).toBe(true);
  });

  it("rejects non-5-digit strings", () => {
    expect(isValidZip("5541")).toBe(false);
    expect(isValidZip("554141")).toBe(false);
    expect(isValidZip("")).toBe(false);
    expect(isValidZip("abcde")).toBe(false);
  });

  it("rejects strings with spaces", () => {
    expect(isValidZip(" 55414")).toBe(false);
    expect(isValidZip("55414 ")).toBe(false);
  });
});

describe("RADIUS_OPTIONS", () => {
  it("contains the specified radius values", () => {
    expect(RADIUS_OPTIONS).toEqual([5, 10, 25, 50, 100]);
  });
});

describe("DEFAULT_RADIUS", () => {
  it("is 25 miles", () => {
    expect(DEFAULT_RADIUS).toBe(25);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/use-location.test.ts`
Expected: FAIL — module not found.

**Step 3: Create the location hook**

Create `src/hooks/use-location.ts`:

```typescript
"use client";
// ABOUTME: React hook for location state management with zip and GPS input.
// ABOUTME: Persists zip and radius to localStorage; GPS coordinates are ephemeral.

import { useContext } from "react";
import { LocationContext } from "@/context/location-provider";

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS = 25;

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return ctx;
}
```

**Step 4: Create the LocationProvider context**

Create `src/context/location-provider.tsx`:

```typescript
"use client";
// ABOUTME: React context providing shared location state across pages.
// ABOUTME: Manages GPS, zip code lookup, radius selection, and localStorage persistence.

import { createContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { isValidZip, DEFAULT_RADIUS } from "@/hooks/use-location";

export interface LocationState {
  lat: number;
  lng: number;
  label: string;
}

export interface LocationContextValue {
  location: LocationState | null;
  zip: string;
  radiusMiles: number;
  gpsLoading: boolean;
  gpsError: string | null;
  setZip: (zip: string) => Promise<void>;
  requestGps: () => void;
  setRadiusMiles: (r: number) => void;
  clearLocation: () => void;
}

export const LocationContext = createContext<LocationContextValue | null>(null);

const LS_ZIP_KEY = "tct-zip";
const LS_RADIUS_KEY = "tct-radius";

function readStoredZip(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_ZIP_KEY) ?? "";
  } catch {
    return "";
  }
}

function readStoredRadius(): number {
  if (typeof window === "undefined") return DEFAULT_RADIUS;
  try {
    const val = localStorage.getItem(LS_RADIUS_KEY);
    if (!val) return DEFAULT_RADIUS;
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : DEFAULT_RADIUS;
  } catch {
    return DEFAULT_RADIUS;
  }
}

// Cache for zip-coords.json — loaded once, reused
let zipCoordsCache: Record<string, [number, number]> | null = null;

async function loadZipCoords(): Promise<Record<string, [number, number]>> {
  if (zipCoordsCache) return zipCoordsCache;
  const res = await fetch("/zip-coords.json");
  if (!res.ok) throw new Error("Failed to load zip coordinates");
  zipCoordsCache = await res.json();
  return zipCoordsCache!;
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [zip, setZipState] = useState<string>(readStoredZip);
  const [radiusMiles, setRadiusState] = useState<number>(readStoredRadius);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // On mount, if we have a stored zip, resolve it to coordinates.
  // IMPORTANT: This MUST be in useEffect, not during render — React 18
  // concurrent mode can interrupt and restart renders, and setting state
  // from a .then() during an abandoned render causes bugs.
  useEffect(() => {
    const storedZip = readStoredZip();
    if (isValidZip(storedZip)) {
      loadZipCoords().then((coords) => {
        const entry = coords[storedZip];
        if (entry) {
          setLocation({ lat: entry[0], lng: entry[1], label: storedZip });
        }
      }).catch(() => {
        // Zip coords failed to load — no location, that's fine
      });
    }
  }, []);

  const setZip = useCallback(async (newZip: string) => {
    if (!isValidZip(newZip)) return;

    try {
      const coords = await loadZipCoords();
      const entry = coords[newZip];
      if (!entry) {
        setGpsError(`Zip code ${newZip} not found`);
        return;
      }
      setZipState(newZip);
      setLocation({ lat: entry[0], lng: entry[1], label: newZip });
      setGpsError(null);
      localStorage.setItem(LS_ZIP_KEY, newZip);
    } catch {
      setGpsError("Failed to load zip code data");
    }
  }, []);

  const requestGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser");
      return;
    }

    setGpsLoading(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "your location",
        });
        setGpsLoading(false);
        // GPS coordinates are NOT persisted — privacy constraint
      },
      (error) => {
        const messages: Record<number, string> = {
          [GeolocationPositionError.PERMISSION_DENIED]: "Location permission denied",
          [GeolocationPositionError.POSITION_UNAVAILABLE]: "Location unavailable",
          [GeolocationPositionError.TIMEOUT]: "Location request timed out",
        };
        setGpsError(messages[error.code] ?? "Failed to get location");
        setGpsLoading(false);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  const setRadiusMiles = useCallback((r: number) => {
    setRadiusState(r);
    try {
      localStorage.setItem(LS_RADIUS_KEY, String(r));
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Intentionally keeps radius in localStorage when clearing —
  // users shouldn't have to re-select their preferred radius each time.
  const clearLocation = useCallback(() => {
    setLocation(null);
    setZipState("");
    setGpsError(null);
    try {
      localStorage.removeItem(LS_ZIP_KEY);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return (
    <LocationContext.Provider
      value={{
        location,
        zip,
        radiusMiles,
        gpsLoading,
        gpsError,
        setZip,
        requestGps,
        setRadiusMiles,
        clearLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
```

**Step 5: Wrap layout with LocationProvider**

In `src/app/layout.tsx`, add the import and wrap children:

Current (lines 14-29):
```typescript
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#faf7f2] text-gray-900">
        <AuthProvider>
          <Nav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

New:
```typescript
import { LocationProvider } from "@/context/location-provider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#faf7f2] text-gray-900">
        <AuthProvider>
          <LocationProvider>
            <Nav />
            {children}
          </LocationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
```

**Step 6: Run tests and type-check**

Run: `npx vitest run src/hooks/use-location.test.ts && npx vitest run && npx tsc --noEmit`
Expected: All tests PASS, no type errors.

**Step 7: Commit**

```bash
git add src/context/location-provider.tsx src/hooks/use-location.ts src/hooks/use-location.test.ts src/app/layout.tsx
git commit -m "feat: add location context provider and useLocation hook"
```

BEFORE marking this task complete:
1. Review your tests against `dev/testing-pitfalls.md`
2. **Pitfall 7.4 — localStorage resilience**: The provider reads from localStorage on init. Verify it handles: (a) localStorage unavailable, (b) malformed stored values, (c) invalid stored radius. The code above handles these — verify it does.
3. Run tests and confirm green

---

## Task 6: LocationFilter UI Component

**Files:**
- Create: `src/components/location-filter.tsx`

This task depends on: Task 5 (LocationProvider and useLocation hook must exist).

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`

**Context:** This is a shared collapsible UI component used on both the tee times and courses pages. It renders:
- A collapsible header that shows "Filter by location" when collapsed, or "Within X mi of {label}" when a location is active
- When expanded: GPS button, zip input, radius dropdown, clear button
- Uses `useLocation()` hook for all state management

Match the existing UI style: Tailwind CSS classes, `text-green-700` for active elements, `bg-stone-100` for inactive buttons, same responsive breakpoints (`lg:` prefix) as `TimeFilter` component.

**Step 1: Create the component**

Create `src/components/location-filter.tsx`:

```typescript
"use client";
// ABOUTME: Collapsible location filter for proximity-based course filtering.
// ABOUTME: Provides GPS and zip code input with radius selection.

import { useState } from "react";
import { useLocation } from "@/hooks/use-location";
import { RADIUS_OPTIONS } from "@/hooks/use-location";

export function LocationFilter() {
  const {
    location,
    zip,
    radiusMiles,
    gpsLoading,
    gpsError,
    setZip,
    requestGps,
    setRadiusMiles,
    clearLocation,
  } = useLocation();

  const [expanded, setExpanded] = useState(false);
  const [zipInput, setZipInput] = useState(zip);

  const hasLocation = location !== null;

  const handleZipSubmit = () => {
    const trimmed = zipInput.trim();
    // Only trigger lookup if zip changed (avoids redundant fetches on blur)
    if (trimmed.length === 5 && trimmed !== zip) {
      setZip(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleZipSubmit();
    }
  };

  // Collapsed state with active location — show summary
  if (!expanded && hasLocation) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-2 flex items-center gap-1.5 text-sm text-green-700 hover:underline lg:text-base"
      >
        <span>📍</span>
        <span>Within {radiusMiles} mi of {location.label}</span>
      </button>
    );
  }

  // Collapsed state, no location — show toggle
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-2 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 lg:text-base"
      >
        <span>📍</span>
        <span>Filter by location</span>
      </button>
    );
  }

  // Expanded state
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 lg:p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 lg:text-base">
          📍 Filter by location
        </span>
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          collapse
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={requestGps}
          disabled={gpsLoading}
          className="rounded bg-stone-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-stone-200 disabled:opacity-50 lg:text-sm"
        >
          {gpsLoading ? "Locating…" : "Use my location"}
        </button>

        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            placeholder="Zip code"
            value={zipInput}
            onChange={(e) => setZipInput(e.target.value.replace(/\D/g, ""))}
            onKeyDown={handleKeyDown}
            onBlur={handleZipSubmit}
            className="w-20 rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 lg:text-sm"
          />
        </div>

        <select
          value={radiusMiles}
          onChange={(e) => setRadiusMiles(Number(e.target.value))}
          className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 lg:text-sm"
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r} mi
            </option>
          ))}
        </select>

        {hasLocation && (
          <button
            onClick={() => {
              clearLocation();
              setZipInput("");
            }}
            className="text-xs text-gray-400 hover:text-red-500"
          >
            Clear
          </button>
        )}
      </div>

      {gpsError && (
        <p className="mt-1 text-xs text-red-500">{gpsError}</p>
      )}

      {hasLocation && (
        <p className="mt-1 text-xs text-green-700">
          Within {radiusMiles} mi of {location.label}
        </p>
      )}
    </div>
  );
}
```

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/location-filter.tsx
git commit -m "feat: add LocationFilter collapsible UI component"
```

BEFORE marking this task complete:
1. Verify the component uses `useLocation()` for all state — no direct localStorage access
2. Verify GPS coordinates are never written to storage
3. Verify the component matches the project's UI conventions (Tailwind classes, responsive `lg:` breakpoints)

---

## Task 7: Integrate Proximity into Tee Times Page

**Files:**
- Modify: `src/app/page.tsx` — add LocationFilter, filter/sort by distance
- Modify: `src/components/tee-time-list.tsx` — accept and display distance badges

This task depends on: Tasks 1 (distance.ts), 2 (courses.json with coords), 5 (useLocation hook), 6 (LocationFilter component).

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`

**Context:** The tee times page currently shows a flat time-sorted list (no course grouping). When proximity is active, we need to:
1. Calculate distance from user to each course
2. Filter out courses beyond the radius
3. Sort remaining tee times by distance (nearest course first), then by time within each course
4. Show distance badges next to course names on each row

**IMPORTANT: Do NOT add course group headers or change the TeeTimeList component structure.** The existing flat list naturally clusters by course when sorted by distance. Each row already shows the course name inline — just add a distance badge next to it.

The tee time data comes back from the API with `course_id`, `course_name`, `course_city` on each item. We need to look up course lat/lng from the static `courses.json` catalog to calculate distance.

**Note on `courseCatalog` in useMemo deps:** `courseCatalog` is a static JSON import that never changes at runtime. It's safe to omit from the useMemo dependency array. If ESLint's `exhaustive-deps` rule warns about it, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with a comment explaining it's a static import.

**Step 1: Read the current files**

Read `src/app/page.tsx` and `src/components/tee-time-list.tsx` in full to understand the current structure before modifying.

**Step 2: Add distance badge prop to TeeTimeList**

In `src/components/tee-time-list.tsx`:

Add to the `TeeTimeItem` interface:
```typescript
distance?: number; // miles from user, if proximity is active
```

In the rendering code, next to the course city display (line 129, `<span className="text-xs text-gray-400 lg:text-sm">{tt.course_city}</span>`), add a distance badge:
```typescript
<span className="text-xs text-gray-400 lg:text-sm">{tt.course_city}</span>
{tt.distance != null && (
  <span className="text-xs text-green-700 lg:text-sm">
    {tt.distance.toFixed(1)} mi
  </span>
)}
```

**Step 3: Add proximity filtering to the home page**

In `src/app/page.tsx`:

Add imports at the top:
```typescript
import { LocationFilter } from "@/components/location-filter";
import { useLocation } from "@/hooks/use-location";
import { haversineDistance } from "@/lib/distance";
```

Inside the `Home` component, add:
```typescript
const { location, radiusMiles } = useLocation();
```

After the API data is fetched and merged (after `merged.sort(...)` around line 103), add proximity filtering/sorting logic. This should happen in a `useMemo` that wraps the tee times before passing to `TeeTimeList`:

```typescript
import { useMemo } from "react";
// ... (add to existing imports)

// After the existing teeTimes state, add:
const displayTeeTimes = useMemo(() => {
  if (!location) return teeTimes;

  // Build a map of course distances
  const courseDistances = new Map<string, number>();
  for (const course of courseCatalog as Array<{ id: string; latitude?: number; longitude?: number }>) {
    if (course.latitude != null && course.longitude != null) {
      courseDistances.set(
        course.id,
        haversineDistance(location.lat, location.lng, course.latitude, course.longitude)
      );
    }
  }

  // Filter by radius and add distance to each tee time
  const filtered = teeTimes
    .map((tt) => ({
      ...tt,
      distance: courseDistances.get(tt.course_id),
    }))
    .filter((tt) => tt.distance != null && tt.distance <= radiusMiles);

  // Sort by distance (nearest course first), then by time within each course
  filtered.sort((a, b) => {
    const distDiff = (a.distance ?? 0) - (b.distance ?? 0);
    if (Math.abs(distDiff) > 0.01) return distDiff;
    return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
  });

  return filtered;
}, [teeTimes, location, radiusMiles]);
```

Then pass `displayTeeTimes` to `TeeTimeList` instead of `teeTimes`:
```typescript
<TeeTimeList teeTimes={displayTeeTimes} loading={loading} />
```

**Step 4: Add LocationFilter to the page layout**

In the JSX, add `<LocationFilter />` after the time filter section (after the `</div>` closing the time filter wrapper around line 176):

```typescript
<LocationFilter />
```

**Step 5: Run type-check and manual test**

Run: `npx tsc --noEmit`
Expected: No type errors.

Run: `npm run dev` and manually verify:
- The "Filter by location" toggle appears below the time filter
- Expanding it shows GPS button, zip input, radius dropdown
- Entering a zip code (e.g., 55414) activates proximity filtering
- Only courses within the radius appear
- Courses sort by distance
- Distance badges appear next to course names

**Step 6: Commit**

```bash
git add src/app/page.tsx src/components/tee-time-list.tsx
git commit -m "feat: integrate proximity filtering into tee times page"
```

BEFORE marking this task complete:
1. Verify the proximity filter is additive (works with favorites, time filters)
2. Verify removing the location filter shows all courses again
3. Run `npx tsc --noEmit` and confirm no type errors

---

## Task 8: Integrate Proximity into Courses Page

**Files:**
- Modify: `src/app/courses/page.tsx` — add LocationFilter, distance sort within areas
- Modify: `src/config/areas.ts` — update `groupByArea()` to support distance sorting

This task depends on: Tasks 1 (distance.ts), 2 (courses.json with coords), **3 (mapsUrl signature change)**, 5 (useLocation hook), 6 (LocationFilter component).

**Important: This task modifies `src/config/areas.ts` which is also modified in Task 3. Task 3 MUST complete before Task 8 starts.** Task 8's changes to `groupByArea` build on the file state left by Task 3's `mapsUrl` change.

**Note on distance map keying:** The `courseDistances` map is keyed by course `name` (not `id`) because `groupByArea`'s generic constraint is `{ name: string; city: string }` and doesn't know about `id`. Course names are unique in the current dataset. Do NOT refactor `groupByArea`'s generic constraint to add `id` — that's scope creep.

BEFORE starting work:
1. Read the skill at `.claude/skills/test-driven-development/` (or invoke /test-driven-development)
2. Read `dev/testing-pitfalls.md`
Follow TDD: write failing test → implement fix → verify green.

**Context:** The courses page groups courses by area (Minneapolis, St. Paul, etc.) with alphabetical sort within each group. When proximity is active:
- Area groups stay in their current stable order
- Within each area, courses re-sort by distance (nearest first) instead of alphabetically
- Distance badges appear next to each course name
- Courses outside the radius are hidden
- Empty area groups are hidden

**Step 1: Update groupByArea to accept optional distance sorting**

Currently `groupByArea` in `src/config/areas.ts` (lines 60-85) sorts courses alphabetically within each group. We need to optionally sort by distance instead.

Add a test first in `src/config/areas.test.ts`:

```typescript
it("sorts courses by distance when distances are provided", () => {
  const courses = [
    { name: "Far Away", city: "Minneapolis" },
    { name: "Close By", city: "Minneapolis" },
    { name: "Medium", city: "Minneapolis" },
  ];
  const distances = new Map([
    ["Far Away", 50],
    ["Close By", 5],
    ["Medium", 25],
  ]);
  const groups = groupByArea(courses, distances);
  const mpls = groups.find((g) => g.area === "Minneapolis")!;
  expect(mpls.courses.map((c) => c.name)).toEqual([
    "Close By",
    "Medium",
    "Far Away",
  ]);
});

it("falls back to alphabetical sort when no distances provided", () => {
  const courses = [
    { name: "Zeta", city: "Minneapolis" },
    { name: "Alpha", city: "Minneapolis" },
  ];
  const groups = groupByArea(courses);
  const mpls = groups.find((g) => g.area === "Minneapolis")!;
  expect(mpls.courses.map((c) => c.name)).toEqual(["Alpha", "Zeta"]);
});
```

Then update `groupByArea` signature and sorting logic:

```typescript
export function groupByArea<T extends { name: string; city: string }>(
  courses: T[],
  distances?: Map<string, number>
): { area: string; courses: T[] }[] {
  // ... existing grouping logic ...

  for (const list of groups.values()) {
    if (distances) {
      list.sort((a, b) => (distances.get(a.name) ?? Infinity) - (distances.get(b.name) ?? Infinity));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  // ... rest of existing logic ...
}
```

**Step 2: Run tests**

Run: `npx vitest run src/config/areas.test.ts`
Expected: All tests PASS (existing tests should still work since `distances` is optional).

**Step 3: Update courses page**

In `src/app/courses/page.tsx`:

Add imports:
```typescript
import { LocationFilter } from "@/components/location-filter";
import { useLocation } from "@/hooks/use-location";
import { haversineDistance } from "@/lib/distance";
```

Add to the component body:
```typescript
const { location, radiusMiles } = useLocation();
```

Add distance calculation and filtering before `groupByArea` call:

```typescript
// Calculate distances if location is active
const courseDistances = useMemo(() => {
  if (!location) return null;
  const distances = new Map<string, number>();
  for (const course of courseCatalog as Array<{ id: string; name: string; latitude?: number; longitude?: number }>) {
    if (course.latitude != null && course.longitude != null) {
      distances.set(
        course.name,
        haversineDistance(location.lat, location.lng, course.latitude, course.longitude)
      );
    }
  }
  return distances;
}, [location]);

// Filter by radius if location is active
const filteredCourses = useMemo(() => {
  if (!location || !courseDistances) return visibleCourses;
  return visibleCourses.filter((course) => {
    const dist = courseDistances.get(course.name);
    return dist != null && dist <= radiusMiles;
  });
}, [visibleCourses, location, courseDistances, radiusMiles]);

const groups = groupByArea(filteredCourses, courseDistances ?? undefined);
```

Add `useMemo` to the imports from React.

Add distance badge to each course in the list (after the address link, around line 129):
```typescript
{courseDistances && (
  <span className="text-xs text-green-700 lg:text-sm">
    {courseDistances.get(course.name)?.toFixed(1)} mi
  </span>
)}
```

Add `<LocationFilter />` after the search input (after line 80):
```typescript
<LocationFilter />
```

**Step 4: Run type-check**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/config/areas.ts src/config/areas.test.ts src/app/courses/page.tsx
git commit -m "feat: integrate proximity sorting into courses page"
```

BEFORE marking this task complete:
1. Verify area groups stay in stable order (don't reorder by distance)
2. Verify courses within areas sort by distance when location is active
3. Verify courses beyond radius are hidden and empty areas don't render
4. Run `npx vitest run src/config/areas.test.ts` and confirm all tests pass

---

## Review Checkpoint: Tasks 5-8

After completing tasks 5-8:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.

Verify:
- `npm test` passes
- `npx tsc --noEmit` passes
- Tee times page: LocationFilter renders, proximity filters/sorts correctly
- Courses page: LocationFilter renders, within-area distance sorting works
- Location state is shared across pages (set zip on one page, navigate to other, zip persists)
- GPS coordinates are never written to localStorage (grep for `LS_ZIP_KEY` and verify no GPS coords)

---

## Task 9: About Page Updates

**Files:**
- Modify: `src/app/about/page.tsx` — remove SD notice, add location privacy section

This task is self-contained. No dependencies on other tasks.

BEFORE starting work:
1. Read `src/app/about/page.tsx` fully before modifying.

**Step 1: Remove the stale SD courses notice**

In `src/app/about/page.tsx`, delete lines 154-164 — the entire `<section>` with the amber border containing "Why am I seeing San Diego courses?"

Current code to remove:
```tsx
<section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
  <h2 className="text-lg font-semibold lg:text-xl">
    Why am I seeing San Diego courses?
  </h2>
  <p className="mt-2 text-gray-700">
    Minnesota courses are still closed for the season. A few San Diego
    courses are included temporarily for testing while we wait for Twin
    Cities courses to open. They&rsquo;ll be removed once the local
    season starts.
  </p>
</section>
```

**Step 2: Add location privacy section**

Add a new `<section>` after the existing "What data do you collect?" section (lines 127-139). Place it before the "How do I delete my account?" section.

```tsx
<section>
  <h2 className="text-lg font-semibold lg:text-xl">
    How does location filtering work?
  </h2>
  <p className="mt-2 text-gray-700">
    You can filter courses by distance from your location. Two options
    are available: using your device&rsquo;s GPS, or entering a zip
    code.
  </p>
  <p className="mt-2 text-gray-700">
    <strong>GPS:</strong> Your precise coordinates are used only in your
    browser to calculate distances. They are never sent to our servers
    or stored anywhere &mdash; not even in your browser&rsquo;s local
    storage.
  </p>
  <p className="mt-2 text-gray-700">
    <strong>Zip code:</strong> If you enter a zip code, it&rsquo;s
    saved in your browser so you don&rsquo;t have to re-enter it.
    Distance is calculated entirely in your browser using the zip
    code&rsquo;s approximate center point.
  </p>
</section>
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/app/about/page.tsx
git commit -m "docs: add location privacy section, remove stale SD notice"
```

---

## Task 10: Final Integration Testing

**Files:** None created — this is a verification-only task.

This task depends on: ALL previous tasks.

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

**Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Run linter**

Run: `npm run lint`
Expected: No lint errors.

**Step 4: Manual smoke test**

Run: `npm run dev`

Test the following scenarios:
1. **Tee times page — no location:** Everything works as before
2. **Tee times page — zip code:** Enter "55414", verify courses filter by distance, badges appear
3. **Tee times page — GPS:** Click "Use my location", verify proximity filter activates
4. **Tee times page — radius change:** Change radius dropdown, verify filter updates
5. **Tee times page — clear:** Click "Clear", verify all courses return
6. **Courses page — zip code:** Navigate to courses, verify zip is still active (shared state)
7. **Courses page — distance sort:** Verify courses sort by distance within area groups
8. **Course detail page:** Verify address link appears and opens Google Maps business listing
9. **About page:** Verify SD notice is gone, location privacy section is present
10. **Favorites + proximity:** Enable both favorites and proximity, verify they stack
11. **Invalid zip:** Enter "00000" or "abc", verify graceful handling
12. **Persistence:** Enter a zip, reload the page, verify it's restored

**Step 5: Final commit if any fixes were needed**

```bash
git status  # review what changed
git add <specific-changed-files>  # add only the files you fixed — NEVER git add -A blindly
git commit -m "fix: integration test fixes for proximity search"
```

---

## Review Checkpoint: Final

After completing all tasks:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.

Final verification:
- `npm test` — all green
- `npx tsc --noEmit` — no errors
- `npm run lint` — clean
- Every file has ABOUTME comments
- No GPS coordinates are ever persisted (search codebase for `localStorage.setItem` and verify)
- mapsUrl uses course name, not address
- Course detail page shows address
- About page has location section, no SD notice

---

## Task Dependency Graph

```
Task 1 (Haversine)     Task 2 (Course coords)     Task 4 (Zip lookup)     Task 9 (About page)
     │                       │                          │
     │                  Task 3 (Maps links)             │
     │                       │                          │
     │                       │              ┌───────────┘
     │                       │              │
     └───────────────────────┴──── Task 5 (Location context)
                                       │
                                  Task 6 (LocationFilter UI)
                                       │
                               ┌───────┴───────┐
                               │               │
                          Task 7 (Tee times)  Task 8 (Courses page)
                               │               │     [requires Task 3 first]
                               └───────┬───────┘
                                       │
                                  Task 10 (Integration test)
```

**Parallelizable groups:**
- Group A (fully parallel): Tasks 1, 2, 4, 9
- Group B (after Group A): Task 3 (needs no deps but runs after Task 2 ideally), Task 5 (needs Task 4)
- Group C (after Task 5): Task 6
- Group D (after Task 6, parallel): Task 7, Task 8 (but Task 8 MUST wait for Task 3 — both touch `areas.ts`)
- Group E (after all): Task 10

**File conflict risks:**
- Tasks 3 and 8 both modify `src/config/areas.ts` → Task 3 MUST complete before Task 8 starts
- Task 7 modifies `src/app/page.tsx`, Task 8 modifies `src/app/courses/page.tsx` → safe to parallelize
- Task 3 modifies `src/app/courses/[id]/page.tsx` which no other task touches → no conflict
