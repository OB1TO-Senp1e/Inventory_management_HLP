import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  clearSyncQueue,
  enqueueSyncEntry,
  getPendingSyncEntries,
  getSyncEntries,
  markSyncEntryFailed,
  markSyncEntryPending,
  markSyncEntrySyncing,
  removeSyncEntry,
  resetSyncEntryForRetry,
  subscribeSyncQueue,
} from "./queue";

const RESTAURANT_ID = "restaurant-1";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const WASTAGE_PAYLOAD = {
  itemId: ITEM_ID,
  quantity: 2,
  reason: "spoiled",
} as const;

function enqueueWastage(restaurantId: string = RESTAURANT_ID) {
  return enqueueSyncEntry({ type: "wastage", restaurantId, payload: WASTAGE_PAYLOAD });
}

beforeEach(() => {
  clearSyncQueue();
  vi.clearAllMocks();
});

describe("enqueueSyncEntry", () => {
  it("stamps id, timestamps, and pending status", () => {
    const entry = enqueueWastage();
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(0);
    expect(entry.error).toBeNull();
    expect(entry.nextRetryAt).toBeNull();
    expect(entry.restaurantId).toBe(RESTAURANT_ID);
    expect(entry.payload).toEqual(WASTAGE_PAYLOAD);
  });

  it("persists entries across reads (localStorage round-trip)", () => {
    const entry = enqueueWastage();
    const entries = getSyncEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(entry.id);
  });

  it("rejects payloads the online forms would reject", () => {
    expect(() =>
      enqueueSyncEntry({
        type: "wastage",
        restaurantId: RESTAURANT_ID,
        payload: { itemId: ITEM_ID, quantity: -5, reason: "spoiled" },
      }),
    ).toThrow();
    expect(getSyncEntries()).toHaveLength(0);
  });

  it("rejects a type/payload mismatch", () => {
    expect(() =>
      enqueueSyncEntry({
        type: "usage",
        restaurantId: RESTAURANT_ID,
        payload: WASTAGE_PAYLOAD,
      }),
    ).toThrow();
  });

  it("notifies subscribers on enqueue", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSyncQueue(listener);
    enqueueWastage();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    enqueueWastage();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("drops corrupt stored entries instead of failing", () => {
    localStorage.setItem(
      "ri.offlineQueue.v1",
      JSON.stringify([{ id: "not-a-valid-entry" }]),
    );
    expect(getSyncEntries()).toEqual([]);
  });
});

describe("entry lifecycle", () => {
  it("marks entries syncing, then removes them on success", () => {
    const entry = enqueueWastage();
    markSyncEntrySyncing(entry.id);
    expect(getSyncEntries()[0].status).toBe("syncing");
    removeSyncEntry(entry.id);
    expect(getSyncEntries()).toHaveLength(0);
  });

  it("marks failed entries with the error text and a backoff window", () => {
    const entry = enqueueWastage();
    markSyncEntryFailed(entry.id, "Item is archived");
    const [failed] = getSyncEntries();
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Item is archived");
    expect(failed.attempts).toBe(1);
    expect(failed.nextRetryAt).not.toBeNull();
    // Still inside the backoff window — not eligible for a drain pass.
    expect(getPendingSyncEntries()).toHaveLength(0);
    // After the window elapses it becomes eligible again.
    const after = new Date(Date.now() + backoffDelayMs(1) + 1000);
    expect(getPendingSyncEntries(after)).toHaveLength(1);
  });

  it("increases the backoff with each attempt", () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(10)).toBe(600_000);
  });

  it("returns a network-dropped entry to pending with no error", () => {
    const entry = enqueueWastage();
    markSyncEntrySyncing(entry.id);
    markSyncEntryPending(entry.id);
    const [pending] = getSyncEntries();
    expect(pending.status).toBe("pending");
    expect(pending.error).toBeNull();
    expect(getPendingSyncEntries()).toHaveLength(1);
  });

  it("resetSyncEntryForRetry clears the backoff for an explicit retry", () => {
    const entry = enqueueWastage();
    markSyncEntryFailed(entry.id, "boom");
    resetSyncEntryForRetry(entry.id);
    const [retried] = getSyncEntries();
    expect(retried.status).toBe("pending");
    expect(retried.error).toBeNull();
    expect(retried.nextRetryAt).toBeNull();
    expect(getPendingSyncEntries()).toHaveLength(1);
  });

  it("returns entries oldest-first", () => {
    const first = enqueueWastage();
    const second = enqueueWastage();
    const entries = getSyncEntries();
    expect(entries.map((e) => e.id)).toEqual([first.id, second.id]);
  });
});
