import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createNotification,
  deleteNotification,
  getAlertPreferences,
  listExpiringBatches,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateAlertPreferences,
} from "./notifications";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number;
}

/**
 * Thenable chainable mock: every builder method returns the builder itself
 * and awaiting it resolves the canned result.
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "not",
    "is",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) =>
    resolve(result);
  return builder;
}

const mockFrom = vi.fn();

const NOTIF_ROW = {
  id: "c0000000-0000-0000-0000-000000000001",
  type: "low_stock",
  title: "Milk is running low",
  body: "3 L left (reorder at 10 L)",
  item_id: "b0000000-0000-0000-0000-000000000002",
  batch_no: null,
  outlet_id: "c0000000-0000-0000-0000-000000000011",
  read_at: null,
  created_at: "2026-10-05T08:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
  } as unknown as SupabaseClient);
});

describe("listNotifications", () => {
  it("maps rows to the Notification shape", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [NOTIF_ROW], error: null }));
    const list = await listNotifications();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: NOTIF_ROW.id,
      type: "low_stock",
      itemId: NOTIF_ROW.item_id,
      batchNo: null,
      readAt: null,
    });
    expect(mockFrom).toHaveBeenCalledWith("notifications");
  });

  it("throws on backend errors", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: null, error: { message: "boom" } }),
    );
    await expect(listNotifications()).rejects.toThrow("boom");
  });
});

describe("markNotificationRead / markAllNotificationsRead", () => {
  it("marks one notification read", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [], error: null }));
    await markNotificationRead(NOTIF_ROW.id);
    const builder = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(builder["eq"]).toHaveBeenCalledWith("id", NOTIF_ROW.id);
  });

  it("rejects a non-uuid id", async () => {
    await expect(markNotificationRead("nope")).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("marks all read without an id filter", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [], error: null }));
    await markAllNotificationsRead();
    const builder = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(builder["eq"]).not.toHaveBeenCalled();
  });
});

describe("createNotification", () => {
  it("inserts and maps the created row", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: NOTIF_ROW, error: null }));
    const created = await createNotification({
      type: "low_stock",
      title: "Milk is running low",
      body: "3 L left",
      itemId: NOTIF_ROW.item_id,
      batchNo: null,
    });
    expect(created?.id).toBe(NOTIF_ROW.id);
  });

  it("returns null on a dedupe unique violation (23505)", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({
        data: null,
        error: { code: "23505", message: "duplicate" },
      }),
    );
    const created = await createNotification({
      type: "low_stock",
      title: "dup",
      itemId: NOTIF_ROW.item_id,
      batchNo: null,
    });
    expect(created).toBeNull();
  });

  it("rethrows non-dedupe errors", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: null, error: { message: "rls" } }),
    );
    await expect(
      createNotification({
        type: "low_stock",
        title: "x",
        itemId: NOTIF_ROW.item_id,
        batchNo: null,
      }),
    ).rejects.toThrow("rls");
  });

  it("validates input (blank title rejected)", async () => {
    await expect(
      createNotification({
        type: "low_stock",
        title: "  ",
        itemId: NOTIF_ROW.item_id,
        batchNo: null,
      }),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("deleteNotification", () => {
  it("deletes by id", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [], error: null }));
    await deleteNotification(NOTIF_ROW.id);
    const builder = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(builder["eq"]).toHaveBeenCalledWith("id", NOTIF_ROW.id);
  });
});

describe("getAlertPreferences", () => {
  it("returns defaults when no row exists", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: null, error: null }));
    await expect(getAlertPreferences()).resolves.toEqual({
      lowStockEnabled: true,
      expiryEnabled: true,
      expiryDaysWindow: 7,
    });
  });

  it("maps a stored row", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({
        data: {
          low_stock_enabled: false,
          expiry_enabled: true,
          expiry_days_window: 14,
        },
        error: null,
      }),
    );
    await expect(getAlertPreferences()).resolves.toEqual({
      lowStockEnabled: false,
      expiryEnabled: true,
      expiryDaysWindow: 14,
    });
  });
});

describe("updateAlertPreferences", () => {
  // The RPC path: client.rpc(...).single(). The chainable mock's `rpc`
  // method isn't in the builder list, so mock it via `from` fallback —
  // instead we mock the rpc method directly on the client.
  function mockRpc(result: QueryResult) {
    const rpcBuilder: Record<string, unknown> = {};
    rpcBuilder["single"] = vi.fn(() => rpcBuilder);
    rpcBuilder["then"] = (resolve: (value: QueryResult) => void) =>
      resolve(result);
    mockedGetSupabaseClient.mockReturnValue({
      from: mockFrom,
      rpc: vi.fn().mockReturnValue(rpcBuilder),
    } as unknown as SupabaseClient);
    return rpcBuilder;
  }

  it("upserts via RPC and returns the saved preferences", async () => {
    const rpcBuilder = mockRpc({
      data: {
        low_stock_enabled: false,
        expiry_enabled: true,
        expiry_days_window: 14,
      },
      error: null,
    });
    const saved = await updateAlertPreferences({
      lowStockEnabled: false,
      expiryEnabled: true,
      expiryDaysWindow: 14,
    });
    expect(saved).toEqual({
      lowStockEnabled: false,
      expiryEnabled: true,
      expiryDaysWindow: 14,
    });
    expect(rpcBuilder["single"]).toHaveBeenCalled();
  });

  it("rejects invalid preferences without calling the RPC", async () => {
    const rpcBuilder = mockRpc({ data: null, error: null });
    await expect(
      updateAlertPreferences({
        lowStockEnabled: true,
        expiryEnabled: true,
        expiryDaysWindow: 0,
      }),
    ).rejects.toThrow();
    expect(rpcBuilder["single"]).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    mockRpc({ data: null, error: { message: "staff denied" } });
    await expect(
      updateAlertPreferences({
        lowStockEnabled: true,
        expiryEnabled: true,
        expiryDaysWindow: 7,
      }),
    ).rejects.toThrow("staff denied");
  });
});

describe("listExpiringBatches", () => {
  const in3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const batchRows = [
    { item_id: "item-1", batch_no: "B-1", expiry_date: in3, quantity: 5 },
    { item_id: "item-1", batch_no: "B-1", expiry_date: in3, quantity: -5 }, // consumed
    { item_id: "item-1", batch_no: "B-2", expiry_date: in30, quantity: 5 }, // beyond window
    { item_id: "item-2", batch_no: "B-9", expiry_date: in3, quantity: 2 }, // archived item
  ];
  const itemRows = [{ id: "item-1", name: "Tomato" }];

  it("drops consumed, out-of-window, and archived-item batches", async () => {
    mockFrom
      .mockReturnValueOnce(chainable({ data: batchRows, error: null }))
      .mockReturnValueOnce(chainable({ data: itemRows, error: null }));
    const batches = await listExpiringBatches(7);
    // B-1 nets to zero, B-2 is beyond the 7-day window, B-9's item is archived.
    expect(batches).toEqual([]);
  });

  it("aggregates movements per batch and drops zero-stock batches", async () => {
    const rows = [
      { item_id: "item-1", batch_no: "B-1", expiry_date: in3, quantity: 10 },
      { item_id: "item-1", batch_no: "B-1", expiry_date: in3, quantity: -4 },
    ];
    mockFrom
      .mockReturnValueOnce(chainable({ data: rows, error: null }))
      .mockReturnValueOnce(chainable({ data: itemRows, error: null }));
    const batches = await listExpiringBatches(7);
    expect(batches).toHaveLength(1);
    expect(batches[0].quantity).toBe(6);
    expect(batches[0].expiryDate).toBe(in3);
  });

  it("rejects an invalid window", async () => {
    await expect(listExpiringBatches(0)).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
