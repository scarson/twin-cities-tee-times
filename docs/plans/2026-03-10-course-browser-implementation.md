# Course Browser Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/courses` page where users can browse all courses grouped by area, see addresses with Google Maps links, and toggle favorites.

**Architecture:** Static course data from `courses.json` rendered client-side with area grouping from a city-to-area mapping. Favorites use the existing `useFavorites` hook. Collapsible area sections with localStorage persistence. SD test courses hidden unless `?test=true`.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, `useFavorites` hook

**Design doc:** `docs/plans/2026-03-10-course-browser-design.md`

---

### Task 1: Add addresses to courses.json

**Files:**
- Modify: `src/config/courses.json`

**Step 1: Add `address` field to every course entry**

Add the `address` field after `city` for each course. Use these verified addresses:

```
theodore-wirth-18:   "1301 Theodore Wirth Pkwy, Minneapolis, MN 55422"
gross-national:      "2201 St. Anthony Blvd, Minneapolis, MN 55418"
meadowbrook:         "201 Meadowbrook Rd, Hopkins, MN 55343"
columbia:            "3300 Central Ave NE, Minneapolis, MN 55418"
hiawatha:            "4553 Longfellow Ave, Minneapolis, MN 55407"
phalen:              "1615 Phalen Dr E, St. Paul, MN 55106"
chaska-town-course:  "3000 Town Course Dr, Chaska, MN 55318"
edinburgh-usa:       "8700 Edinbrook Crossing, Brooklyn Park, MN 55443"
oak-glen:            "1599 McKusick Rd N, Stillwater, MN 55082"
highland-national:   "1403 Montreal Ave, St. Paul, MN 55116"
como-park:           "1431 N Lexington Pkwy, St. Paul, MN 55103"
victory-links:       "2010 105th Ave NE, Blaine, MN 55449"
gem-lake-hills:      "4039 Scheuneman Rd, White Bear Lake, MN 55110"
braemar:             "6364 John Harris Dr, Edina, MN 55439"
bunker-hills:        "12800 Bunker Prairie Rd NW, Coon Rapids, MN 55448"
roseville-cedarholm: "2323 Hamline Ave N, Roseville, MN 55113"
sd-balboa-park:      "2600 Golf Course Dr, San Diego, CA 92102"
sd-goat-hill:        "2323 Goat Hill Dr, Oceanside, CA 92054"
sd-oceanside:        "825 Douglas Dr, Oceanside, CA 92058"
sd-lomas-santa-fe:   "1580 Sun Valley Rd, Solana Beach, CA 92075"
sd-coronado:         "2000 Visalia Row, Coronado, CA 92118"
sd-encinitas-ranch:  "1275 Quail Gardens Dr, Encinitas, CA 92024"
sd-twin-oaks:        "1425 N Twin Oaks Valley Rd, San Marcos, CA 92069"
sd-rancho-bernardo-inn: "17550 Bernardo Oaks Dr, San Diego, CA 92128"
```

Example of what one entry should look like after the change:

```json
{
  "index": 17,
  "id": "theodore-wirth-18",
  "name": "Theodore Wirth",
  "city": "Minneapolis",
  "address": "1301 Theodore Wirth Pkwy, Minneapolis, MN 55422",
  "platform": "cps_golf",
  "platformConfig": { ... },
  "bookingUrl": "..."
}
```

**Step 2: Verify all 24 courses have addresses**

Run: `node -e "const c = require('./src/config/courses.json'); const missing = c.filter(x => !x.address); console.log(missing.length ? 'MISSING: ' + missing.map(x => x.id).join(', ') : 'All ' + c.length + ' courses have addresses')"`
Expected: `All 24 courses have addresses`

**Step 3: Run tests to verify nothing broke**

Run: `npm test`
Expected: All tests pass (address is a new field, no existing code reads it yet)

**Step 4: Commit**

