import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { ItemDetailPage } from "./ItemDetailPage";
import { useItem } from "@/features/items/hooks";
import {
  useCurrentStock,
  useItemBatches,
  useItemMovements,
  useStockRealtime,
} from "@/features/items/stockHooks";

vi.mock("@/features/items/hooks", () => ({ useItem: vi.fn() }));
vi.mock("@/features/items/stockHooks", () => ({
  LEDGER_PAGE_SIZE: 20,
  useCurrentStock: vi.fn(),
  useItemBatches: vi.fn(),
  useItemMovements: vi.fn(),
  useStockRealtime: vi.fn(),
}));
vi.mock("./OpeningBalanceDialog", () => ({
  OpeningBalanceDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Opening balance">
      <button type="button" onClick={onClose}>
        close mock dialog
      </button>
    </div>
  ),
}));

const mockedUseItem = vi.mocked(useItem);
const mockedUseCurrentStock = vi.mocked(useCurrentStock);
const mockedUseItemMovements = vi.mocked(useItemMovements);
const mockedUseItemBatches = vi.mocked(useItemBatches);
const mockedUseStockRealtime = vi.mocked(useStockRealtime);

const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const item = {
  id: ITEM_ID,
  name: "Tomato",
  categoryId: null,
  categoryName: "Vegetables",
  unitId: "unit-1",
  unitName: "kilogram",
  unitSymbol: "kg",
  storageLocationId: null,
  storageLocationName: "Cold Room",
  parLevel: 50,
  reorderPoint: 10,
  active: true,
  avgUnitCost: 32.5,
  createdAt: "",
  updatedAt: "",
};

const movement = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  itemId: ITEM_ID,
  movementType: "receipt",
  quantity: 10,
  batchNo: "B-1",
  expiryDate: "2026-12-31",
  unitCost: 30,
  reasonCode: null,
  referenceType: "ad_hoc",
  notes: null,
  createdBy: "user-1",
  createdAt: "2026-10-04T10:00:00Z",
} as const;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/items/${ITEM_ID}`]}>
          <Routes>
            <Route path="/items/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseItem.mockReturnValue({
    data: item,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useItem>);
  mockedUseCurrentStock.mockReturnValue({
    data: { itemId: ITEM_ID, quantity: 42.5, lastMovementAt: "2026-10-04T10:00:00Z" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCurrentStock>);
  mockedUseItemMovements.mockReturnValue({
    data: { movements: [movement], total: 25 },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useItemMovements>);
  mockedUseItemBatches.mockReturnValue({
    data: [
      {
        batchNo: "B-1",
        quantity: 42.5,
        earliestExpiry: "2026-12-31",
        lastMovementAt: "2026-10-04T10:00:00Z",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useItemBatches>);
});

describe("ItemDetailPage", () => {
  it("renders the header, stock, ledger and batches", () => {
    render(<ItemDetailPage />, { wrapper });
    expect(
      screen.getByRole("heading", { name: "Tomato" }),
    ).toBeInTheDocument();
    // Stock now section (42.5 also appears in the batch table — both are
    // expected; assert the figure inside the Stock now section).
    expect(screen.getByText("Stock now")).toBeInTheDocument();
    const stockSection = screen.getByText("Stock now").closest("section");
    expect(stockSection).toHaveTextContent("42.5");
    expect(stockSection).toHaveTextContent("kg");
    // Ledger section with the movement row.
    expect(screen.getByText("Ledger history")).toBeInTheDocument();
    expect(screen.getByText("Receipt")).toBeInTheDocument();
    // Batch B-1 appears once in the ledger row and once in the batch list.
    expect(screen.getAllByText("B-1")).toHaveLength(2);
    expect(screen.getByText(/Showing 1–20 of 25 movements/)).toBeInTheDocument();
    // Batches section.
    expect(screen.getByText("Batches")).toBeInTheDocument();
    // Realtime subscription is active for the item.
    expect(mockedUseStockRealtime).toHaveBeenCalledWith(ITEM_ID);
  });

  it("shows a low-stock badge when stock is at or below the reorder point", () => {
    mockedUseCurrentStock.mockReturnValue({
      data: { itemId: ITEM_ID, quantity: 10, lastMovementAt: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCurrentStock>);
    render(<ItemDetailPage />, { wrapper });
    expect(screen.getByText(/low stock/i)).toBeInTheDocument();
  });

  it("shows an empty ledger state when there are no movements", () => {
    mockedUseItemMovements.mockReturnValue({
      data: { movements: [], total: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useItemMovements>);
    mockedUseItemBatches.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useItemBatches>);
    render(<ItemDetailPage />, { wrapper });
    expect(screen.getByText(/no movements yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no batches tracked/i)).toBeInTheDocument();
  });

  it("paginates the ledger", async () => {
    const seenPages: number[] = [];
    mockedUseItemMovements.mockImplementation(
      (_id: string | null, page: number) => {
        seenPages.push(page);
        return {
          data: { movements: [movement], total: 45 },
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        } as unknown as ReturnType<typeof useItemMovements>;
      },
    );
    render(<ItemDetailPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(seenPages).toContain(2));
  });

  it("prettifies reason codes and flags expired batches", () => {
    mockedUseItemMovements.mockReturnValue({
      data: {
        movements: [{ ...movement, movementType: "wastage", quantity: -2, reasonCode: "over_prepared" }],
        total: 1,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useItemMovements>);
    mockedUseItemBatches.mockReturnValue({
      data: [
        { batchNo: "OLD", quantity: 1, earliestExpiry: "2020-01-01", lastMovementAt: "2020-01-02T00:00:00Z" },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useItemBatches>);
    render(<ItemDetailPage />, { wrapper });
    expect(screen.getByText("Wastage")).toBeInTheDocument();
    expect(screen.getByText("Over prepared")).toBeInTheDocument();
    const expired = screen.getByTitle("Expired");
    expect(expired).toHaveClass("text-red-700");
  });

  it("shows a not-found state for a deleted item", () => {
    mockedUseItem.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Cannot coerce the result to a single JSON object (0 rows)"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useItem>);
    render(<ItemDetailPage />, { wrapper });
    expect(screen.getByText("Item not found.")).toBeInTheDocument();
  });

  it("shows an error state with retry when loading fails", () => {
    const refetch = vi.fn();
    mockedUseItem.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      refetch,
    } as unknown as ReturnType<typeof useItem>);
    render(<ItemDetailPage />, { wrapper });
    expect(screen.getByText("Could not load this item.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("opens the opening-balance dialog from the Record actions", () => {
    render(<ItemDetailPage />, { wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: /opening balance/i }),
    );
    expect(
      screen.getByRole("dialog", { name: /opening balance/i }),
    ).toBeInTheDocument();
  });
});
