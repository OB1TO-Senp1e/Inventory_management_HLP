import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logUsage, logWastage, receiveGoods } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import { drainSyncQueue, replaySyncEntry } from "./engine";
import {
  clearSyncQueue,
  enqueueSyncEntry,
  getSyncEntries,
  markSyncEntryFailed,
} from "./queue";

vi.mock("@/api/stock", () => ({
  logWastage: vi.fn(),
  logUsage: vi.fn(),
  receiveGoods: vi.fn(),
}));

const mockedLogWastage = vi.mocked(logWastage);
const mockedLogUsage = vi.mocked(logUsage);
const mockedReceiveGoods = vi.mocked(receiveGoods);

const RESTAURANT_ID = "restaurant-1";
const OTHER_RESTAURANT_ID = "restaurant-2";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function wastageEntry(restaurantId: string = RESTAURANT_ID) {
  return enqueueSyncEntry({
    type: "wastage",
    restaurantId,
    payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
  });
}

function usageEntry() {
  return enqueueSyncEntry({
    type: "usage",
    restaurantId: RESTAURANT_ID,
    payload: { itemId: ITEM_ID, quantity: 1, reason: "kitchen_use" },
  });
}

let queryClient: QueryClient;

function deps(overrides: Partial<Parameters<typeof drainSyncQueue>[0]> = {}) {
  return {
    queryClient,
    restaurantId: RESTAURANT_ID,
    outletId: "outlet-a",
    ...overrides,
  };
}

beforeEach(() => {
  clearSyncQueue();
  vi.clearAllMocks();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mockedLogWastage.mockResolvedValue({ movementId: "m1" });
  mockedLogUsage.mockResolvedValue({ movementId: "m2" });
  mockedReceiveGoods.mockResolvedValue({ lines: [] });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe("replaySyncEntry", () => {
  it("dispatches to the right api function per type", async () => {
    const wastage = wastageEntry();
    const usage = usageEntry();
    const receiving = enqueueSyncEntry({
      type: "receiving",
      restaurantId: RESTAURANT_ID,
      payload: { lines: [{ itemId: ITEM_ID, quantity: 5, unitCost: 10 }] },
    });
    await replaySyncEntry(wastage);
    await replaySyncEntry(usage);
    await replaySyncEntry(receiving);
    expect(mockedLogWastage).toHaveBeenCalledWith(wastage.payload);
    expect(mockedLogUsage).toHaveBeenCalledWith(usage.payload);
    expect(mockedReceiveGoods).toHaveBeenCalledWith(receiving.payload);
  });
});

describe("drainSyncQueue", () => {
  it("replays pending entries, removes them, and invalidates stock queries", async () => {
    wastageEntry();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const onSynced = vi.fn();
    const result = await drainSyncQueue(deps({ onSynced }));
    expect(result).toEqual({ attempted: 1, synced: 1, failed: 0, stoppedOffline: false });
    expect(getSyncEntries()).toHaveLength(0);
    expect(mockedLogWastage).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: stockQueryKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: itemsQueryKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: recipesQueryKey });
    expect(onSynced).toHaveBeenCalledWith(1);
  });

  it("marks server errors failed, keeps the entry, and continues", async () => {
    const bad = wastageEntry();
    const good = usageEntry();
    mockedLogWastage.mockRejectedValueOnce(new Error("Item is archived"));
    const onFailed = vi.fn();
    const result = await drainSyncQueue(deps({ onFailed }));
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockedLogUsage).toHaveBeenCalledTimes(1);
    const [remaining] = getSyncEntries();
    expect(remaining.id).toBe(bad.id);
    expect(remaining.status).toBe("failed");
    expect(remaining.error).toBe("Item is archived");
    expect(good.id).not.toBe(remaining.id);
    expect(onFailed).toHaveBeenCalledWith(1);
  });

  it("stops the drain on a network drop and returns the entry to pending", async () => {
    const first = wastageEntry();
    const second = usageEntry();
    mockedLogWastage.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await drainSyncQueue(deps());
    expect(result.stoppedOffline).toBe(true);
    expect(result.synced).toBe(0);
    // The dropped entry is pending again with no error; the rest of the
    // queue is untouched for the next pass.
    expect(getSyncEntries().find((e) => e.id === first.id)?.status).toBe("pending");
    expect(getSyncEntries().find((e) => e.id === first.id)?.error).toBeNull();
    expect(getSyncEntries().find((e) => e.id === second.id)?.status).toBe("pending");
    expect(mockedLogUsage).not.toHaveBeenCalled();
  });

  it("only drains the current restaurant's entries", async () => {
    wastageEntry(OTHER_RESTAURANT_ID);
    const mine = wastageEntry(RESTAURANT_ID);
    const result = await drainSyncQueue(deps());
    expect(result.synced).toBe(1);
    expect(mockedLogWastage).toHaveBeenCalledWith(mine.payload);
    expect(getSyncEntries()).toHaveLength(1);
  });

  it("does nothing while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    wastageEntry();
    const result = await drainSyncQueue(deps());
    expect(result.attempted).toBe(0);
    expect(mockedLogWastage).not.toHaveBeenCalled();
    expect(getSyncEntries()).toHaveLength(1);
  });

  it("does nothing without a restaurant", async () => {
    wastageEntry();
    const result = await drainSyncQueue(deps({ restaurantId: null }));
    expect(result.attempted).toBe(0);
    expect(mockedLogWastage).not.toHaveBeenCalled();
  });

  it("skips failed entries still inside their backoff window", async () => {
    const entry = wastageEntry();
    markSyncEntryFailed(entry.id, "boom");
    const result = await drainSyncQueue(deps());
    expect(result.attempted).toBe(0);
    expect(mockedLogWastage).not.toHaveBeenCalled();
  });
});
