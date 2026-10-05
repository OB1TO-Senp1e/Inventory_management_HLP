import { describe, expect, it, vi, beforeEach } from "vitest";
import { drainSyncQueue } from "./engine";
import {
  clearSyncQueue,
  enqueueSyncEntry,
  getSyncEntries,
} from "./queue";

/**
 * V2-07: outlet-aware replay. Entries queued under outlet A must not
 * silently post to outlet B when the user switches outlets while offline —
 * they become visible conflicts (failed with a clear message).
 */

vi.mock("./offline", () => ({
  isOnline: () => true,
}));

vi.mock("@/api/stock", () => ({
  logWastage: vi.fn().mockResolvedValue(undefined),
  logUsage: vi.fn().mockResolvedValue(undefined),
  receiveGoods: vi.fn().mockResolvedValue({}),
}));

function queueWastage(outletId: string | null) {
  return enqueueSyncEntry({
    type: "wastage",
    restaurantId: "r1",
    outletId,
    payload: {
      itemId: "b0000000-0000-0000-0000-000000000001",
      quantity: 1,
      reason: "spoiled",
    },
  });
}

const baseDeps = {
  queryClient: { invalidateQueries: vi.fn() } as never,
  restaurantId: "r1",
  outletId: "outlet-a",
};

describe("drainSyncQueue outlet check", () => {
  beforeEach(() => {
    clearSyncQueue();
    vi.clearAllMocks();
  });

  it("replays entries queued under the current outlet", async () => {
    queueWastage("outlet-a");
    const result = await drainSyncQueue(baseDeps);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(getSyncEntries()).toHaveLength(0);
  });

  it("marks entries from another outlet as failed conflicts", async () => {
    queueWastage("outlet-b");
    const result = await drainSyncQueue(baseDeps);
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    const [kept] = getSyncEntries();
    expect(kept.status).toBe("failed");
    expect(kept.error).toMatch(/different outlet/i);
  });

  it("replays pre-V2-07 entries without an outlet tag", async () => {
    queueWastage(null);
    const result = await drainSyncQueue(baseDeps);
    expect(result.synced).toBe(1);
  });
});
