// ABOUTME: Tests for Haversine distance calculation utility.
// ABOUTME: Validates distance accuracy for known city pairs and edge cases.
import { describe, it, expect } from "vitest";
import { haversineDistance } from "./distance";

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(44.9778, -93.265, 44.9778, -93.265)).toBe(0);
  });

  it("calculates Minneapolis to St. Paul (~10 miles)", () => {
    const dist = haversineDistance(44.9778, -93.265, 44.9544, -93.1022);
    expect(dist).toBeGreaterThan(8);
    expect(dist).toBeLessThan(12);
  });

  it("calculates Minneapolis to Chaska (~25 miles)", () => {
    const dist = haversineDistance(44.9778, -93.265, 44.7894, -93.6022);
    expect(dist).toBeGreaterThan(20);
    expect(dist).toBeLessThan(30);
  });

  it("calculates Minneapolis to Duluth (~137 miles)", () => {
    const dist = haversineDistance(44.9778, -93.265, 46.7867, -92.1005);
    expect(dist).toBeGreaterThan(130);
    expect(dist).toBeLessThan(150);
  });

  it("handles negative longitudes correctly", () => {
    const dist = haversineDistance(44.9778, -93.265, 44.9544, -93.1022);
    expect(dist).toBeGreaterThan(0);
  });

  it("returns distance in miles (not km)", () => {
    const dist = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(dist).toBeGreaterThan(2400);
    expect(dist).toBeLessThan(2500);
  });
});
