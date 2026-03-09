// ABOUTME: Tests for localStorage-based favorites management.
// ABOUTME: Covers get, set, toggle, isFavorite, and legacy string[] migration.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getFavorites,
  getFavoriteDetails,
  toggleFavorite,
  isFavorite,
} from "./favorites";

// Mock browser environment: favorites.ts checks `typeof window === "undefined"`.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const k in store) delete store[k];
  }),
  length: 0,
  key: vi.fn(() => null),
};

vi.stubGlobal("window", globalThis);
vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("getFavorites", () => {
  it("returns empty array when nothing stored", () => {
    expect(getFavorites()).toEqual([]);
  });

  it("returns IDs from new format", () => {
    store["tct-favorites"] = JSON.stringify([
      { id: "course-a", name: "Course A" },
      { id: "course-b", name: "Course B" },
    ]);
    expect(getFavorites()).toEqual(["course-a", "course-b"]);
  });

  it("migrates legacy string[] format to IDs", () => {
    store["tct-favorites"] = JSON.stringify(["course-a", "course-b"]);
    expect(getFavorites()).toEqual(["course-a", "course-b"]);
  });

  it("returns empty array on malformed JSON", () => {
    store["tct-favorites"] = "not-json";
    expect(getFavorites()).toEqual([]);
  });
});

describe("getFavoriteDetails", () => {
  it("returns {id, name} pairs from new format", () => {
    store["tct-favorites"] = JSON.stringify([
      { id: "course-a", name: "Course A" },
    ]);
    expect(getFavoriteDetails()).toEqual([
      { id: "course-a", name: "Course A" },
    ]);
  });

  it("migrates legacy strings using ID as name", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    expect(getFavoriteDetails()).toEqual([
      { id: "course-a", name: "course-a" },
    ]);
  });
});

describe("toggleFavorite", () => {
  it("adds a course with name when not favorited", () => {
    toggleFavorite("course-a", "Course A");
    expect(getFavorites()).toContain("course-a");
    expect(getFavoriteDetails()).toEqual([
      { id: "course-a", name: "Course A" },
    ]);
  });

  it("removes a course when already favorited", () => {
    store["tct-favorites"] = JSON.stringify([
      { id: "course-a", name: "Course A" },
    ]);
    toggleFavorite("course-a");
    expect(getFavorites()).not.toContain("course-a");
  });

  it("preserves existing entries when adding", () => {
    store["tct-favorites"] = JSON.stringify([
      { id: "course-a", name: "Course A" },
    ]);
    toggleFavorite("course-b", "Course B");
    expect(getFavoriteDetails()).toEqual([
      { id: "course-a", name: "Course A" },
      { id: "course-b", name: "Course B" },
    ]);
  });
});

describe("isFavorite", () => {
  it("returns true for favorited course", () => {
    store["tct-favorites"] = JSON.stringify([
      { id: "course-a", name: "Course A" },
    ]);
    expect(isFavorite("course-a")).toBe(true);
  });

  it("returns false for non-favorited course", () => {
    store["tct-favorites"] = JSON.stringify([
      { id: "course-a", name: "Course A" },
    ]);
    expect(isFavorite("course-b")).toBe(false);
  });

  it("works with legacy format", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    expect(isFavorite("course-a")).toBe(true);
  });
});
