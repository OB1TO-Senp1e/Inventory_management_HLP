import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Breadcrumbs } from "./Breadcrumbs";
import { useItem } from "@/features/items/hooks";
import { useSupplier } from "@/features/suppliers/hooks";
import { useStockCount } from "@/features/counts/hooks";

// The detail-name lookups are mocked: these tests verify crumb labels and
// link behavior, not data fetching.
vi.mock("@/features/items/hooks", () => ({ useItem: vi.fn() }));
vi.mock("@/features/suppliers/hooks", () => ({ useSupplier: vi.fn() }));
vi.mock("@/features/counts/hooks", () => ({ useStockCount: vi.fn() }));

const mockedUseItem = vi.mocked(useItem);
const mockedUseSupplier = vi.mocked(useSupplier);
const mockedUseStockCount = vi.mocked(useStockCount);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // No entity loaded by default: crumbs fall back to the raw segment.
  mockedUseItem.mockReturnValue({ data: undefined } as ReturnType<
    typeof useItem
  >);
  mockedUseSupplier.mockReturnValue({ data: undefined } as ReturnType<
    typeof useSupplier
  >);
  mockedUseStockCount.mockReturnValue({ data: undefined } as ReturnType<
    typeof useStockCount
  >);
});

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

  it("does not link trail segments with no registered route", () => {
    // There is no supplier detail page: /suppliers/:id is not registered,
    // so the middle crumb must be plain text (never a link to a 404).
    renderAt("/suppliers/abc-123/prices");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Suppliers" })).toHaveAttribute(
      "href",
      "/suppliers",
    );
    const middle = within(nav).getByText("Abc 123");
    expect(middle).not.toHaveAttribute("aria-current");
    expect(within(nav).queryByRole("link", { name: "Abc 123" })).not.toBeInTheDocument();
    expect(within(nav).getByText("Prices")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("resolves the item id crumb to the item name", () => {
    mockedUseItem.mockReturnValue({
      data: { name: "Tomato" },
    } as ReturnType<typeof useItem>);
    renderAt("/items/abc-123");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByText("Tomato")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).queryByText("Abc 123")).not.toBeInTheDocument();
  });

  it("resolves the supplier id crumb to the supplier name (still plain text)", () => {
    mockedUseSupplier.mockReturnValue({
      data: { name: "Fresh Farms Produce" },
    } as ReturnType<typeof useSupplier>);
    renderAt("/suppliers/abc-123/prices");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const middle = within(nav).getByText("Fresh Farms Produce");
    // The supplier id segment has no registered route: name shown, not linked.
    expect(middle).not.toHaveAttribute("aria-current");
    expect(
      within(nav).queryByRole("link", { name: "Fresh Farms Produce" }),
    ).not.toBeInTheDocument();
    expect(within(nav).getByText("Prices")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("resolves the count id crumb to the count title", () => {
    mockedUseStockCount.mockReturnValue({
      data: { title: "Weekly full count" },
    } as ReturnType<typeof useStockCount>);
    renderAt("/stock-counts/abc-123");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByText("Weekly full count")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).queryByText("Abc 123")).not.toBeInTheDocument();
  });
});
