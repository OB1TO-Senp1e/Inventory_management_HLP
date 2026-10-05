import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCSV } from "@/lib/csv";
import { ReportsPage } from "./ReportsPage";
import {
  useFoodCostTrend,
  useMenuEngineeringReport,
  usePriceChangeReport,
  useUsageReport,
  useWastageReport,
} from "./hooks";
import type { UsageRow, WastageReasonRow, FoodCostDay } from "@/lib/reports";
import type { PriceChangeReport } from "@/api/reports";
import type { MenuEngineeringReport } from "@/lib/menuEngineering";

vi.mock("./hooks", () => ({
  useUsageReport: vi.fn(),
  useWastageReport: vi.fn(),
  useFoodCostTrend: vi.fn(),
  usePriceChangeReport: vi.fn(),
  useMenuEngineeringReport: vi.fn(),
}));

vi.mock("@/lib/csv", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/csv")>();
  return { ...original, downloadCSV: vi.fn() };
});

const mockedUseUsageReport = vi.mocked(useUsageReport);
const mockedUseWastageReport = vi.mocked(useWastageReport);
const mockedUseFoodCostTrend = vi.mocked(useFoodCostTrend);
const mockedUsePriceChangeReport = vi.mocked(usePriceChangeReport);
const mockedUseMenuEngineeringReport = vi.mocked(useMenuEngineeringReport);
const mockedDownloadCSV = vi.mocked(downloadCSV);

const USAGE: UsageRow[] = [
  {
    itemId: "item-1",
    itemName: "Tomato",
    unitSymbol: "kg",
    movementType: "usage",
    lines: 2,
    quantity: 5,
    value: 162.5,
  },
  {
    itemId: "item-1",
    itemName: "Tomato",
    unitSymbol: "kg",
    movementType: "sale_deduction",
    lines: 1,
    quantity: 4,
    value: 130,
  },
];

const WASTAGE: WastageReasonRow[] = [
  { reasonCode: "expired", lines: 1, quantity: 1, value: 58 },
];

const FOOD_COST: FoodCostDay[] = [{ date: "2026-10-04", foodCost: 130 }];

const PRICE_CHANGES: PriceChangeReport = {
  events: [
    {
      date: "2026-10-04T08:30:00.000Z",
      supplierName: "Fresh Farms",
      itemName: "Tomato",
      oldPrice: 30,
      newPrice: 33,
      changePct: 10,
    },
  ],
  summaries: [
    {
      supplierId: "sup-1",
      supplierName: "Fresh Farms",
      itemId: "item-1",
      itemName: "Tomato",
      changes: 1,
      firstOldPrice: 30,
      lastNewPrice: 33,
      changePct: 10,
    },
  ],
};

const MENU_ENGINEERING: MenuEngineeringReport = {
  dishes: [
    {
      menuItemId: "dish-2",
      name: "Dal Makhani",
      active: true,
      qtySold: 6,
      sellingPrice: 149,
      costPerDish: 8,
      contributionMargin: 141,
      totalContribution: 846,
      foodCostPct: 5.37,
      classification: "plowhorse",
      unclassifiedReason: null,
    },
    {
      menuItemId: "dish-1",
      name: "Butter Chicken",
      active: true,
      qtySold: 4,
      sellingPrice: 199,
      costPerDish: 30.75,
      contributionMargin: 168.25,
      totalContribution: 673,
      foodCostPct: 15.45,
      classification: "puzzle",
      unclassifiedReason: null,
    },
    {
      menuItemId: null,
      name: "Old Name",
      active: null,
      qtySold: 2,
      sellingPrice: null,
      costPerDish: null,
      contributionMargin: null,
      totalContribution: null,
      foodCostPct: null,
      classification: null,
      unclassifiedReason: "unknown-dish",
    },
  ],
  avgPopularity: 5,
  avgMargin: 154.625,
  classifiedCount: 2,
  totalDishesSold: 12,
  totalContribution: 1519,
};