```bash
git add src/config/courses.json
git commit -m "data: add address field to all courses"
```

---

### Task 2: Create area mapping

**Files:**
- Create: `src/config/areas.ts`
- Create: `src/config/areas.test.ts`

**Step 1: Write the failing test**

Create `src/config/areas.test.ts`:

```typescript
// ABOUTME: Tests for city-to-area mapping.
// ABOUTME: Verifies area lookup for known cities and fallback for unknown cities.
import { describe, it, expect } from "vitest";
import { getArea, AREA_ORDER } from "./areas";

describe("getArea", () => {
  it("maps Minneapolis to Minneapolis", () => {
    expect(getArea("Minneapolis")).toBe("Minneapolis");
  });

  it("maps St. Paul to St. Paul", () => {
    expect(getArea("St. Paul")).toBe("St. Paul");
  });

  it("maps Roseville to North Metro", () => {
    expect(getArea("Roseville")).toBe("North Metro");
  });

  it("maps Edina to South Metro", () => {
    expect(getArea("Edina")).toBe("South Metro");
  });

  it("maps Hopkins to South Metro", () => {
    expect(getArea("Hopkins")).toBe("South Metro");
  });

  it("maps Stillwater to East Metro", () => {
    expect(getArea("Stillwater")).toBe("East Metro");
  });

  it("maps SD cities to San Diego", () => {
    expect(getArea("San Diego")).toBe("San Diego");
    expect(getArea("Oceanside")).toBe("San Diego");
    expect(getArea("Coronado")).toBe("San Diego");
    expect(getArea("Encinitas")).toBe("San Diego");
    expect(getArea("San Marcos")).toBe("San Diego");
    expect(getArea("Solana Beach")).toBe("San Diego");
  });

  it("returns Other for unknown cities", () => {
    expect(getArea("Timbuktu")).toBe("Other");
  });

  it("covers every city in courses.json", () => {
    // Guard against mapping drift: new cities must be added to CITY_TO_AREA
    const courses: { city: string }[] = require("@/config/courses.json");
    const cities = [...new Set(courses.map((c) => c.city))];
    for (const city of cities) {
      expect(getArea(city)).not.toBe("Other");
    }
  });

  it("sd- prefix correctly identifies all and only SD test courses", () => {
    // The /courses page uses id.startsWith("sd-") to filter test courses.
    // Verify this pattern matches exactly the San Diego courses.
    const courses: { id: string; city: string }[] = require("@/config/courses.json");
    for (const course of courses) {
      const isSdId = course.id.startsWith("sd-");
      const isSdArea = getArea(course.city) === "San Diego";
      expect(isSdId).toBe(isSdArea);
    }
  });
});

describe("AREA_ORDER", () => {
  it("lists areas in display order", () => {
    expect(AREA_ORDER).toEqual([
      "Minneapolis",
      "St. Paul",
      "North Metro",
      "East Metro",
      "South Metro",
      "San Diego",
    ]);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/config/areas.test.ts`
Expected: FAIL — module `./areas` not found

**Step 3: Write the implementation**

Create `src/config/areas.ts`:

```typescript
// ABOUTME: Maps city names to broader area groupings for the course browser.
// ABOUTME: Used to group courses by region in the /courses page.

const CITY_TO_AREA: Record<string, string> = {
  // Core cities
  Minneapolis: "Minneapolis",
  "St. Paul": "St. Paul",

  // North Metro
  "Brooklyn Park": "North Metro",
  "Coon Rapids": "North Metro",
  Blaine: "North Metro",
  Roseville: "North Metro",

  // East Metro
  "White Bear Lake": "East Metro",
  Stillwater: "East Metro",

  // South Metro
  Edina: "South Metro",
  Chaska: "South Metro",
  Hopkins: "South Metro",

  // San Diego (test courses)
  "San Diego": "San Diego",
  Oceanside: "San Diego",
  Coronado: "San Diego",
  Encinitas: "San Diego",
  "San Marcos": "San Diego",
  "Solana Beach": "San Diego",
};

export const AREA_ORDER = [
  "Minneapolis",
  "St. Paul",
  "North Metro",
  "East Metro",
  "South Metro",
  "San Diego",
];

export function getArea(city: string): string {
  return CITY_TO_AREA[city] ?? "Other";
}
```

