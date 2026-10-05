import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionFallback } from "./SectionFallback";

describe("SectionFallback", () => {
  it("renders an accessible loading status", () => {
    render(<SectionFallback />);
    const status = screen.getByRole("status", { name: "Loading section" });
    expect(status).toBeInTheDocument();
  });

  it("does not render page content", () => {
    const { container } = render(<SectionFallback />);
    expect(container.textContent).toBe("");
  });
});