function mockQueries(overrides?: {
  usage?: UsageRow[];
  wastage?: WastageReasonRow[];
  foodCost?: FoodCostDay[];
  priceChanges?: PriceChangeReport;
  menuEngineering?: MenuEngineeringReport;
}) {
  const query = (data: unknown) =>
    ({ data, isLoading: false, isError: false }) as never;
  mockedUseUsageReport.mockReturnValue(query(overrides?.usage ?? USAGE));
  mockedUseWastageReport.mockReturnValue(
    query(overrides?.wastage ?? WASTAGE),
  );
  mockedUseFoodCostTrend.mockReturnValue(
    query(overrides?.foodCost ?? FOOD_COST),
  );
  mockedUsePriceChangeReport.mockReturnValue(
    query(overrides?.priceChanges ?? PRICE_CHANGES),
  );
  mockedUseMenuEngineeringReport.mockReturnValue(
    query(overrides?.menuEngineering ?? MENU_ENGINEERING),
  );
}

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<ReportsPage />, { wrapper });
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the header, date filter and report tabs", () => {
    mockQueries();
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    for (const label of [
      "Usage",
      "Wastage by reason",
      "Food cost trend",
      "Supplier price changes",
      "Menu engineering",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("shows the usage table with per-type rows and exports CSV", () => {
    mockQueries();
    renderPage();
    expect(screen.getAllByText("Tomato")).toHaveLength(2);
    expect(screen.getByText("Kitchen use")).toBeInTheDocument();
    expect(screen.getByText("Sale deduction")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(mockedDownloadCSV).toHaveBeenCalledTimes(1);
    const [filename, content] = mockedDownloadCSV.mock.calls[0];
    expect(filename).toMatch(/^usage-report-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain("Tomato");
    expect(content).toContain("Sale deduction");
  });

  it("shows an empty state when a report has no rows in the range", () => {
    mockQueries({ usage: [] });
    renderPage();
    expect(
      screen.getByText("No usage recorded in this date range."),
    ).toBeInTheDocument();
  });

  it("switches tabs and shows the wastage chart and table", () => {
    mockQueries();
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Wastage by reason" }));
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Usage report"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Wastage by reason report"),
    ).toBeInTheDocument();
  });

  it("shows the food cost trend with its data note", () => {
    mockQueries();
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Food cost trend" }));
    expect(screen.getByText(/Revenue is not captured in v1/)).toBeInTheDocument();
    expect(screen.getByText("₹130.00")).toBeInTheDocument();
  });

  it("shows price change events with the signed change percentage", () => {
    mockQueries();
    renderPage();
    fireEvent.click(
      screen.getByRole("tab", { name: "Supplier price changes" }),
    );
    expect(screen.getByText("Fresh Farms")).toBeInTheDocument();
    expect(screen.getByText("+10.0%")).toBeInTheDocument();
  });

  it("rejects an inverted date range without changing the report", () => {
    mockQueries();
    renderPage();
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-31" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      screen.getByText("The start date must be on or before the end date."),
    ).toBeInTheDocument();
    // The usage table still shows the data fetched for the valid range.
    expect(screen.getAllByText("Tomato").length).toBeGreaterThan(0);
  });

  it("shows a loading skeleton while a report loads", () => {
    mockQueries();
    mockedUseUsageReport.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as never);
    renderPage();
    expect(
      screen.getByLabelText("Loading usage report"),
    ).toBeInTheDocument();
  });

  it("shows the menu engineering quadrants, badges and margins", () => {
    mockQueries();
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Menu engineering" }));

    const panel = within(screen.getByLabelText("Menu engineering report"));
    // Quadrant chart renders with the average reference lines.
    expect(
      panel.getByLabelText("Popularity vs profitability (bubble = total contribution ₹)"),
    ).toBeInTheDocument();
    // Quadrant guide explains each class.
    expect(panel.getByText(/protect these dishes/)).toBeInTheDocument();
    // Table rows with classification badges.
    const table = within(panel.getByRole("table"));
    expect(table.getByText("Dal Makhani")).toBeInTheDocument();
    expect(table.getByText("Plowhorse")).toBeInTheDocument();
    expect(table.getByText("Butter Chicken")).toBeInTheDocument();
    expect(table.getByText("Puzzle")).toBeInTheDocument();
    // ₹168.25 margin/dish for Butter Chicken, ₹141.00 for Dal Makhani.
    expect(table.getByText("₹168.25")).toBeInTheDocument();
    expect(table.getByText("₹141.00")).toBeInTheDocument();
    // Renamed dish is shown with its quantities kept, not dropped.
    expect(table.getByText("Old Name")).toBeInTheDocument();
    expect(
      table.getByText("Dish not found (renamed or removed)"),
    ).toBeInTheDocument();
    // Live-data caveat is stated plainly.
    expect(
      panel.getByText(/evaluated at today's cost and price/),
    ).toBeInTheDocument();
  });

  it("sorts the menu engineering table by column", () => {
    mockQueries();
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Menu engineering" }));

    const panel = within(screen.getByLabelText("Menu engineering report"));
    const table = panel.getByRole("table");
    const dishCells = () =>
      Array.from(table.querySelectorAll("tbody tr")).map(
        (tr) => tr.querySelector("td")?.textContent ?? "",
      );
    // Default sort: total contribution desc → Dal Makhani first.
    expect(dishCells()).toEqual(["Dal Makhani", "Butter Chicken", "Old Name"]);
    // Sort by dish name ascending.
    fireEvent.click(screen.getByRole("button", { name: "Sort by Dish" }));
    expect(dishCells()).toEqual(["Butter Chicken", "Dal Makhani", "Old Name"]);
    // Sort by classification descending: unclassified rows stay last.
    const classSort = screen.getByRole("button", { name: "Sort by Class" });
    fireEvent.click(classSort);
    fireEvent.click(classSort);
    expect(dishCells()).toEqual(["Butter Chicken", "Dal Makhani", "Old Name"]);
  });

  it("exports the menu engineering report as CSV", () => {
    mockQueries();
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Menu engineering" }));

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(mockedDownloadCSV).toHaveBeenCalledTimes(1);
    const [filename, content] = mockedDownloadCSV.mock.calls[0];
    expect(filename).toMatch(/^menu-engineering-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain("Butter Chicken");
    expect(content).toContain("Puzzle");
  });

  it("shows an empty state when no sales were recorded in the range", () => {
    mockQueries({
      menuEngineering: {
        dishes: [],
        avgPopularity: 0,
        avgMargin: 0,
        classifiedCount: 0,
        totalDishesSold: 0,
        totalContribution: 0,
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Menu engineering" }));
    expect(
      screen.getByText("No sales recorded in this date range."),
    ).toBeInTheDocument();
  });
});
