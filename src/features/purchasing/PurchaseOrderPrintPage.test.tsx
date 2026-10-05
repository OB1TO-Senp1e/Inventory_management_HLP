import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrderDetail } from "@/api/purchasing";
import { PurchaseOrderPrintPage } from "./PurchaseOrderPrintPage";

// Hooks are mocked: these tests verify the print document structure
// (supplier block, lines, totals/GST) with zero network.
vi.mock("./hooks", () => ({
  usePurchaseOrder: vi.fn(),
  useRestaurantName: vi.fn(),
}));

import { usePurchaseOrder, useRestaurantName } from "./hooks";

const mockedUsePurchaseOrder = vi.mocked(usePurchaseOrder);
const mockedUseRestaurantName = vi.mocked(useRestaurantName);

function samplePO(): PurchaseOrderDetail {
  return {
    id: "po-1",
    supplierId: "sup-1",
    supplierName: "Fresh Farms",
    supplierAddress: "APMC Market, Vashi",
    supplierPhone: "+91 98200 12345",
    supplierEmail: null,
    supplierGstin: "27ABCDE1234F1Z5",
    status: "sent",
    orderDate: "2026-10-05",
    expectedDate: "2026-10-12",
    notes: "Deliver before noon.",
    gstRate: 18,
    lineCount: 2,
    total: 1000,
    gstAmount: 180,
    grandTotal: 1180,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    sentAt: null,
    sentVia: null,
    lines: [
      {
        id: "line-1",
        itemId: "item-1",
        itemName: "Tomato",
        unitSymbol: "kg",
        quantity: 10,
        unitPrice: 60,
        receivedQuantity: 0,
        lineTotal: 600,
        notes: null,
      },
      {
        id: "line-2",
        itemId: "item-2",
        itemName: "Milk",
        unitSymbol: "L",
        quantity: 5,
        unitPrice: 80,
        receivedQuantity: 0,
        lineTotal: 400,
        notes: null,
      },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/purchase-orders/po-1/print"]}>
      <Routes>
        <Route path="/purchase-orders/:id/print" element={<PurchaseOrderPrintPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PurchaseOrderPrintPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    mockedUseRestaurantName.mockReturnValue({
      data: "Testaurant",
      isLoading: false,
    } as unknown as ReturnType<typeof useRestaurantName>);
    vi.stubGlobal("print", vi.fn());
  });

  it("renders the document with restaurant, PO number, and status", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Testaurant" })).toBeInTheDocument();
    expect(screen.getByText("#PO-1", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("sent", { exact: false })).toBeInTheDocument();
  });

  it("renders the supplier block with GSTIN", () => {
    renderPage();
    expect(screen.getByText("Fresh Farms")).toBeInTheDocument();
    expect(screen.getByText("APMC Market, Vashi")).toBeInTheDocument();
    expect(screen.getByText(/GSTIN: 27ABCDE1234F1Z5/)).toBeInTheDocument();
  });

  it("renders lines with quantities and snapshotted prices", () => {
    renderPage();
    expect(screen.getByText("Tomato")).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
    // Line totals use en-IN currency formatting.
    expect(screen.getByText("₹600.00")).toBeInTheDocument();
    expect(screen.getByText("₹400.00")).toBeInTheDocument();
  });

  it("renders subtotal, GST, and grand total", () => {
    renderPage();
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("GST (18%)")).toBeInTheDocument();
    expect(screen.getByText("₹180.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,180.00")).toBeInTheDocument();
  });

  it("shows an error state with retry when the PO fails to load", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  });

  it("auto-opens the print dialog once loaded", () => {
    vi.useFakeTimers();
    renderPage();
    expect(window.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(window.print).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
