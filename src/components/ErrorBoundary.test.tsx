import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

function renderBoundary(child: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ErrorBoundary>{child}</ErrorBoundary>
    </MemoryRouter>,
  );
}

describe("ErrorBoundary", () => {
  it("shows the fallback when a child throws, and recovers on retry", () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = renderBoundary(<Boom />);
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
      expect(
        screen.getByRole("button", { name: "Try again" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
        "href",
        "/",
      );

      // Swap in a healthy child, then retry: the boundary recovers.
      rerender(
        <MemoryRouter>
          <ErrorBoundary>
            <div>healthy content</div>
          </ErrorBoundary>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByText("healthy content")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      silenced.mockRestore();
    }
  });

  it("renders children normally when nothing throws", () => {
    renderBoundary(<div>all good</div>);
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
