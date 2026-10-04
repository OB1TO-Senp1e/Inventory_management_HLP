import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderDialog } from "./PurchaseOrderDialog";

// Hooks are mocked: these tests verify the prefill flow with zero network.
const mockMutate = vi.fn();

vi.mock("./hooks", () => ({
  usePurchaseOrders: vi.fn(),
  usePurchaseOrder: vi.fn(),
  useCreatePurchaseOrder: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  useUpdatePurchaseOrder: vi.fn(),
  useAddPurchaseOrderLine: vi.fn(),
  useRemovePurchaseOrderLine: vi.fn(),
  useSupplierPricesForPrefill: vi.fn(),
}));

vi.mock("@/features/suppliers/hooks", () => ({
  useSuppliers: vi.fn(() => ({
    data: {
      suppliers: [{ id: "11111111-1111-1111-1111-111111111111", name: "Fresh Farms" }],
      total: 1,
    },
  })),
  useSupplier: vi.fn(),
}));

vi.mock("@/features/stock/hooks", () => ({
  useReceivableItems: vi.fn(() => ({
    items: [
      { id: "22222222-2222-2222-2222-222222222222", name: "Tomato", unitSymbol: "kg" },
      { id: "33333333-3333-3333-3333-333333333333", name: "Milk", unitSymbol: "L" },
    ],
    isLoading: false,
  })),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "owner" },
  }),
}));

import { useSupplierPricesForPrefill } from "./hooks";

const mockedPrefill = vi.mocked(useSupplierPricesForPrefill);

const priceList = [
  {
    id: "44444444-4444-4444-4444-444444444444",
    supplierId: "11111111-1111-1111-1111-111111111111",
    itemId: "22222222-2222-2222-2222-222222222222",
    unitPrice: 32.5,
    currency: "INR",
    isPreferred: true,
    itemName: "Tomato",
    itemUnit: "kg",
    supplierName: "Fresh Farms",
    updatedAt: "2026-10-05T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrefill.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useSupplierPricesForPrefill>);
});

function renderDialog() {
  return render(<PurchaseOrderDialog onClose={vi.fn()} />);
}

describe("PurchaseOrderDialog", () => {
  it("validates before any network call", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    // Supplier required + lines required: inline errors appear, no mutation.
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("prefills line prices from the supplier price list", () => {
    mockedPrefill.mockReturnValue({
      data: priceList,
    } as unknown as ReturnType<typeof useSupplierPricesForPrefill>);
    renderDialog();

    // Select the supplier → prefill panel appears with the priced item.
    fireEvent.change(screen.getByLabelText(/supplier/i), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    const addBtn = screen.getByRole("button", { name: /tomato.*₹32\.50/i });
    fireEvent.click(addBtn);

    // The line is added with the prefilling price.
    expect(screen.getByDisplayValue("32.5")).toBeInTheDocument();
    // Total reflects qty 1 × ₹32.50.
    expect(screen.getByText(/total:.*₹32\.50/i)).toBeInTheDocument();
  });

  it("adds all priced items at once", () => {
    mockedPrefill.mockReturnValue({
      data: priceList,
    } as unknown as ReturnType<typeof useSupplierPricesForPrefill>);
    renderDialog();
    fireEvent.change(screen.getByLabelText(/supplier/i), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: /add all 1 priced items/i }));
    expect(screen.getByDisplayValue("32.5")).toBeInTheDocument();
  });

  it("submits the draft with lines via the RPC mutation", async () => {
    mockedPrefill.mockReturnValue({
      data: priceList,
    } as unknown as ReturnType<typeof useSupplierPricesForPrefill>);
    renderDialog();
    fireEvent.change(screen.getByLabelText(/supplier/i), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: /tomato.*₹32\.50/i }));
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    await vi.waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          supplierId: "11111111-1111-1111-1111-111111111111",
          lines: [
            expect.objectContaining({ itemId: "22222222-2222-2222-2222-222222222222", quantity: 1, unitPrice: 32.5 }),
          ],
        }),
        expect.anything(),
      );
    });
  });

  it("removes a line", () => {
    mockedPrefill.mockReturnValue({
      data: priceList,
    } as unknown as ReturnType<typeof useSupplierPricesForPrefill>);
    renderDialog();
    fireEvent.change(screen.getByLabelText(/supplier/i), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: /tomato.*₹32\.50/i }));
    expect(screen.getByDisplayValue("32.5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove tomato/i }));
    expect(screen.queryByDisplayValue("32.5")).not.toBeInTheDocument();
  });
});
