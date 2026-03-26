// @vitest-environment jsdom
// ABOUTME: Rendering tests for the courses page component.
// ABOUTME: Verifies disabled course filtering, visible courses, and area grouping.

import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/config/courses.json", () => ({
  default: [
    { id: "course-a", name: "Alpha Golf Club", city: "Minneapolis", bookingUrl: "https://example.com/a" },
    { id: "course-b", name: "Bravo Links", city: "St. Paul", bookingUrl: "https://example.com/b" },
    { id: "course-c", name: "Charlie Greens", city: "Minneapolis", bookingUrl: "https://example.com/c" },
    { id: "course-d", name: "Disabled Course", city: "Minneapolis", bookingUrl: "https://example.com/d", disabled: 1 },
  ],
}));

vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({ toggleFavorite: vi.fn(), isFavorite: () => false }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...props }, children),
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
});
