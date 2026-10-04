import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "./ToastProvider";
import { useToast } from "./useToast";

function Probe() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.success("Saved successfully")}>
        ok-button
      </button>
      <button type="button" onClick={() => toast.error("Something failed")}>
        fail-button
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}

describe("ToastProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a success toast and dismisses it via the close button", () => {
    renderProbe();
    fireEvent.click(screen.getByText("ok-button"));

    const region = screen.getByRole("status", { name: "Notifications" });
    expect(region).toHaveTextContent("Saved successfully");

    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
  });

  it("shows an error toast with the destructive style", () => {
    renderProbe();
    fireEvent.click(screen.getByText("fail-button"));

    const region = screen.getByRole("status", { name: "Notifications" });
    expect(region).toHaveTextContent("Something failed");
    expect(region.querySelector(".bg-destructive")).not.toBeNull();
  });

  it("stacks multiple toasts", () => {
    renderProbe();
    fireEvent.click(screen.getByText("ok-button"));
    fireEvent.click(screen.getByText("fail-button"));

    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
    expect(screen.getByText("Something failed")).toBeInTheDocument();
  });

  it("auto-dismisses a toast after five seconds", () => {
    vi.useFakeTimers();
    renderProbe();
    fireEvent.click(screen.getByText("fail-button"));
    expect(screen.getByText("Something failed")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Something failed")).not.toBeInTheDocument();
  });

  it("throws when useToast is used outside a provider", () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Probe />)).toThrow(
        "useToast must be used within ToastProvider",
      );
    } finally {
      silenced.mockRestore();
    }
  });
});
