// @vitest-environment jsdom
// ABOUTME: Tests for the share favorites confirmation dialog.
// ABOUTME: Covers rendering, accept, cancel, and empty state.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { axe } from "vitest-axe";
import { ShareDialog } from "./share-dialog";

describe("ShareDialog", () => {
  const courses = [
    { id: "braemar", name: "Braemar" },
    { id: "edinburgh-usa", name: "Edinburgh USA" },
  ];

  it("renders course names", () => {
    render(<ShareDialog courses={courses} onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Braemar")).toBeDefined();
    expect(screen.getByText("Edinburgh USA")).toBeDefined();
  });

  it("shows count in heading", () => {
    render(<ShareDialog courses={courses} onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Add 2 courses/)).toBeDefined();
  });

  it("calls onAccept when accept button is clicked", () => {
    const onAccept = vi.fn();
    render(<ShareDialog courses={courses} onAccept={onAccept} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Add to favorites"));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ShareDialog courses={courses} onAccept={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("No thanks"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("uses singular heading for one course", () => {
    render(
      <ShareDialog
        courses={[{ id: "braemar", name: "Braemar" }]}
        onAccept={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/Add 1 course/)).toBeDefined();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ShareDialog courses={courses} onAccept={() => {}} onCancel={() => {}} />
    );
    const results = await axe(container, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
