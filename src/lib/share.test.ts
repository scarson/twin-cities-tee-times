// ABOUTME: Tests for share-favorites bitfield encoding and decoding.
// ABOUTME: Covers round-trips, edge cases, invalid input, and course catalog resolution.

import { describe, it, expect } from "vitest";
import { encodeFavorites, decodeFavorites, buildShareUrl, resolveSharedCourses } from "./share";

describe("encodeFavorites", () => {
  it("encodes a single index", () => {
    const result = encodeFavorites([0]);
    expect(result).toMatch(/^v1\./);
    // Bit 0 set = byte 0x80 = base64url "gA"
    expect(result).toBe("v1.gA");
  });

  it("encodes multiple indices", () => {
    const result = encodeFavorites([0, 7]);
    // Bits 0 and 7 set = byte 0x81 = base64url "gQ"
    expect(result).toBe("v1.gQ");
  });

  it("encodes indices spanning multiple bytes", () => {
    const result = encodeFavorites([0, 8]);
    // Bit 0 in byte 0 = 0x80, bit 8 (= bit 0 of byte 1) = 0x80
    // Bytes: [0x80, 0x80] = base64url "gIA"
    expect(result).toBe("v1.gIA");
  });

  it("returns v1. prefix with empty base64 for empty input", () => {
    expect(encodeFavorites([])).toBe("v1.");
  });

  it("round-trips with decodeFavorites", () => {
    const indices = [0, 3, 7, 12, 18];
    const encoded = encodeFavorites(indices);
    const decoded = decodeFavorites(encoded);
    expect(decoded).toEqual(indices);
  });

  it("handles high indices (future-proofing)", () => {
    const indices = [0, 99, 200];
    const encoded = encodeFavorites(indices);
    const decoded = decodeFavorites(encoded);
    expect(decoded).toEqual(indices);
  });
});

describe("decodeFavorites", () => {
  it("returns empty array for empty v1. prefix", () => {
    expect(decodeFavorites("v1.")).toEqual([]);
  });

  it("returns empty array for invalid version prefix", () => {
    expect(decodeFavorites("v2.gA")).toEqual([]);
  });

  it("returns empty array for missing version prefix", () => {
    expect(decodeFavorites("gA")).toEqual([]);
  });

  it("returns empty array for corrupted base64", () => {
    expect(decodeFavorites("v1.!!!invalid!!!")).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(decodeFavorites(null as unknown as string)).toEqual([]);
    expect(decodeFavorites(undefined as unknown as string)).toEqual([]);
    expect(decodeFavorites("")).toEqual([]);
  });
});

describe("buildShareUrl", () => {
  it("builds URL with f query param containing v1. prefix", () => {
    const url = buildShareUrl("https://example.com/", [0, 3]);
    const parsed = new URL(url);
    const fParam = parsed.searchParams.get("f");
    expect(fParam).toMatch(/^v1\./);
  });

  it("preserves existing path", () => {
    const url = buildShareUrl("https://example.com/some/path", [0]);
    expect(new URL(url).pathname).toBe("/some/path");
  });

  it("round-trips through URL encoding", () => {
    const url = buildShareUrl("https://example.com/", [0, 3, 17]);
    const parsed = new URL(url);
    const decoded = decodeFavorites(parsed.searchParams.get("f")!);
    expect(decoded).toEqual([0, 3, 17]);
  });
});

describe("resolveSharedCourses", () => {
  const catalog = [
    { index: 0, id: "braemar", name: "Braemar" },
    { index: 1, id: "bunker-hills", name: "Bunker Hills" },
    { index: 5, id: "edinburgh-usa", name: "Edinburgh USA" },
  ];

  it("resolves indices to course entries", () => {
    const result = resolveSharedCourses([0, 5], catalog);
    expect(result).toEqual([
      { id: "braemar", name: "Braemar" },
      { id: "edinburgh-usa", name: "Edinburgh USA" },
    ]);
  });

  it("skips unknown indices", () => {
    const result = resolveSharedCourses([0, 99], catalog);
    expect(result).toEqual([{ id: "braemar", name: "Braemar" }]);
  });

  it("returns empty array for no valid indices", () => {
    const result = resolveSharedCourses([50, 99], catalog);
    expect(result).toEqual([]);
  });
});
