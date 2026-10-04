import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { listReceivableItems, receiveGoods } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { useReceivableItems, useReceiveGoods } from "./hooks";

// The API modules are mocked: these tests verify hook wiring (delegation,
// gating, invalidation, toasts) with zero network.
vi.mock("@/api/stock", () => ({
  listReceivableItems: vi.fn(),
  receiveGoods: vi.fn(),
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    } as { id: string; restaurantId: string; role: "owner" } | null,
  },
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ profile: authState.profile }),
}));

const mockedReceiveGoods = vi.mocked(receiveGoods);
const mockedListReceivableItems = vi.mocked(listReceivableItems);

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
  mockedListReceivableItems.mockResolvedValue([]);
});

describe("useReceivableItems", () => {
  it("delegates to listReceivableItems (narrow id/name/unit picker rows)", async () => {
    mockedListReceivableItems.mockResolvedValue([
      { id: ITEM_ID, name: "Rice", unitSymbol: "kg" },
    ]);
    const { result } = renderHook(() => useReceivableItems(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockedListReceivableItems).toHaveBeenCalledWith();
    expect(result.current.items).toEqual([
      { id: ITEM_ID, name: "Rice", unitSymbol: "kg" },
    ]);
  });

  it("does not query without a restaurant profile", () => {
    authState.profile = null;
    renderHook(() => useReceivableItems(), { wrapper });
    expect(mockedListReceivableItems).not.toHaveBeenCalled();
  });
});

describe("useReceiveGoods", () => {
  const input = {
    lines: [{ itemId: ITEM_ID, quantity: 10, unitCost: 40 }],
  };
  const rpcResult = {
    lines: [
      {
        movementId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        itemId: ITEM_ID,
        quantity: 10,
        unitCost: 40,
        oldAvgCost: 0,
        newAvgCost: 40,
      },
    ],
  };

  it("delegates to the api and invalidates items + stock on success", async () => {
    mockedReceiveGoods.mockResolvedValue(rpcResult);
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { result } = renderHook(() => useReceiveGoods(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedReceiveGoods).toHaveBeenCalledWith(input);
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: itemsQueryKey }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: stockQueryKey }),
    );
    await screen.findByText(/receipt posted: 1 line/i);
    invalidateSpy.mockRestore();
  });

  it("toasts the RPC error message on failure", async () => {
    mockedReceiveGoods.mockRejectedValue(
      new Error("receive_goods: line 1: quantity must be greater than zero"),
    );
    const { result } = renderHook(() => useReceiveGoods(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    await screen.findByText(/quantity must be greater than zero/i);
  });
});
