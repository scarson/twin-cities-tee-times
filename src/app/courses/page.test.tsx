// @vitest-environment jsdom
// ABOUTME: Rendering tests for the courses page component.
// ABOUTME: Verifies disabled course filtering, visible courses, and area grouping.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@/config/courses.json", () => ({
  default: [
    { id: "course-a", name: "Alpha Golf Club", city: "Minneapolis", bookingUrl: "https://example.com/a" },
    { id: "course-b", name: "Bravo Links", city: "St. Paul", bookingUrl: "https://example.com/b" },
    { id: "course-c", name: "Charlie Greens", city: "Minneapolis", bookingUrl: "https://example.com/c" },
    { id: "course-d", name: "Disabled Course", city: "Minneapolis", bookingUrl: "https://example.com/d", disabled: 1 },
    { id: "course-e", name: "Notes Course", city: "Minneapolis", bookingUrl: "https://example.com/e", disabled: 1, displayNotes: "Book on their website" },
  ],
}));

vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({ toggleFavorite: vi.fn(), isFavorite: () => false }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/hooks/use-location", () => ({
  useLocation: () => ({
    location: null,
    zip: "",
    radiusMiles: 25,
    gpsLoading: false,
    gpsError: null,
    setZip: vi.fn(),
    requestGps: vi.fn(),
    setRadiusMiles: vi.fn(),
    clearLocation: vi.fn(),
  }),
  RADIUS_OPTIONS: [0, 5, 10, 25, 50, 100],
  DEFAULT_RADIUS: 25,
  isValidZip: (zip: string) => /^\d{5}$/.test(zip),
}));

import CoursesPage from "./page";

beforeAll(() => {
  if (!navigator.sendBeacon) {
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn(), writable: true });
  }
});

describe("CoursesPage", () => {
  it("filters out disabled courses", () => {
    render(<CoursesPage />);
    expect(screen.queryByText("Disabled Course")).toBeNull();
  });

  it("renders non-disabled courses", () => {
    render(<CoursesPage />);
    expect(screen.getByText("Alpha Golf Club")).toBeDefined();
    expect(screen.getByText("Bravo Links")).toBeDefined();
    expect(screen.getByText("Charlie Greens")).toBeDefined();
  });

  it("groups courses by area with area headings", () => {
    render(<CoursesPage />);
    expect(screen.getByText("Minneapolis")).toBeDefined();
    expect(screen.getByText("St. Paul")).toBeDefined();
  });

  it("filters courses by name when typing in search", () => {
    render(<CoursesPage />);
    const search = screen.getByPlaceholderText("Search courses...");
    fireEvent.change(search, { target: { value: "alpha" } });
    expect(screen.getByText("Alpha Golf Club")).toBeDefined();
    expect(screen.queryByText("Bravo Links")).toBeNull();
    expect(screen.queryByText("Charlie Greens")).toBeNull();
  });

  it("filters courses by city when typing in search", () => {
    render(<CoursesPage />);
    const search = screen.getByPlaceholderText("Search courses...");
    fireEvent.change(search, { target: { value: "st. paul" } });
    expect(screen.getByText("Bravo Links")).toBeDefined();
    expect(screen.queryByText("Alpha Golf Club")).toBeNull();
  });

  it("shows all courses when search is cleared", () => {
    render(<CoursesPage />);
    const search = screen.getByPlaceholderText("Search courses...");
    fireEvent.change(search, { target: { value: "alpha" } });
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("Alpha Golf Club")).toBeDefined();
    expect(screen.getByText("Bravo Links")).toBeDefined();
    expect(screen.getByText("Charlie Greens")).toBeDefined();
  });

  it("shows disabled course with displayNotes", () => {
    render(<CoursesPage />);
    expect(screen.getByText("Notes Course")).toBeDefined();
  });

  it("hides area groups with no matching courses during search", () => {
    render(<CoursesPage />);
    const search = screen.getByPlaceholderText("Search courses...");
    fireEvent.change(search, { target: { value: "bravo" } });
    // Bravo is in St. Paul, so Minneapolis group should be hidden
    expect(screen.getByText("St. Paul")).toBeDefined();
    expect(screen.queryByText("Minneapolis")).toBeNull();
  });
});
