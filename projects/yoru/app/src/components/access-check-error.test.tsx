import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessCheckError } from "./access-check-error";

describe("access error states", () => {
  it("distinguishes rate limiting from missing admission and honors Retry-After", () => {
    vi.useFakeTimers();
    try {
      const retry = vi.fn();
      const error = { status: 429, headers: new Headers({ "Retry-After": "3" }) };
      render(<AccessCheckError error={error} retry={retry} />);
      expect(screen.getByText("Access checks temporarily paused")).toBeTruthy();
      expect(screen.getByText(/not an invitation rejection/)).toBeTruthy();
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(retry).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(3_000));
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(retry).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("makes ownership conflicts distinct from a rejected invitation", () => {
    render(<AccessCheckError error={{ status: 409 }} retry={vi.fn()} />);
    expect(screen.getByText("Owner setup needs attention")).toBeTruthy();
    expect(screen.queryByText("Invitation link not found")).toBeNull();
  });
});
