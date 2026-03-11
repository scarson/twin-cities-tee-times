# Course Browser Page Design

**Goal:** Let users browse all available courses, see their location, and favorite them — without relying on tee time availability to discover courses.

**Route:** `/courses`

---

## Data Model

### Address field in `courses.json`

Each course gets an `address` string field:

```json
{
  "id": "theodore-wirth-18",
  "name": "Theodore Wirth",
  "city": "Minneapolis",
  "address": "1301 Theodore Wirth Pkwy, Minneapolis, MN 55422",
  ...
}
```

Google Maps link built from address: `https://www.google.com/maps/search/?api=1&query={encodeURIComponent(address)}`

### Area mapping (`src/config/areas.ts`)

A city-to-area lookup groups courses into broader regions:

| Area | Cities |
|------|--------|
| Minneapolis | Minneapolis |
| St. Paul | St. Paul |
| North Metro | Brooklyn Park, Coon Rapids, Blaine, Roseville |
| East Metro | White Bear Lake, Stillwater |
| South Metro | Edina, Chaska |
| San Diego | all SD test cities |

Unmapped cities fall into "Other". Areas are displayed in the order listed above.

---

## Page Layout

### URL parameters

- `?test=true` — includes San Diego test courses (hidden by default)

### Structure

- Page title: "Golf Courses"
- Courses grouped by area, each area is a collapsible section
- All areas expanded by default on first visit
- Tap area heading to toggle collapse (chevron indicator)
- Collapse state persisted to localStorage (`tct-collapsed-areas`)
- Within each area, courses sorted alphabetically

### Course row

- **Left side:** Course name (links to `/courses/[id]`) + address as clickable Google Maps link (smaller text, below name)
- **Right side:** Favorite star toggle + external booking link icon

### Test course visibility

SD test courses (ids starting with `sd-`) are hidden by default. Append `?test=true` to the URL to show them. This is for development use while MN courses are closed for winter.

---

## Navigation

- "Courses" link added to the nav bar
- Existing favorites dropdown on the home page unchanged
- `/courses` is the discovery/browse page; favorites dropdown is for quick access

---

## Data source

Import `courses.json` directly in the page component — it's static catalog data. The `useFavorites` hook handles the interactive favorite toggling.

---

## Not in scope

- Search/filter within the page (revisit when catalog grows to ~80 courses)
- Polling status indicators (that's for the course detail page)
- "Select all in area" for favorites
- Server-side sync of collapse state (localStorage only — low-value preference)
- D1 migration for address field (addresses live in `courses.json`, seeded to D1 via `seed.ts`)
