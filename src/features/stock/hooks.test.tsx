import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { listReceivableItems, logUsage, logWastage, receiveGoods } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import { useLogUsage, useLogWastage, useReceivableItems, useReceiveGoods } from "./hooks";
import { clearSyncQueue, getSyncEntries } from "@/features/sync/queue";
import { isQueuedSubmission } from "@/features/sync/types";

// The API modules are mocked: these tests verify hook wiring (delegation,
// gating, invalidation, toasts) with zero network.
vi.mock("@/api/stock", () => ({
  listReceivableItems: vi.fn(),
  logUsage: vi.fn(),
  logWastage: vi.fn(),
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
const mockedLogWastage = vi.mocked(logWastage);
const mockedLogUsage = vi.mocked(logUsage);

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
    // Receiving recalculates avg_unit_cost → recipe costs (P4-02) refresh.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: recipesQueryKey }),
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

describe("useLogWastage", () => {
  const input = { itemId: ITEM_ID, quantity: 5, reason: "spoiled" as const };

  it("delegates to the api and invalidates stock + items on success", async () => {
    mockedLogWastage.mockResolvedValue({ movementId: "dddddddd-dddd-dddd-dddd-dddddddddddd" });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { result } = renderHook(() => useLogWastage(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedLogWastage).toHaveBeenCalledWith(input);
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: stockQueryKey }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: itemsQueryKey }),
    );
    await screen.findByText(/wastage logged/i);
    invalidateSpy.mockRestore();
  });

  it("toasts the RPC error message on failure", async () => {
    mockedLogWastage.mockRejectedValue(new Error("log_wastage: a reason is required."));
    const { result } = renderHook(() => useLogWastage(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    await screen.findByText(/a reason is required/i);
  });
});

describe("useLogUsage", () => {
  const input = { itemId: ITEM_ID, quantity: 2, reason: "kitchen_use" as const };

  it("delegates to the api and invalidates stock + items on success", async () => {
    mockedLogUsage.mockResolvedValue({ movementId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { result } = renderHook(() => useLogUsage(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedLogUsage).toHaveBeenCalledWith(input);
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: stockQueryKey }),
    );
    await screen.findByText(/usage logged/i);
    invalidateSpy.mockRestore();
  });

  it("toasts the RPC error message on failure", async () => {
    mockedLogUsage.mockRejectedValue(
      new Error("log_usage: quantity must be greater than zero (got 0)."),
    );
    const { result } = renderHook(() => useLogUsage(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    await screen.findByText(/greater than zero/i);
  });
});

describe("offline queue (P6-02)", () => {
  const wastageInput = { itemId: ITEM_ID, quantity: 5, reason: "spoiled" as const };
  const usageInput = { itemId: ITEM_ID, quantity: 2, reason: "kitchen_use" as const };
  const receiptInput = {
    lines: [{ itemId: ITEM_ID, quantity: 10, unitCost: 40 }],
  };

  beforeEach(() => {
    clearSyncQueue();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  it("queues wastage offline without calling the api", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useLogWastage(), { wrapper });
    result.current.mutate(wastageInput);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedLogWastage).not.toHaveBeenCalled();
    expect(isQueuedSubmission(result.current.data)).toBe(true);
    const entries = getSyncEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("wastage");
    expect(entries[0].payload).toEqual(wastageInput);
    await screen.findByText(/wastage queued/i);
  });

  it("queues usage offline without calling the api", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useLogUsage(), { wrapper });
    result.current.mutate(usageInput);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedLogUsage).not.toHaveBeenCalled();
    expect(isQueuedSubmission(result.current.data)).toBe(true);
    expect(getSyncEntries()).toHaveLength(1);
    await screen.findByText(/usage queued/i);
  });

  it("queues a receipt offline without calling the api", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useReceiveGoods(), { wrapper });
    result.current.mutate(receiptInput);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedReceiveGoods).not.toHaveBeenCalled();
    expect(isQueuedSubmission(result.current.data)).toBe(true);
    const entries = getSyncEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("receiving");
    await screen.findByText(/receipt queued/i);
  });

  it("queues the submission when the RPC call fails with a network error", async () => {
    mockedLogWastage.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useLogWastage(), { wrapper });
    result.current.mutate(wastageInput);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(isQueuedSubmission(result.current.data)).toBe(true);
    expect(getSyncEntries()).toHaveLength(1);
  });

  it("does NOT queue server rejections (they stay errors)", async () => {
    mockedLogWastage.mockRejectedValue(new Error("Item is archived"));
    const { result } = renderHook(() => useLogWastage(), { wrapper });
    result.current.mutate(wastageInput);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getSyncEntries()).toHaveLength(0);
  });
});
