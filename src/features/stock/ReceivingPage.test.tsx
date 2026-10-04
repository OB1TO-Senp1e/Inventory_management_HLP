import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { ReceivingPage } from "./ReceivingPage";
import { useReceivableItems, useReceiveGoods } from "./hooks";

vi.mock("./hooks", () => ({
  useReceivableItems: vi.fn(),
  useReceiveGoods: vi.fn(),
}));

const mockedUseReceivableItems = vi.mocked(useReceivableItems);
const mockedUseReceiveGoods = vi.mocked(useReceiveGoods);

const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MOVEMENT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const items = [
  {
    id: ITEM_ID,
    name: "Rice",
    categoryId: null,
    categoryName: null,
    unitId: "unit-1",
    unitName: "kilogram",
    unitSymbol: "kg",
    storageLocationId: null,
    storageLocationName: null,
    parLevel: 10,
    reorderPoint: 4,
    active: true,
    avgUnitCost: 40,
    createdAt: "",
    updatedAt: "",
  },
];

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseReceivableItems.mockReturnValue({
    items,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockedUseReceiveGoods.mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useReceiveGoods>);
});

describe("ReceivingPage", () => {
  it("renders the receipt form with one line", () => {
    render(<ReceivingPage />, { wrapper });
    expect(
      screen.getByRole("heading", { name: "Receiving" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Line 1", { exact: false })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add line/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /post receipt/i }),
    ).toBeInTheDocument();
  });

  it("shows inline validation errors on empty submit", async () => {
    render(<ReceivingPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /post receipt/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("adds and removes lines", async () => {
    render(<ReceivingPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    await waitFor(() => {
      expect(screen.getByText("Line 2", { exact: false })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /remove line 2/i }));
    await waitFor(() => {
      expect(screen.queryByText("Line 2", { exact: false })).not.toBeInTheDocument();
    });
  });

  it("does not allow removing the last line", () => {
    render(<ReceivingPage />, { wrapper });
    expect(
      screen.getByRole("button", { name: /remove line 1/i }),
    ).toBeDisabled();
  });

  it("posts the receipt and shows the avg-cost report on success", async () => {
    mutate.mockImplementation((_input, options) => {
      options?.onSuccess?.(
        {
          lines: [
            {
              movementId: MOVEMENT_ID,
              itemId: ITEM_ID,
              quantity: 10,
              unitCost: 50,
              oldAvgCost: 40,
              newAvgCost: 45,
            },
          ],
        },
        _input,
        undefined,
      );
    });
    render(<ReceivingPage />, { wrapper });

    fireEvent.change(screen.getByLabelText("Item"), {
      target: { value: ITEM_ID },
    });
    fireEvent.change(screen.getByLabelText(/quantity \(kg\)/i), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText(/unit cost/i), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /post receipt/i }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [
            expect.objectContaining({
              itemId: ITEM_ID,
              quantity: 10,
              unitCost: 50,
            }),
          ],
        }),
        expect.anything(),
      );
    });
    await screen.findByText(/receipt posted to the stock ledger/i);
    // Old → new average cost from the RPC result, never recomputed.
    expect(screen.getByText(/₹40\.00/)).toBeInTheDocument();
    expect(screen.getByText(/₹45\.00/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new receipt/i }),
    ).toBeInTheDocument();
  });

  it("shows a loading state while items load", () => {
    mockedUseReceivableItems.mockReturnValue({
      items: [],
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<ReceivingPage />, { wrapper });
    expect(screen.getByLabelText(/loading items/i)).toBeInTheDocument();
  });

  it("shows an error state with retry when items fail to load", () => {
    const refetch = vi.fn();
    mockedUseReceivableItems.mockReturnValue({
      items: [],
      isLoading: false,
      isError: true,
      refetch,
    });
    render(<ReceivingPage />, { wrapper });
    expect(screen.getByText(/couldn't load items/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
