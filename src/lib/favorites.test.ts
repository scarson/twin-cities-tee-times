// ABOUTME: Tests for localStorage-based favorites management.
// ABOUTME: Covers get, set, toggle, and isFavorite with localStorage mock.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getFavorites, toggleFavorite, isFavorite } from "./favorites";

// Mock browser environment: vitest runs in Node where `window` is undefined.
// favorites.ts checks `typeof window === "undefined"` and bails early.
// We must define both `window` and `localStorage` on globalThis.
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

// Define window to pass the `typeof window === "undefined"` guard
Object.defineProperty(globalThis, "window", {
  value: globalThis,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("getFavorites", () => {
  it("returns empty array when nothing stored", () => {
    expect(getFavorites()).toEqual([]);
  });

  it("returns parsed array from localStorage", () => {
    store["tct-favorites"] = JSON.stringify(["course-a", "course-b"]);
    expect(getFavorites()).toEqual(["course-a", "course-b"]);
  });

  it("returns empty array on malformed JSON", () => {
    store["tct-favorites"] = "not-json";
    expect(getFavorites()).toEqual([]);
  });
});

describe("toggleFavorite", () => {
  it("adds a course when not favorited", () => {
    toggleFavorite("course-a");
    expect(getFavorites()).toContain("course-a");
  });

  it("removes a course when already favorited", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    toggleFavorite("course-a");
    expect(getFavorites()).not.toContain("course-a");
  });
});

describe("isFavorite", () => {
  it("returns true for favorited course", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    expect(isFavorite("course-a")).toBe(true);
  });

  it("returns false for non-favorited course", () => {
    store["tct-favorites"] = JSON.stringify(["course-a"]);
    expect(isFavorite("course-b")).toBe(false);
  });
});
