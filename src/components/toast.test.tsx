// @vitest-environment jsdom
// ABOUTME: Tests for the Toast notification component.
// ABOUTME: Verifies rendering, auto-dismiss timing, and hidden state.
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { Toast } from "./toast";

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders message text when shown", () => {
    render(<Toast message="Hello" onDismiss={() => {}} />);
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("auto-dismisses after 5 seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Goodbye" onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not render when message is null", () => {
    const { container } = render(
      <Toast message={null} onDismiss={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });
});
