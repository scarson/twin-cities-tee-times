# Proximity Search Design

**Date:** 2026-03-29
**Status:** Approved

## Problem

Users want to filter tee times and courses by distance from their location. Two use cases:
1. "Show me courses near home" — the common case, user has a known home/work location
2. "Show me courses near where I'll be traveling" — user is planning a trip (e.g., to Arizona) and wants to see what's nearby their destination

## Design Decisions

### Location Input
- **GPS button** ("Use my location") for convenience — requests browser geolocation
- **Zip code text field** as primary input — covers both "near me" and travel cases
- Text input also respects users who don't want to share precise GPS coordinates

### Distance Calculation
- **Pure client-side** using the Haversine formula
- GPS coordinates are **ephemeral** — used in browser memory only, never sent to the server, never stored
- The tee times and courses APIs return the same data as today (no API changes)
- Course lat/lng comes from `courses.json` (static config, shipped with the app)
- ~43 courses makes client-side filtering trivially fast

### Proximity as Filter + Sort
- **Filter:** Courses outside the selected radius are hidden
- **Sort:** Remaining courses ordered nearest-first
- Radius options: 5 / 10 / 25 / 50 / 100 miles (default: 25)
- Proximity is **additive** — layers on top of existing date/time/favorites filters

### Privacy
- GPS coordinates: ephemeral, never persisted, never sent to server
- Zip code: persisted only on user action (entering a zip)
  - Anonymous users: `localStorage`
  - Authenticated users: `user_settings` table (key: `zip_code`)
- Privacy policy on About page must be updated to disclose location data handling
- Course coordinates are public information (addresses of public golf courses)

## Data

### Course Coordinates
- Add `latitude` and `longitude` fields to each entry in `courses.json`
- Sourced via one-time geocoding script (`scripts/geocode-courses.ts`) using Census Bureau or Nominatim API
- Results reviewed and committed — no runtime geocoding dependency

### Zip Code Lookup
- Static `public/zip-coords.json` containing all ~42K US zip codes mapped to centroid lat/lng
- Generated once from Census Bureau ZCTA data (public domain)
- ~1.2MB raw, ~200-300KB gzipped
- Fetched lazily on first proximity interaction, cached by browser
- Nationwide coverage required (father-in-law travels to Arizona)

### No Database Migration Required
- Course coordinates live in `courses.json` (static config), not in D1
- Authenticated zip storage uses existing `user_settings` table (key-value, already exists)

## UI

### Tee Times Page (`src/app/page.tsx`)

**Collapsible "Location" section** below the time filter, collapsed by default.

**When collapsed with no location active:** A toggle/header like "Filter by location" that expands on click. Page works exactly as today.

**When expanded:**
- Row 1: "Use my location" GPS button + zip code text input (5-digit, validated)
- Row 2: Radius dropdown (5/10/25/50/100 mi, default 25) + clear button

**When collapsed with location active:** Summary indicator, e.g., "Within 25 mi of 55414" or "Within 25 mi of your location"

**Effect on results:**
- Courses outside radius hidden
- Course groups reorder nearest-first (instead of alphabetical)
- Distance badge on each course group header: "Braemar — 3.2 mi"
- Tee times within each course still sort by time (unchanged)

### Courses Page (`src/app/courses/page.tsx`)

**Same collapsible "Location" section** — shared component with tee times page.

**Effect on course list:**
- Area grouping headers stay in stable order (Minneapolis, St. Paul, North Metro, etc.)
- Within each area, courses re-sort by distance (nearest first) instead of alphabetically
- Distance badge on each course: "Columbia — 4.1 mi"
- Courses outside radius hidden; empty area groups hidden
- Text search continues to work alongside proximity

### Course Detail Page (`src/app/courses/[id]/page.tsx`)

- **Add address display** — currently missing from this page
- Show full address as clickable Google Maps link, consistent with courses list page

### Shared Location State

Location/radius selection shared between tee times and courses pages via a React context provider. Provider reads from `localStorage` on init and writes back on change. Avoids re-entering location when navigating between pages.

Persistence:
- Zip code: saved to `localStorage` (key: `tct-zip`) on entry
- Radius: saved to `localStorage` (key: `tct-radius`) alongside zip
- Authenticated users: zip also saved to `user_settings` on server
- GPS coordinates: **never persisted**

## Google Maps Links

**Current behavior:** `mapsUrl()` in `src/config/areas.ts` links to the street address, which drops a generic pin.

**Change:** Link to the course name + city/state instead, e.g., `https://www.google.com/maps/search/?api=1&query=Columbia+Golf+Club+Minneapolis+MN`. This resolves to the actual business listing with hours, reviews, photos, and directions.

## About Page Cleanup

### Remove stale SD courses notice
The "Why am I seeing San Diego courses?" section (lines 154-164 of `src/app/about/page.tsx`) is a relic from when SD test courses were active. Remove it.

### Add location privacy section
Add a section covering:
- What location data is collected (zip code only, optionally)
- What is NOT collected (GPS coordinates are never stored or sent to our servers)
- How it's used (distance calculation, entirely in your browser)
- Where zip is stored (browser localStorage or account settings)

## Technical Components

### New Files
- `src/lib/distance.ts` — Haversine formula utility
- `src/hooks/use-location.ts` — React hook managing location state, localStorage, GPS
- `src/components/location-filter.tsx` — Shared collapsible location filter UI component
- `src/context/location-provider.tsx` — React context for cross-page location state
- `public/zip-coords.json` — Static zip-to-coordinates lookup table
- `scripts/geocode-courses.ts` — One-time script to add lat/lng to courses.json
- `scripts/generate-zip-coords.ts` — One-time script to generate zip lookup from Census data

### Modified Files
- `src/config/courses.json` — Add `latitude`, `longitude` to each course entry
- `src/config/areas.ts` — Update `mapsUrl()` to use course name instead of address; update `groupByArea()` to accept optional distance sort
- `src/app/page.tsx` — Add LocationFilter component, apply distance filtering/sorting
- `src/app/courses/page.tsx` — Add LocationFilter component, apply distance sorting within areas
- `src/app/courses/[id]/page.tsx` — Add address display with Maps link
- `src/app/about/page.tsx` — Remove SD notice, add location privacy section
- `src/app/layout.tsx` — Wrap with LocationProvider context
- `src/types/index.ts` — (if needed) extend course-related types with lat/lng
