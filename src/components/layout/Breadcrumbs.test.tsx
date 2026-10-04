import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Breadcrumbs } from "./Breadcrumbs";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );
}

describe("Breadcrumbs", () => {
  it("shows only Home as current on the landing page", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByText("Home")).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link")).not.toBeInTheDocument();
  });

  it("links Home and marks the section as current", () => {
    renderAt("/purchase-orders");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const homeLink = within(nav).getByRole("link", { name: "Home" });
    expect(homeLink).toHaveAttribute("href", "/");
    expect(within(nav).getByText("Purchase Orders")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("builds a trail for nested paths with title-cased fallback", () => {
    renderAt("/items/abc-123");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Items" })).toHaveAttribute(
      "href",
      "/items",
    );
    expect(within(nav).getByText("Abc 123")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
