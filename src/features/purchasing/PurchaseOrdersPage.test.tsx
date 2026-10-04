import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrder } from "@/api/purchasing";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";

// Hooks are mocked: these tests verify page states (loading / error /
// empty / populated) with zero network.
vi.mock("./hooks", () => ({
  usePurchaseOrders: vi.fn(),
  usePurchaseOrder: vi.fn(),
  useCreatePurchaseOrder: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdatePurchaseOrder: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAddPurchaseOrderLine: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemovePurchaseOrderLine: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSupplierPricesForPrefill: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/features/suppliers/hooks", () => ({
  useSuppliers: vi.fn(() => ({ data: { suppliers: [], total: 0 } })),
  useSupplier: vi.fn(),
}));

vi.mock("@/features/stock/hooks", () => ({
  useReceivableItems: vi.fn(() => ({ items: [], isLoading: false })),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "owner" },
  }),
}));

import { usePurchaseOrders } from "./hooks";

const mockedUsePurchaseOrders = vi.mocked(usePurchaseOrders);

const samplePO: PurchaseOrder = {
  id: "po-1",
  supplierId: "sup-1",
  supplierName: "Fresh Farms",
  status: "draft",
  orderDate: "2026-10-05",
  expectedDate: null,
  notes: null,
  lineCount: 2,
  total: 605,
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PurchaseOrdersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchaseOrdersPage", () => {
  it("shows the loading skeleton while fetching", () => {
    mockedUsePurchaseOrders.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrders>);
    renderPage();
    expect(screen.getByLabelText(/loading purchase orders/i)).toBeInTheDocument();
  });

  it("shows the error state with retry", () => {
    const refetch = vi.fn();
    mockedUsePurchaseOrders.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof usePurchaseOrders>);
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load purchase orders/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state with a create action", () => {
    mockedUsePurchaseOrders.mockReturnValue({
      data: { orders: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrders>);
    renderPage();
    expect(screen.getByText(/no purchase orders yet/i)).toBeInTheDocument();
  });

  it("renders POs with totals in ₹ en-IN and status badges", () => {
    mockedUsePurchaseOrders.mockReturnValue({
      data: { orders: [samplePO], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrders>);
    renderPage();
    // Desktop table and mobile cards both render in jsdom (no media queries).
    expect(screen.getAllByText("Fresh Farms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    // ₹605.00 in en-IN format
    expect(screen.getAllByText(/₹605\.00/).length).toBeGreaterThan(0);
  });

  it("opens the create dialog", () => {
    mockedUsePurchaseOrders.mockReturnValue({
      data: { orders: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrders>);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /new purchase order/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/line items/i)).toBeInTheDocument();
  });

  it("filters by status", () => {
    mockedUsePurchaseOrders.mockReturnValue({
      data: { orders: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof usePurchaseOrders>);
    renderPage();
    const select = screen.getByLabelText(/status/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "sent" } });
    expect(mockedUsePurchaseOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
  });
});