Note: `Hopkins` is included because Meadowbrook's `city` is "Minneapolis" in courses.json but its address is in Hopkins. If the city field ever gets corrected, Hopkins should map to South Metro. This is a forward-looking entry — harmless if unused.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/areas.test.ts`
Expected: All pass

**Step 5: Run full test suite**

Run: `npm test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/config/areas.ts src/config/areas.test.ts
git commit -m "feat: add city-to-area mapping for course browser"
```

---

### Task 3: Create the /courses page

**Files:**
- Create: `src/app/courses/page.tsx`

This is a client component because it uses `useFavorites` (which depends on `useAuth` context) and `useSearchParams`.

**Step 1: Add `groupByArea` and `mapsUrl` to areas.ts**

Before creating the page, add these two functions to the **bottom** of `src/config/areas.ts` (created in Task 2). The page will import them.

Add to `src/config/areas.ts`:

```typescript
/** Group courses by area, returning entries in AREA_ORDER then "Other" */
export function groupByArea<T extends { name: string; city: string }>(
  courses: T[]
): { area: string; courses: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const course of courses) {
    const area = getArea(course.city);
    const list = groups.get(area) ?? [];
    list.push(course);
    groups.set(area, list);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const result: { area: string; courses: T[] }[] = [];
  for (const area of AREA_ORDER) {
    const list = groups.get(area);
    if (list) result.push({ area, courses: list });
  }
  const other = groups.get("Other");
  if (other) result.push({ area: "Other", courses: other });

  return result;
}

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
```

**Step 2: Add tests for groupByArea and mapsUrl**

Add these tests to `src/config/areas.test.ts`. Update the import at the top to include the new exports:

```typescript
import { getArea, AREA_ORDER, groupByArea, mapsUrl } from "./areas";
```

Add these test blocks after the existing ones:

```typescript
describe("groupByArea", () => {
  const courses = [
    { name: "Braemar", city: "Edina" },
    { name: "Theodore Wirth", city: "Minneapolis" },
    { name: "Columbia", city: "Minneapolis" },
    { name: "Phalen", city: "St. Paul" },
  ];

  it("groups courses by area", () => {
    const groups = groupByArea(courses);
    expect(groups.map((g) => g.area)).toEqual([
      "Minneapolis",
      "St. Paul",
      "South Metro",
    ]);
  });

  it("sorts courses alphabetically within each group", () => {
    const groups = groupByArea(courses);
    const mpls = groups.find((g) => g.area === "Minneapolis")!;
    expect(mpls.courses.map((c) => c.name)).toEqual([
      "Columbia",
      "Theodore Wirth",
    ]);
  });

  it("puts unmapped cities in Other at the end", () => {
    const withUnknown = [...courses, { name: "Far Away", city: "Timbuktu" }];
    const groups = groupByArea(withUnknown);
    const last = groups[groups.length - 1];
    expect(last.area).toBe("Other");
    expect(last.courses[0].name).toBe("Far Away");
  });

  it("omits areas with no courses", () => {
    const just = [{ name: "Braemar", city: "Edina" }];
    const groups = groupByArea(just);
    expect(groups).toHaveLength(1);
    expect(groups[0].area).toBe("South Metro");
  });

  it("returns empty array for empty input", () => {
    expect(groupByArea([])).toEqual([]);
  });

  it("preserves extra fields on course objects", () => {
    const courses = [
      { name: "Braemar", city: "Edina", id: "braemar", address: "123 Main St" },
    ];
    const groups = groupByArea(courses);
    expect(groups[0].courses[0]).toEqual({
      name: "Braemar",
      city: "Edina",
      id: "braemar",
      address: "123 Main St",
    });
  });
});

describe("mapsUrl", () => {
  it("builds a Google Maps search URL from an address", () => {
    const url = mapsUrl("1301 Theodore Wirth Pkwy, Minneapolis, MN 55422");
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=1301%20Theodore%20Wirth%20Pkwy%2C%20Minneapolis%2C%20MN%2055422"
    );
  });

  it("encodes special characters in addresses", () => {
    const url = mapsUrl("123 Main St #4, City & County");
    expect(url).toContain("%23"); // # encoded
    expect(url).toContain("%26"); // & encoded
  });
});
```

