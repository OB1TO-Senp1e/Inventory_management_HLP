import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSyncQueue,
  enqueueSyncEntry,
  markSyncEntryFailed,
} from "./queue";
import { useSyncStatus } from "./useSyncStatus";

const RESTAURANT_ID = "restaurant-1";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  clearSyncQueue();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

describe("useSyncStatus", () => {
  it("starts empty and online", () => {
    const { result } = renderHook(() => useSyncStatus());
    expect(result.current.entries).toEqual([]);
    expect(result.current.pending).toBe(0);
    expect(result.current.failed).toBe(0);
    expect(result.current.isOnline).toBe(true);
  });

  it("reflects enqueued entries", () => {
    const { result } = renderHook(() => useSyncStatus());
    act(() => {
      enqueueSyncEntry({
        type: "wastage",
        restaurantId: RESTAURANT_ID,
        payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
      });
    });
    expect(result.current.pending).toBe(1);
    expect(result.current.entries).toHaveLength(1);
  });

  it("counts failed entries separately", () => {
    const { result } = renderHook(() => useSyncStatus());
    act(() => {
      const entry = enqueueSyncEntry({
        type: "usage",
        restaurantId: RESTAURANT_ID,
        payload: { itemId: ITEM_ID, quantity: 1, reason: "kitchen_use" },
      });
      markSyncEntryFailed(entry.id, "Item is archived");
    });
    expect(result.current.pending).toBe(0);
    expect(result.current.failed).toBe(1);
  });
});
