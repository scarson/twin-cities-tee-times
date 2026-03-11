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
