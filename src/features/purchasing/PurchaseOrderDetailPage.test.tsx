import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrderDetail } from "@/api/purchasing";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { PurchaseOrderDetailPage } from "./PurchaseOrderDetailPage";

// Hooks are mocked: these tests verify the lifecycle UI (send/cancel/
// receive actions per status) with zero network.
const mockMutate = vi.fn();
vi.mock("./hooks", () => ({
  usePurchaseOrder: vi.fn(),
  useUpdatePurchaseOrder: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useAddPurchaseOrderLine: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemovePurchaseOrderLine: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSendPurchaseOrder: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  useCancelPurchaseOrder: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  useReceivePurchaseOrder: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  useSupplierPricesForPrefill: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/features/stock/hooks", () => ({
  useReceivableItems: vi.fn(() => ({ items: [], isLoading: false })),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "owner" },
  }),
}));

import { usePurchaseOrder } from "./hooks";

const mockedUsePurchaseOrder = vi.mocked(usePurchaseOrder);

function samplePO(status: PurchaseOrderDetail["status"]): PurchaseOrderDetail {
  return {
    id: "po-1",
    supplierId: "sup-1",
    supplierName: "Fresh Farms",
    supplierAddress: "APMC Market, Vashi",
    supplierPhone: "+91 98200 12345",
    supplierEmail: "ramesh@freshfarms.example",
    supplierGstin: "27ABCDE1234F1Z5",
    status,
    orderDate: "2026-10-05",
    expectedDate: null,
    notes: null,
    gstRate: 18,
    lineCount: 2,
    total: 605,
    gstAmount: 108.9,
    grandTotal: 713.9,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    lines: [
      {
        id: "line-1",
        itemId: "item-1",
        itemName: "Tomato",
        unitSymbol: "kg",
        quantity: 10,
        unitPrice: 32.5,
        receivedQuantity: status === "draft" ? 0 : 4,
        lineTotal: 325,
        notes: null,
      },
      {
        id: "line-2",
        itemId: "item-2",
        itemName: "Milk",
        unitSymbol: "L",
        quantity: 5,
        unitPrice: 56,
        receivedQuantity: 0,
        lineTotal: 280,
        notes: null,
      },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PurchaseOrderDetailPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchaseOrderDetailPage lifecycle actions", () => {
  it("draft shows Send and Cancel, hides Receive", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("draft"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel order/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^receive$/i }),
    ).not.toBeInTheDocument();
  });

  it("sent shows Receive and Cancel, hides Send", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("sent"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    expect(screen.getByRole("button", { name: /^receive$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel order/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
  });

  it("partially_received shows Receive but not Cancel", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("partially_received"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    expect(screen.getByRole("button", { name: /^receive$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel order/i }),
    ).not.toBeInTheDocument();
  });

  it("received shows no lifecycle actions", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("received"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^receive$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel order/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/fully received and closed/i)).toBeInTheDocument();
  });

  it("lines show received vs ordered quantities once sent", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("sent"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    // Line 1: 4 kg received of 10 → "4 kg" + "(6 pending)".
    expect(screen.getByText("(6 pending)")).toBeInTheDocument();
  });

  it("receive form opens with remaining quantities prefilled", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("sent"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^receive$/i }));
    // Line 1: 10 ordered, 4 received → 6 pending prefilled.
    const qtyInput = screen.getByLabelText(/qty receiving \(kg\)/i) as HTMLInputElement;
    expect(qtyInput.value).toBe("6");
    expect(screen.getAllByLabelText(/batch no/i)).toHaveLength(2);
    expect(screen.getAllByLabelText(/^expiry/i)).toHaveLength(2);
  });

  it("send confirmation calls the send mutation", () => {
    mockedUsePurchaseOrder.mockReturnValue({
      data: samplePO("draft"),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePurchaseOrder>);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Send order" }));
    expect(mockMutate).toHaveBeenCalledWith("po-1", expect.anything());
  });
});
