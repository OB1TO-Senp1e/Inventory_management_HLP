import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { createOpeningBalance, getCurrentStock, listBatches, listMovements, listStockOverview, subscribeToItemMovements, subscribeToStockMovements } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import {
  LEDGER_PAGE_SIZE,
  stockQueryKey,
  useCreateOpeningBalance,
  useCurrentStock,
  useItemBatches,
  useItemMovements,
  useStockOverview,
  useStockOverviewRealtime,
  useStockRealtime,
} from "./stockHooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// gating, invalidation, toasts) with zero network.
vi.mock("@/api/stock", () => ({
  createOpeningBalance: vi.fn(),
  getCurrentStock: vi.fn(),
  listBatches: vi.fn(),
  listMovements: vi.fn(),
  listStockOverview: vi.fn(),
  subscribeToItemMovements: vi.fn(),
  subscribeToStockMovements: vi.fn(),
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

const mockedGetCurrentStock = vi.mocked(getCurrentStock);
const mockedCreateOpeningBalance = vi.mocked(createOpeningBalance);
const mockedListMovements = vi.mocked(listMovements);
const mockedListBatches = vi.mocked(listBatches);
const mockedSubscribeToItemMovements = vi.mocked(subscribeToItemMovements);
const mockedListStockOverview = vi.mocked(listStockOverview);
const mockedSubscribeToStockMovements = vi.mocked(subscribeToStockMovements);

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

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("useCurrentStock", () => {
  it("delegates to getCurrentStock when profile and item id are present", async () => {
    mockedGetCurrentStock.mockResolvedValue({
      itemId: "item-1",
      quantity: 65,
      lastMovementAt: null,
    });
    const { result } = renderHook(() => useCurrentStock("item-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetCurrentStock).toHaveBeenCalledWith({ itemId: "item-1" });
    expect(result.current.data?.quantity).toBe(65);
  });

  it("stays disabled without a profile", () => {
    authState.profile = null;
    const { result } = renderHook(() => useCurrentStock("item-1"), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetCurrentStock).not.toHaveBeenCalled();
  });

  it("stays disabled without an item id", () => {
    const { result } = renderHook(() => useCurrentStock(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetCurrentStock).not.toHaveBeenCalled();
  });
});

describe("useCreateOpeningBalance", () => {
  it("posts via the API, invalidates items+stock, and toasts success", async () => {
    mockedCreateOpeningBalance.mockResolvedValue({ movementId: "m-1" });
    const invalidateSpy = vi.fn();
    const { result } = renderHook(() => useCreateOpeningBalance(), {
      wrapper,
    });
    // Spy after the client exists inside the wrapper closure.
    const client = queryClient;
    const origInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = vi.fn((...args: unknown[]) => {
      invalidateSpy(...args);
      return origInvalidate(
        ...(args as Parameters<typeof origInvalidate>),
      );
    });

    result.current.mutate({ itemId: "item-1", quantity: 10, unitCost: 5 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedCreateOpeningBalance).toHaveBeenCalledWith({
      itemId: "item-1",
      quantity: 10,
      unitCost: 5,
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: itemsQueryKey }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: stockQueryKey }),
    );
    await screen.findByText("Opening balance posted.");
  });

  it("toasts the error message on failure", async () => {
    mockedCreateOpeningBalance.mockRejectedValue(
      new Error("create_opening_balance: quantity must be greater than zero."),
    );
    const { result } = renderHook(() => useCreateOpeningBalance(), {
      wrapper,
    });
    result.current.mutate({ itemId: "item-1", quantity: 10, unitCost: 5 });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await screen.findByText(/quantity must be greater than zero/);
  });
});

const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("useItemMovements", () => {
  it("delegates to listMovements with the page and page size", async () => {
    mockedListMovements.mockResolvedValue({ movements: [], total: 0 });
    const { result } = renderHook(() => useItemMovements(ITEM_ID, 2), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockedListMovements).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      page: 2,
      pageSize: LEDGER_PAGE_SIZE,
    });
    expect(result.current.data).toEqual({ movements: [], total: 0 });
  });

  it("does not query without an item id or restaurant profile", () => {
    renderHook(() => useItemMovements(null, 1), { wrapper });
    expect(mockedListMovements).not.toHaveBeenCalled();
    authState.profile = null;
    renderHook(() => useItemMovements(ITEM_ID, 1), { wrapper });
    expect(mockedListMovements).not.toHaveBeenCalled();
  });
});

describe("useItemBatches", () => {
  it("delegates to listBatches", async () => {
    mockedListBatches.mockResolvedValue([]);
    const { result } = renderHook(() => useItemBatches(ITEM_ID), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockedListBatches).toHaveBeenCalledWith({ itemId: ITEM_ID });
  });

  it("does not query without an item id", () => {
    renderHook(() => useItemBatches(null), { wrapper });
    expect(mockedListBatches).not.toHaveBeenCalled();
  });
});

describe("useStockRealtime", () => {
  it("subscribes on mount and invalidates stock queries on new movements", async () => {
    const movementCallbacks: Array<() => void> = [];
    mockedSubscribeToItemMovements.mockImplementation((_id, cb) => {
      movementCallbacks.push(cb);
      return vi.fn();
    });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderHook(() => useStockRealtime(ITEM_ID), { wrapper });
    expect(mockedSubscribeToItemMovements).toHaveBeenCalledWith(
      ITEM_ID,
      expect.any(Function),
    );
    // A new ledger insert invalidates current stock, ledger and batches.
    movementCallbacks[0]?.();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [...stockQueryKey, "current", ITEM_ID],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...stockQueryKey, "movements", ITEM_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...stockQueryKey, "batches", ITEM_ID],
    });
    invalidateSpy.mockRestore();
  });

  it("unsubscribes on unmount", () => {
    const unsubscribe = vi.fn();
    mockedSubscribeToItemMovements.mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useStockRealtime(ITEM_ID), {
      wrapper,
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an item id or restaurant profile", () => {
    renderHook(() => useStockRealtime(null), { wrapper });
    expect(mockedSubscribeToItemMovements).not.toHaveBeenCalled();
    authState.profile = null;
    renderHook(() => useStockRealtime(ITEM_ID), { wrapper });
    expect(mockedSubscribeToItemMovements).not.toHaveBeenCalled();
  });

  it("survives a subscription failure (realtime is best-effort)", () => {
    mockedSubscribeToItemMovements.mockImplementation(() => {
      throw new Error("no supabase config");
    });
    expect(() =>
      renderHook(() => useStockRealtime(ITEM_ID), { wrapper }),
    ).not.toThrow();
  });
});

describe("useStockOverview", () => {
  it("delegates to listStockOverview and is disabled without a profile", async () => {
    mockedListStockOverview.mockResolvedValue([]);
    const { result } = renderHook(() => useStockOverview(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListStockOverview).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([]);

    authState.profile = null;
    mockedListStockOverview.mockClear();
    renderHook(() => useStockOverview(), { wrapper });
    expect(mockedListStockOverview).not.toHaveBeenCalled();
  });
});

describe("useStockOverviewRealtime", () => {
  it("subscribes on mount and invalidates the overview on new movements", async () => {
    const movementCallbacks: Array<() => void> = [];
    mockedSubscribeToStockMovements.mockImplementation((cb) => {
      movementCallbacks.push(cb);
      return vi.fn();
    });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderHook(() => useStockOverviewRealtime(), { wrapper });
    expect(mockedSubscribeToStockMovements).toHaveBeenCalledWith(
      expect.any(Function),
    );
    movementCallbacks[0]?.();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [...stockQueryKey, "overview"],
      }),
    );
    invalidateSpy.mockRestore();
  });

  it("unsubscribes on unmount and survives subscription failure", () => {
    const unsubscribe = vi.fn();
    mockedSubscribeToStockMovements.mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useStockOverviewRealtime(), {
      wrapper,
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    mockedSubscribeToStockMovements.mockImplementation(() => {
      throw new Error("no supabase config");
    });
    expect(() => renderHook(() => useStockOverviewRealtime(), { wrapper })).not.toThrow();
  });

  it("does nothing without a restaurant profile", () => {
    authState.profile = null;
    renderHook(() => useStockOverviewRealtime(), { wrapper });
    expect(mockedSubscribeToStockMovements).not.toHaveBeenCalled();
  });
});
