import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { DashboardPage } from "./DashboardPage";
import { useDashboardRealtime, useDashboardSummary } from "./hooks";
import {
  useStockOverview,
  useStockOverviewRealtime,
} from "@/features/items/stockHooks";
import type { StockOverviewRow } from "@/api/stock";
import type { DashboardSummary } from "@/api/dashboard";

vi.mock("./hooks", () => ({
  useDashboardSummary: vi.fn(),
  useDashboardRealtime: vi.fn(),
}));
vi.mock("@/features/items/stockHooks", () => ({
  useStockOverview: vi.fn(),
  useStockOverviewRealtime: vi.fn(),
}));

const mockedUseDashboardSummary = vi.mocked(useDashboardSummary);
const mockedUseDashboardRealtime = vi.mocked(useDashboardRealtime);
const mockedUseStockOverview = vi.mocked(useStockOverview);
const mockedUseStockOverviewRealtime = vi.mocked(useStockOverviewRealtime);

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function row(overrides: Partial<StockOverviewRow>): StockOverviewRow {
  return {
    itemId: "item-1",
    name: "Tomato",
    categoryId: null,
    categoryName: null,
    locationId: null,
    locationName: null,
    unitSymbol: "kg",
    reorderPoint: 10,
    parLevel: 50,
    quantity: 42.5,
    lastMovementAt: null,
    earliestExpiry: null,
    ...overrides,
  };
}

const summary: DashboardSummary = {
  usage: { lines: 2, quantity: 30, value: 975 },
  wastage: { lines: 1, quantity: 1, value: 58 },
  stockValue: 1555.25,
};

function mockQueries(
  rows: StockOverviewRow[],
  dashboardData: DashboardSummary | undefined,
) {
  mockedUseStockOverview.mockReturnValue({
    data: rows,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useStockOverview>);
  mockedUseDashboardSummary.mockReturnValue({
    data: dashboardData,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDashboardSummary>);
}

function renderPage(): void {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  render(<DashboardPage />, { wrapper });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseDashboardRealtime.mockReturnValue(undefined);
    mockedUseStockOverviewRealtime.mockReturnValue(undefined);
  });

  it("shows low-stock and expiring counts matching the /stock predicates", () => {
    mockQueries(
      [
        row({ itemId: "1", name: "Milk", quantity: 3, reorderPoint: 10 }), // low
        row({ itemId: "2", name: "Flour", quantity: 0, reorderPoint: 20 }), // low
        row({ itemId: "3", name: "Tomato", quantity: 42.5, earliestExpiry: iso(3) }), // expiring
      ],
      summary,
    );
    renderPage();

    const lowCard = screen.getByRole("heading", { name: "Low stock" }).closest("section")!;
    expect(lowCard).toHaveTextContent("2");
    expect(lowCard).toHaveTextContent("items at or below reorder point");
    expect(
      lowCard.querySelector('a[href="/stock?low=1"]'),
    ).not.toBeNull();

    const expCard = screen.getByRole("heading", { name: "Expiring soon" }).closest("section")!;
    expect(expCard).toHaveTextContent("1");
    expect(
      expCard.querySelector('a[href="/stock?expiring=1"]'),
    ).not.toBeNull();
  });

  it("shows today's usage/wastage lines, quantities and ₹ values", () => {
    mockQueries([row({})], summary);
    renderPage();

    const card = screen.getByRole("heading", { name: "Today's usage & wastage" }).closest("section")!;
    expect(card).toHaveTextContent("Usage");
    expect(card).toHaveTextContent("2 lines");
    expect(card).toHaveTextContent("₹975.00");
    expect(card).toHaveTextContent("Wastage");
    expect(card).toHaveTextContent("1 line");
    expect(card).toHaveTextContent("₹58.00");
  });

  it("formats the stock value in ₹ en-IN", () => {
    mockQueries([row({})], summary);
    renderPage();
    expect(screen.getByText("₹1,555.25")).toBeVisible();
  });

  it("renders the loading skeleton while queries load", () => {
    mockedUseStockOverview.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useStockOverview>);
    mockedUseDashboardSummary.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    expect(screen.getByLabelText("Loading dashboard")).toBeVisible();
  });

  it("renders an error state with retry when a query fails", () => {
    const refetch = vi.fn();
    mockedUseStockOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useStockOverview>);
    mockedUseDashboardSummary.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the dashboard.",
    );
  });
});
