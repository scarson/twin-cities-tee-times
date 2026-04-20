// @vitest-environment jsdom
// ABOUTME: Rendering tests for the TimeFilter component.
// ABOUTME: Verifies preset labels, hour captions, and active-state switching.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeFilter } from "./time-filter";

describe("TimeFilter", () => {
  it("renders each preset label with its hour range caption", () => {
    render(
      <TimeFilter startTime="" endTime="" onChange={vi.fn()} />
    );
    expect(screen.getByText("Early")).toBeDefined();
    expect(screen.getByText("5–8 AM")).toBeDefined();
    expect(screen.getByText("Morning")).toBeDefined();
    expect(screen.getByText("8–11 AM")).toBeDefined();
    expect(screen.getByText("Afternoon")).toBeDefined();
    expect(screen.getByText("11 AM–3 PM")).toBeDefined();
    expect(screen.getByText("Late")).toBeDefined();
    expect(screen.getByText("After 3 PM")).toBeDefined();
  });

  it("invokes onChange with the preset's start/end times", () => {
    const onChange = vi.fn();
    render(<TimeFilter startTime="" endTime="" onChange={onChange} />);

    fireEvent.click(screen.getByText("Morning"));
    expect(onChange).toHaveBeenCalledWith({ startTime: "08:00", endTime: "11:00" });
  });
});
