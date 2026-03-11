// ABOUTME: Tests for city-to-area mapping.
// ABOUTME: Verifies area lookup for known cities and fallback for unknown cities.
import { describe, it, expect } from "vitest";
import { getArea, AREA_ORDER, groupByArea, mapsUrl } from "./areas";

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
    const courses: { city: string }[] = require("./courses.json");
    const cities = [...new Set(courses.map((c) => c.city))];
    for (const city of cities) {
      expect(getArea(city)).not.toBe("Other");
    }
  });

  it("sd- prefix correctly identifies all and only SD test courses", () => {
    // The /courses page uses id.startsWith("sd-") to filter test courses.
    // Verify this pattern matches exactly the San Diego courses.
    const courses: { id: string; city: string }[] = require("./courses.json");
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
      "San Diego",
      "Minneapolis",
      "St. Paul",
      "North Metro",
      "East Metro",
      "South Metro",
    ]);
  });
});

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
