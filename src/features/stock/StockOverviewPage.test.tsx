import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { StockOverviewPage } from "./StockOverviewPage";
import { useItemLookups } from "@/features/items/hooks";
import {
  useStockOverview,
  useStockOverviewRealtime,
} from "@/features/items/stockHooks";
import type { StockOverviewRow } from "@/api/stock";

vi.mock("@/features/items/hooks", () => ({ useItemLookups: vi.fn() }));
vi.mock("@/features/items/stockHooks", () => ({
  useStockOverview: vi.fn(),
  useStockOverviewRealtime: vi.fn(),
}));
vi.mock("@/features/purchasing/hooks", () => ({
  useReorderSuggestions: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

const mockedUseStockOverview = vi.mocked(useStockOverview);
const mockedUseStockOverviewRealtime = vi.mocked(useStockOverviewRealtime);
const mockedUseItemLookups = vi.mocked(useItemLookups);

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const CAT_VEG = "c0000000-0000-0000-0000-000000000001";
const CAT_DAIRY = "c0000000-0000-0000-0000-000000000002";
const LOC_COLD = "d0000000-0000-0000-0000-000000000001";
const LOC_DRY = "d0000000-0000-0000-0000-000000000002";

const rows: StockOverviewRow[] = [
  {
    itemId: "b0000000-0000-0000-0000-000000000001",
    name: "Tomato",
    categoryId: CAT_VEG,
    categoryName: "Vegetables",
    locationId: LOC_COLD,
    locationName: "Cold Room",
    unitSymbol: "kg",
    reorderPoint: 10,
    parLevel: 50,
    quantity: 5, // low stock
    lastMovementAt: "2026-10-04T10:00:00Z",
    earliestExpiry: iso(3), // expiring soon
  },
  {
    itemId: "b0000000-0000-0000-0000-000000000002",
    name: "Milk",
    categoryId: CAT_DAIRY,
    categoryName: "Dairy",
    locationId: LOC_COLD,
    locationName: "Cold Room",
    unitSymbol: "L",
    reorderPoint: 10,
    parLevel: 40,
    quantity: 28,
    lastMovementAt: "2026-10-04T09:00:00Z",
    earliestExpiry: iso(60),
  },
  {
    itemId: "b0000000-0000-0000-0000-000000000003",
    name: "Flour",
    categoryId: CAT_VEG,
    categoryName: "Vegetables",
    locationId: LOC_DRY,
    locationName: "Dry Store",
    unitSymbol: "kg",
    reorderPoint: 20,
    parLevel: 100,
    quantity: 0, // low stock, no expiry
    lastMovementAt: null,
    earliestExpiry: null,
  },
];

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(<StockOverviewPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseStockOverview.mockReturnValue({
    data: rows,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useStockOverview>);
  mockedUseStockOverviewRealtime.mockReturnValue(undefined);
  mockedUseItemLookups.mockReturnValue({
    categories: [
      { id: CAT_VEG, name: "Vegetables" },
      { id: CAT_DAIRY, name: "Dairy" },
    ],
    locations: [
      { id: LOC_COLD, name: "Cold Room" },
      { id: LOC_DRY, name: "Dry Store" },
    ],
    units: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe("StockOverviewPage", () => {
  it("renders every row with quantities and status badges", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Stock" }),
    ).toBeInTheDocument();
    // Item names link to the detail page (table + mobile card both render
    // in jsdom — no media queries — so expect both).
    const tomatoLinks = screen.getAllByRole("link", { name: "Tomato" });
    expect(tomatoLinks).toHaveLength(2);
    expect(tomatoLinks[0]).toHaveAttribute(
      "href",
      "/items/b0000000-0000-0000-0000-000000000001",
    );
    // Low-stock badges: Tomato (5 <= 10) and Flour (0 <= 20); Milk is fine.
    // Each renders twice (table + card).
    expect(screen.getAllByText("Low stock")).toHaveLength(4);
    // Expiring-soon badge only for Tomato (table + card); the filter
    // checkbox shares the label text, so scope by the badge title.
    expect(screen.getAllByTitle(/Expires on/)).toHaveLength(2);
    expect(screen.getByText(/Showing 3 of 3 items/)).toBeInTheDocument();
  });

  it("combines category, location, low-stock and expiring filters", () => {
    renderPage();
    // Category filter alone: Vegetables → Tomato + Flour.
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: CAT_VEG },
    });
    expect(screen.getByText(/Showing 2 of 3 items/)).toBeInTheDocument();
    expect(screen.queryAllByText("Milk")).toHaveLength(0);

    // Add low-stock only: still Tomato + Flour (both low).
    fireEvent.click(screen.getByLabelText("Low stock only"));
    expect(screen.getByText(/Showing 2 of 3 items/)).toBeInTheDocument();

    // Add expiring soon: only Tomato (Flour has no expiry).
    fireEvent.click(screen.getByLabelText("Expiring soon"));
    expect(screen.getByText(/Showing 1 of 3 items/)).toBeInTheDocument();
    expect(screen.getAllByText("Tomato")).toHaveLength(2);
    expect(screen.queryAllByText("Flour")).toHaveLength(0);

    // Location Dry Store excludes Tomato → empty with a clear action.
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: LOC_DRY },
    });
    expect(
      screen.getByText("No items match these filters."),
    ).toBeInTheDocument();
    // Two "Clear filters" buttons exist (filter bar + empty state); either
    // resets the filters.
    const clearButtons = screen.getAllByRole("button", {
      name: "Clear filters",
    });
    fireEvent.click(clearButtons[clearButtons.length - 1]);
    expect(screen.getByText(/Showing 3 of 3 items/)).toBeInTheDocument();
  });

  it("shows the loading skeleton while fetching", () => {
    mockedUseStockOverview.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useStockOverview>);
    renderPage();
    expect(screen.getByLabelText("Loading stock overview")).toBeInTheDocument();
  });

  it("shows the error state with a retry action", () => {
    const refetch = vi.fn();
    mockedUseStockOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useStockOverview>);
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load stock/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("subscribes to realtime updates on mount", () => {
    renderPage();
    expect(mockedUseStockOverviewRealtime).toHaveBeenCalledTimes(1);
  });
});
