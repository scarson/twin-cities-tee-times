// @vitest-environment jsdom
// ABOUTME: Tests for the HolesFilter component.
// ABOUTME: Verifies button rendering, active state switching, and onChange callbacks.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HolesFilter } from "./holes-filter";

describe("HolesFilter", () => {
  it("renders three options: Any, 9 holes, 18 holes", () => {
    render(<HolesFilter value="" onChange={vi.fn()} />);
    expect(screen.getByText("Any")).toBeDefined();
    expect(screen.getByText("9 holes")).toBeDefined();
    expect(screen.getByText("18 holes")).toBeDefined();
  });

  it("invokes onChange with '9' when the 9 holes button is clicked", () => {
    const onChange = vi.fn();
    render(<HolesFilter value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("9 holes"));
    expect(onChange).toHaveBeenCalledWith("9");
  });

  it("invokes onChange with '18' when the 18 holes button is clicked", () => {
    const onChange = vi.fn();
    render(<HolesFilter value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("18 holes"));
    expect(onChange).toHaveBeenCalledWith("18");
  });

  it("invokes onChange with '' when the Any button is clicked", () => {
    const onChange = vi.fn();
    render(<HolesFilter value="9" onChange={onChange} />);

    fireEvent.click(screen.getByText("Any"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("applies active styling to the selected button", () => {
    const { rerender } = render(<HolesFilter value="" onChange={vi.fn()} />);

    // "Any" is active when value is ""
    const anyBtn = screen.getByText("Any");
    expect(anyBtn.className).toContain("bg-green-600");

    rerender(<HolesFilter value="18" onChange={vi.fn()} />);
    const eighteenBtn = screen.getByText("18 holes");
    expect(eighteenBtn.className).toContain("bg-green-600");
    expect(screen.getByText("Any").className).not.toContain("bg-green-600");
  });
});
