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
      "Minneapolis",
      "St. Paul",
      "North Metro",
      "East Metro",
      "South Metro",
      "San Diego",
    ]);
  });
});
