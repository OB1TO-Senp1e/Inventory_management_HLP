import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCSV } from "@/lib/csv";
import { ReportsPage } from "./ReportsPage";
import {
  useFoodCostTrend,
  usePriceChangeReport,
  useUsageReport,
  useWastageReport,
} from "./hooks";
import type { UsageRow, WastageReasonRow, FoodCostDay } from "@/lib/reports";
import type { PriceChangeReport } from "@/api/reports";

vi.mock("./hooks", () => ({
  useUsageReport: vi.fn(),
  useWastageReport: vi.fn(),
  useFoodCostTrend: vi.fn(),
  usePriceChangeReport: vi.fn(),
}));

vi.mock("@/lib/csv", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/csv")>();
  return { ...original, downloadCSV: vi.fn() };
});

const mockedUseUsageReport = vi.mocked(useUsageReport);
const mockedUseWastageReport = vi.mocked(useWastageReport);
const mockedUseFoodCostTrend = vi.mocked(useFoodCostTrend);
const mockedUsePriceChangeReport = vi.mocked(usePriceChangeReport);
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

function mockQueries(overrides?: {
  usage?: UsageRow[];
  wastage?: WastageReasonRow[];
  foodCost?: FoodCostDay[];
  priceChanges?: PriceChangeReport;
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
});
