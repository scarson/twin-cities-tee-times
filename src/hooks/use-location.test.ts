// ABOUTME: Tests for location hook utility functions.
// ABOUTME: Validates zip code format validation and radius options.
import { describe, it, expect } from "vitest";
import { isValidZip, RADIUS_OPTIONS, DEFAULT_RADIUS, SORT_OPTIONS, DEFAULT_SORT_ORDER } from "@/hooks/use-location";

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
    expect(RADIUS_OPTIONS).toEqual([0, 5, 10, 25, 50, 100]);
  });
});

describe("DEFAULT_RADIUS", () => {
  it("is 25 miles", () => {
    expect(DEFAULT_RADIUS).toBe(25);
  });
});

describe("SORT_OPTIONS", () => {
  it("contains time and distance", () => {
    expect(SORT_OPTIONS).toEqual(["time", "distance"]);
  });
});

describe("DEFAULT_SORT_ORDER", () => {
  it("defaults to time", () => {
    expect(DEFAULT_SORT_ORDER).toBe("time");
  });
});
