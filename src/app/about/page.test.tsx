// @vitest-environment jsdom
// ABOUTME: Tests for the About/How It Works page.
// ABOUTME: Verifies key FAQ content sections are rendered.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import AboutPage from "./page";

describe("About page", () => {
  it("renders the page heading", () => {
    render(<AboutPage />);
    expect(screen.getByText("How It Works")).toBeDefined();
  });

  it("includes the polling frequency table", () => {
    render(<AboutPage />);
    expect(screen.getByText("Today & tomorrow")).toBeDefined();
    expect(screen.getByText("8–14 days out")).toBeDefined();
  });

  it("explains the stale indicator", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/marked as stale/)
    ).toBeDefined();
  });

  it("mentions the Refresh button", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/hit the/)
    ).toBeDefined();
  });

  it("explains that booking is external", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/link directly to each/)
    ).toBeDefined();
  });

  it("explains sharing favorites", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/Share favorites/)
    ).toBeDefined();
  });

  it("explains sign-in is optional", () => {
    render(<AboutPage />);
    expect(screen.getByText(/never required/)).toBeDefined();
  });

  it("explains sign-in syncs favorites across devices", () => {
    render(<AboutPage />);
    expect(screen.getByText(/sync across devices/)).toBeDefined();
  });

  it("explains what data is collected on sign-in", () => {
    render(<AboutPage />);
    expect(screen.getByText(/name and email/)).toBeDefined();
  });

  it("explains how to delete account", () => {
    render(<AboutPage />);
    expect(screen.getByText(/Delete account/)).toBeDefined();
  });

  it("explains local favorites survive account deletion", () => {
    render(<AboutPage />);
    expect(screen.getByText(/local favorites are not affected/)).toBeDefined();
  });

  it("explains location filtering privacy", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/How does location filtering work/)
    ).toBeDefined();
    expect(
      screen.getByText(/never sent to our servers/)
    ).toBeDefined();
  });

  it("shows build info when env vars are set", () => {
    process.env.NEXT_PUBLIC_BUILD_SHA = "abc1234";
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-03-26T12:00:00Z";
    render(<AboutPage />);
    expect(screen.getByText(/Build: abc1234/)).toBeDefined();
    expect(screen.getByText(/2026-03-26T12:00:00Z/)).toBeDefined();
    delete process.env.NEXT_PUBLIC_BUILD_SHA;
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
  });

  it("hides build info when env vars are not set", () => {
    delete process.env.NEXT_PUBLIC_BUILD_SHA;
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
    render(<AboutPage />);
    expect(screen.queryByText(/Build:/)).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<AboutPage />);
    const results = await axe(container, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
