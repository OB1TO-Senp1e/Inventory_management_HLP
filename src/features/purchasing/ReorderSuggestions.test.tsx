import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReorderSuggestionGroup } from "@/api/purchasing";
import { ReorderSuggestions } from "./ReorderSuggestions";

// Hooks and API are mocked: these tests verify section states (loading /
// error / empty / populated) and the one-click PO creation with zero network.
vi.mock("./hooks", () => ({
  useReorderSuggestions: vi.fn(),
}));

vi.mock("@/api/purchasing", () => ({
  createPurchaseOrder: vi.fn(),
}));

vi.mock("@/components/toast/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { useReorderSuggestions } from "./hooks";
import { createPurchaseOrder } from "@/api/purchasing";

const mockedUseReorderSuggestions = vi.mocked(useReorderSuggestions);
const mockedCreatePurchaseOrder = vi.mocked(createPurchaseOrder);

const GROUP: ReorderSuggestionGroup = {
  supplierId: "sup-1",
  supplierName: "Fresh Farms",
  lines: [
    {
      itemId: "item-1",
      itemName: "Tomato",
      unitSymbol: "kg",
      currentQty: 5,
      reorderPoint: 10,
      parLevel: 50,
      suggestedQty: 45,
      unitPrice: 30,
      currency: "INR",
    },
  ],
};

const UNASSIGNED: ReorderSuggestionGroup = {
  supplierId: null,
  supplierName: "No preferred supplier",
  lines: [
    {
      itemId: "item-2",
      itemName: "Basil",
      unitSymbol: "kg",
      currentQty: 1,
      reorderPoint: 5,
      parLevel: 20,
      suggestedQty: 19,
      unitPrice: null,
      currency: "INR",
    },
  ],
};

function renderSection() {
  return render(
    <MemoryRouter>
      <ReorderSuggestions />
    </MemoryRouter>,
  );
}

describe("ReorderSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedUseReorderSuggestions.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    renderSection();
    expect(screen.getByLabelText(/loading reorder suggestions/i)).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    const refetch = vi.fn();
    mockedUseReorderSuggestions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never);
    renderSection();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load reorder suggestions/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows an empty state when nothing needs reordering", () => {
    mockedUseReorderSuggestions.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    renderSection();
    expect(screen.getByText(/nothing needs reordering/i)).toBeInTheDocument();
  });

  it("renders supplier groups with lines and one-click PO buttons", () => {
    mockedUseReorderSuggestions.mockReturnValue({
      data: [GROUP, UNASSIGNED],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    renderSection();
    expect(screen.getByText("Fresh Farms")).toBeInTheDocument();
    expect(screen.getByText("Tomato")).toBeInTheDocument();
    expect(screen.getByText(/order 45 kg/i)).toBeInTheDocument();
    // Unassigned group has no create button.
    expect(screen.getByText("No preferred supplier")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create draft po \(1 item\)/i }),
    ).toBeInTheDocument();
  });

  it("one click creates a draft PO with correct lines and navigates to it", async () => {
    mockedUseReorderSuggestions.mockReturnValue({
      data: [GROUP],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    mockedCreatePurchaseOrder.mockResolvedValue("po-new-id");
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /create draft po/i }));
    await waitFor(() => {
      expect(mockedCreatePurchaseOrder).toHaveBeenCalledWith({
        supplierId: "sup-1",
        lines: [{ itemId: "item-1", quantity: 45, unitPrice: 30 }],
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-new-id");
  });
});
