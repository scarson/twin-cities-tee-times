// @vitest-environment jsdom
// ABOUTME: Rendering tests for the TeeTimeList component.
// ABOUTME: Verifies loading/empty states, price/slot formatting, links, and booking buttons.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ isLoggedIn: false }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/lib/format", () => ({
  formatTime: (t: string) => t,
  staleAge: () => "5 min ago",
}));

import { TeeTimeList } from "./tee-time-list";

interface TeeTimeItem {
  course_id: string;
  course_name: string;
  course_city: string;
  date: string;
  time: string;
  price: number | null;
  holes: number;
  open_slots: number;
  booking_url: string;
  fetched_at: string;
  nines?: string | null;
}

function makeTeeTimeItem(overrides: Partial<TeeTimeItem> = {}): TeeTimeItem {
  return {
    course_id: "test-course",
    course_name: "Test Golf Course",
    course_city: "Minneapolis",
    date: "2026-04-01",
    time: "08:00",
    price: 45.0,
    holes: 18,
    open_slots: 4,
    booking_url: "https://example.com/book",
    fetched_at: new Date().toISOString(),
    nines: null,
    ...overrides,
  };
}

beforeAll(() => {
  // jsdom doesn't provide sendBeacon
  if (!navigator.sendBeacon) {
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn(), writable: true });
  }
});

describe("TeeTimeList rendering", () => {
  it("shows loading message when loading", () => {
    render(<TeeTimeList teeTimes={[]} loading={true} />);
    expect(screen.getByText("Loading tee times...")).toBeDefined();
  });

  it("shows empty state when no tee times", () => {
    render(<TeeTimeList teeTimes={[]} loading={false} />);
    expect(screen.getByText("No tee times found")).toBeDefined();
  });

  it("displays nines label when nines is a string", () => {
    const tt = makeTeeTimeItem({ nines: "East/West" });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.getByText("18 holes (East/West)")).toBeDefined();
  });

  it("omits nines label when nines is null", () => {
    const tt = makeTeeTimeItem({ nines: null });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.getByText("18 holes")).toBeDefined();
    expect(screen.queryByText(/East\/West/)).toBeNull();
  });

  it("omits nines label when nines is undefined", () => {
    const tt = makeTeeTimeItem();
    delete (tt as unknown as Record<string, unknown>).nines;
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.getByText("18 holes")).toBeDefined();
  });

  it("shows singular 'spot' for open_slots=1", () => {
    const tt = makeTeeTimeItem({ open_slots: 1 });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.getByText("1 spot")).toBeDefined();
  });

  it("shows plural 'spots' for open_slots > 1", () => {
    const tt = makeTeeTimeItem({ open_slots: 3 });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.getByText("3 spots")).toBeDefined();
  });

  it("shows price with $ format when not null", () => {
    const tt = makeTeeTimeItem({ price: 45.0 });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.getByText("$45.00")).toBeDefined();
  });

  it("hides price when null", () => {
    const tt = makeTeeTimeItem({ price: null });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("renders course name as link to /courses/{id}", () => {
    const tt = makeTeeTimeItem({ course_id: "my-course", course_name: "My Course" });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    const link = screen.getByText("My Course");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/courses/my-course");
  });

  it("renders Book button with correct href and target=_blank", () => {
    const tt = makeTeeTimeItem({ booking_url: "https://example.com/book-it" });
    render(<TeeTimeList teeTimes={[tt]} loading={false} />);
    const bookLink = screen.getByText("Book");
    expect(bookLink.tagName).toBe("A");
    expect(bookLink.getAttribute("href")).toBe("https://example.com/book-it");
    expect(bookLink.getAttribute("target")).toBe("_blank");
  });
});
