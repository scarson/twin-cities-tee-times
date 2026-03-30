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
  "Ham Lake": "North Metro",
  Anoka: "North Metro",
  Dayton: "North Metro",

  // East Metro
  "White Bear Lake": "East Metro",
  Stillwater: "East Metro",
  Maplewood: "East Metro",
  "Inver Grove Heights": "East Metro",
  "Cottage Grove": "East Metro",

  // South Metro
  Edina: "South Metro",
  Chaska: "South Metro",
  Hopkins: "South Metro",
  "Apple Valley": "South Metro",
  Bloomington: "South Metro",
  "Golden Valley": "South Metro",
  Medina: "South Metro",
  "Maple Plain": "South Metro",
  "Maple Grove": "South Metro",
  Hastings: "South Metro",

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

/** Group courses by area, returning entries in AREA_ORDER then "Other" */
export function groupByArea<T extends { name: string; city: string }>(
  courses: T[],
  distances?: Map<string, number>
): { area: string; courses: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const course of courses) {
    const area = getArea(course.city);
    const list = groups.get(area) ?? [];
    list.push(course);
    groups.set(area, list);
  }

  for (const list of groups.values()) {
    if (distances) {
      list.sort((a, b) => (distances.get(a.name) ?? Infinity) - (distances.get(b.name) ?? Infinity));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
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

export function mapsUrl(name: string, city: string, state: string, placeId?: string): string {
  const query = encodeURIComponent(`${name} ${city} ${state}`);
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