**Step 3: Run tests to verify they pass**

Run: `npx vitest run src/config/areas.test.ts`
Expected: All pass (existing + new tests)

**Step 4: Create the page component**

Create `src/app/courses/page.tsx`:

```tsx
// ABOUTME: Course browser page listing all courses grouped by area.
// ABOUTME: Supports favoriting, collapsible area sections, and ?test=true for SD courses.
"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useFavorites } from "@/hooks/use-favorites";
import { groupByArea, mapsUrl } from "@/config/areas";
import courseCatalog from "@/config/courses.json";

const COLLAPSED_KEY = "tct-collapsed-areas";

interface CatalogCourse {
  id: string;
  name: string;
  city: string;
  address?: string;
  bookingUrl: string;
  is_active?: number;
}

function getCollapsedAreas(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCollapsedAreas(areas: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(areas));
  } catch {
    // localStorage unavailable
  }
}

function CourseBrowser() {
  const searchParams = useSearchParams();
  const showTest = searchParams.get("test") === "true";
  const { toggleFavorite, isFavorite } = useFavorites();
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // Load collapsed state from localStorage after mount
  useEffect(() => {
    setCollapsed(getCollapsedAreas());
  }, []);

  const toggleArea = useCallback((area: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(area)
        ? prev.filter((a) => a !== area)
        : [...prev, area];
      saveCollapsedAreas(next);
      return next;
    });
  }, []);

  // Filter out SD test courses unless ?test=true
  const visibleCourses = (courseCatalog as CatalogCourse[]).filter(
    (c) => showTest || !c.id.startsWith("sd-")
  );

  const groups = groupByArea(visibleCourses);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
      <h1 className="text-2xl font-bold lg:text-3xl">Golf Courses</h1>
      <p className="mt-1 text-sm text-gray-500 lg:text-base">
        Browse courses and add them to your favorites.
      </p>

      <div className="mt-6 space-y-6">
        {groups.map(({ area, courses }) => {
          const isCollapsed = collapsed.includes(area);
          return (
            <section key={area}>
              <button
                onClick={() => toggleArea(area)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span
                  className={`text-xs text-gray-400 transition-transform ${
                    isCollapsed ? "" : "rotate-90"
                  }`}
                >
                  ▶
                </span>
                <h2 className="text-lg font-semibold lg:text-xl">
                  {area}
                </h2>
                <span className="text-sm text-gray-400">
                  ({courses.length})
                </span>
              </button>

              {!isCollapsed && (
                <ul className="mt-2 divide-y divide-gray-100">
                  {courses.map((course) => {
                    const favorited = isFavorite(course.id);
                    return (
                      <li
                        key={course.id}
                        className="flex items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/courses/${course.id}`}
                            className="font-medium text-gray-900 hover:text-green-700 lg:text-lg"
                          >
                            {course.name}
                          </Link>
                          {course.address && (
                            <a
                              href={mapsUrl(course.address)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-xs text-gray-400 hover:text-green-700 lg:text-sm"
                            >
                              {course.address}
                            </a>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <a
                            href={course.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-green-700 hover:underline"
                            title="Book online"
                          >
                            Book
                          </a>
                          <button
                            onClick={() =>
                              toggleFavorite(course.id, course.name)
                            }
                            className={`text-xl leading-none ${
                              favorited
                                ? "text-yellow-500"
                                : "text-gray-300 hover:text-yellow-400"
                            }`}
                            title={
                              favorited
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                          >
                            {favorited ? "★" : "☆"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

export default function CoursesPage() {
  return (
    <Suspense>
      <CourseBrowser />
    </Suspense>
  );
}
```

Key implementation notes:
- `useSearchParams()` requires a Suspense boundary (Next.js App Router requirement for client components). The `CoursesPage` wrapper provides this.
- `CatalogCourse` is a local interface — we read from `courses.json` which has more fields than `CourseConfig`, but we only use what we need.
- Collapsed state initializes empty (for SSR safety), then reads from localStorage in `useEffect`.
- `groupByArea` and `mapsUrl` are imported from `@/config/areas` (added in Steps 1-2 above), NOT defined locally.

**Step 5: Run full test suite**

Run: `npm test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/app/courses/page.tsx src/config/areas.ts src/config/areas.test.ts
git commit -m "feat: add /courses browser page with area grouping"
```

---

### Task 4: Add "Courses" link to nav bar

**Files:**
- Modify: `src/components/nav.tsx`

**Step 1: Add a Courses link to the nav**

The nav currently has a logo/wordmark linking to `/` and a `NavAuthArea` on the right. Add a "Courses" link between them.

Modify `src/components/nav.tsx` to add a `Link` to `/courses`:

```tsx
// ABOUTME: Top navigation bar with site logo and wordmark.
// ABOUTME: Dark-themed fixed header used across all pages.
import Image from "next/image";
import Link from "next/link";
import { NavAuthArea } from "./nav-auth-area";

export function Nav() {
  return (
    <nav className="border-b border-gray-200 bg-[#1a2425]">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 lg:max-w-3xl">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo-wordmark.png"
              alt="Twin Cities Tee Times"
              width={854}
              height={365}
              className="h-10 w-auto lg:h-12"
              unoptimized
              priority
            />
            <Image
              src="/logo-icon.png"
              alt=""
              width={854}
              height={333}
              className="h-12 w-auto lg:h-14"
              unoptimized
              priority
            />
          </Link>
          <Link
            href="/courses"
            className="text-sm font-medium text-gray-300 hover:text-white lg:text-base"
          >
            Courses
          </Link>
        </div>
        <NavAuthArea />
      </div>
    </nav>
  );
}
```

Changes:
- Wrap the logo link + new Courses link in a `<div className="flex items-center gap-4">`
- Add `<Link href="/courses">Courses</Link>` after the logo

**Step 2: Verify in the browser**

Run: `npm run dev`
Expected: "Courses" link appears in the nav bar, links to `/courses`

**Step 3: Run full test suite and type check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass

**Step 4: Commit**

```bash
git add src/components/nav.tsx
git commit -m "feat: add Courses link to nav bar"
```

---

### Task 5: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Production build**

Run: `npm run build`
Expected: Builds successfully (this runs OpenNext/Cloudflare build, not plain `next build`)

**Step 4: Manual verification checklist**

With `npm run dev` running, verify:
- [ ] `/courses` shows courses grouped by area (Minneapolis, St. Paul, North Metro, East Metro, South Metro)
- [ ] SD test courses are hidden
- [ ] `/courses?test=true` shows San Diego area with test courses
- [ ] Each course name links to `/courses/[id]`
- [ ] Each address links to Google Maps (opens in new tab)
- [ ] Star toggles favorites (star fills/unfills)
- [ ] Collapsing an area hides its courses
- [ ] Collapse state persists across page reloads (check localStorage `tct-collapsed-areas`)
- [ ] "Courses" link in nav bar works from any page
- [ ] Mobile layout looks reasonable (address truncates, star is easy to tap on right side)
