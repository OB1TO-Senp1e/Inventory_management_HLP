import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { createOpeningBalance, getCurrentStock, listBatches, listMovements, listReceivableItems, logUsage, logWastage, receiveGoods, subscribeToItemMovements } from "./stock";

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
 * and awaiting it resolves the canned result (including `count` for
 * count:"exact" queries).
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "eq",
    "not",
    "order",
    "limit",
    "range",
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
const mockRpc = vi.fn();

const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MOVEMENT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const stockRow = {
  restaurant_id: "11111111-1111-1111-1111-111111111111",
  item_id: ITEM_ID,
  quantity: "65",
  last_movement_at: "2026-10-04T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
    rpc: mockRpc,
  } as unknown as SupabaseClient);
});

describe("createOpeningBalance", () => {
  it("calls the RPC with snake_case params and returns the movement id", async () => {
    mockRpc.mockResolvedValue({ data: MOVEMENT_ID, error: null });
    const result = await createOpeningBalance({
      itemId: ITEM_ID,
      quantity: 25,
      unitCost: 55.5,
    });
    expect(mockRpc).toHaveBeenCalledWith("create_opening_balance", {
      p_item_id: ITEM_ID,
      p_quantity: 25,
      p_unit_cost: 55.5,
    });
    expect(result).toEqual({ movementId: MOVEMENT_ID });
  });

  it("rejects a non-uuid item id", async () => {
    await expect(
      createOpeningBalance({ itemId: "nope", quantity: 1, unitCost: 1 }),
    ).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects zero and negative quantities", async () => {
    await expect(
      createOpeningBalance({ itemId: ITEM_ID, quantity: 0, unitCost: 1 }),
    ).rejects.toThrow(/greater than zero/);
    await expect(
      createOpeningBalance({ itemId: ITEM_ID, quantity: -3, unitCost: 1 }),
    ).rejects.toThrow(/greater than zero/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a negative unit cost", async () => {
    await expect(
      createOpeningBalance({ itemId: ITEM_ID, quantity: 1, unitCost: -0.5 }),
    ).rejects.toThrow(/cannot be negative/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("coerces string numbers from form inputs", async () => {
    mockRpc.mockResolvedValue({ data: MOVEMENT_ID, error: null });
    await createOpeningBalance({
      itemId: ITEM_ID,
      quantity: "25",
      unitCost: "55.50",
    });
    expect(mockRpc).toHaveBeenCalledWith("create_opening_balance", {
      p_item_id: ITEM_ID,
      p_quantity: 25,
      p_unit_cost: 55.5,
    });
  });

  it("surfaces the RPC's friendly error verbatim", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "create_opening_balance: item x already has an opening balance." },
    });
    await expect(
      createOpeningBalance({ itemId: ITEM_ID, quantity: 1, unitCost: 1 }),
    ).rejects.toThrow(/already has an opening balance/);
  });

  it("rejects a non-uuid RPC return", async () => {
    mockRpc.mockResolvedValue({ data: "not-a-uuid", error: null });
    await expect(
      createOpeningBalance({ itemId: ITEM_ID, quantity: 1, unitCost: 1 }),
    ).rejects.toThrow();
  });
});

describe("getCurrentStock", () => {
  it("returns parsed stock for an item with movements", async () => {
    mockFrom.mockReturnValue(chainable({ data: stockRow, error: null }));
    const result = await getCurrentStock({ itemId: ITEM_ID });
    expect(result).toEqual({
      itemId: ITEM_ID,
      quantity: 65,
      lastMovementAt: "2026-10-04T10:00:00Z",
    });
    const select = (
      mockFrom.mock.results[0].value as Record<string, unknown>
    ).select as ReturnType<typeof vi.fn>;
    expect(mockFrom).toHaveBeenCalledWith("current_stock");
    expect(select).toHaveBeenCalledWith(
      "restaurant_id, item_id, quantity, last_movement_at",
    );
  });

  it("returns null when the item has no movements", async () => {
    mockFrom.mockReturnValue(chainable({ data: null, error: null }));
    await expect(getCurrentStock({ itemId: ITEM_ID })).resolves.toBeNull();
  });

  it("rejects a bad item id before any query", async () => {
    await expect(getCurrentStock({ itemId: "bad" })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws on query error", async () => {
    mockFrom.mockReturnValue(
      chainable({ data: null, error: { message: "boom" } }),
    );
    await expect(getCurrentStock({ itemId: ITEM_ID })).rejects.toThrow("boom");
  });
});

describe("receiveGoods", () => {
  const lineInput = {
    itemId: ITEM_ID,
    quantity: 10,
    unitCost: 40,
    batchNo: "B-001",
    expiryDate: "2026-12-31",
    notes: "first delivery",
  };

  const rpcRow = {
    movement_id: MOVEMENT_ID,
    item_id: ITEM_ID,
    quantity: "10",
    unit_cost: "40",
    old_avg_cost: "0",
    new_avg_cost: "40",
  };

  it("calls the RPC with snake_case line params and parses the result", async () => {
    mockRpc.mockResolvedValue({ data: [rpcRow], error: null });
    const result = await receiveGoods({ lines: [lineInput] });
    expect(mockRpc).toHaveBeenCalledWith("receive_goods", {
      p_lines: [
        {
          item_id: ITEM_ID,
          quantity: 10,
          unit_cost: 40,
          batch_no: "B-001",
          expiry_date: "2026-12-31",
          notes: "first delivery",
        },
      ],
    });
    expect(result.lines).toEqual([
      {
        movementId: MOVEMENT_ID,
        itemId: ITEM_ID,
        quantity: 10,
        unitCost: 40,
        oldAvgCost: 0,
        newAvgCost: 40,
      },
    ]);
  });

  it("normalizes blank optional fields to null", async () => {
    mockRpc.mockResolvedValue({ data: [rpcRow], error: null });
    await receiveGoods({
      lines: [
        { itemId: ITEM_ID, quantity: 5, unitCost: 20, batchNo: "", expiryDate: "", notes: "" },
      ],
    });
    const params = mockRpc.mock.calls[0][1] as {
      p_lines: Array<Record<string, unknown>>;
    };
    expect(params.p_lines[0]).toMatchObject({
      batch_no: null,
      expiry_date: null,
      notes: null,
    });
  });

  it("rejects an empty receipt before any RPC call", async () => {
    await expect(receiveGoods({ lines: [] })).rejects.toThrow(
      "at least one line",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity before any RPC call", async () => {
    await expect(
      receiveGoods({ lines: [{ ...lineInput, quantity: 0 }] }),
    ).rejects.toThrow("greater than zero");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a negative unit cost before any RPC call", async () => {
    await expect(
      receiveGoods({ lines: [{ ...lineInput, unitCost: -1 }] }),
    ).rejects.toThrow("cannot be negative");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a past expiry date before any RPC call", async () => {
    await expect(
      receiveGoods({ lines: [{ ...lineInput, expiryDate: "2020-01-01" }] }),
    ).rejects.toThrow("in the past");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed expiry date before any RPC call", async () => {
    await expect(
      receiveGoods({ lines: [{ ...lineInput, expiryDate: "tomorrow" }] }),
    ).rejects.toThrow("YYYY-MM-DD");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors verbatim (friendly line-numbered messages)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "receive_goods: line 2: quantity must be greater than zero" },
    });
    await expect(receiveGoods({ lines: [lineInput, lineInput] })).rejects.toThrow(
      "receive_goods: line 2",
    );
  });
});

describe("listReceivableItems", () => {
  const rpcRow = {
    item_id: ITEM_ID,
    item_name: "Rice",
    unit_symbol: "kg",
  };

  it("calls the list_receivable_items RPC and maps rows", async () => {
    mockRpc.mockResolvedValue({ data: [rpcRow], error: null });
    const result = await listReceivableItems();
    expect(mockRpc).toHaveBeenCalledWith("list_receivable_items");
    expect(result).toEqual([{ id: ITEM_ID, name: "Rice", unitSymbol: "kg" }]);
  });

  it("returns an empty list when no active items exist", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(listReceivableItems()).resolves.toEqual([]);
  });

  it("surfaces RPC errors (e.g. role-less session rejected)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Only signed-in restaurant users can list receivable items." },
    });
    await expect(listReceivableItems()).rejects.toThrow(
      "Only signed-in restaurant users",
    );
  });

  it("rejects malformed rows before they reach components", async () => {
    mockRpc.mockResolvedValue({ data: [{ item_id: "not-a-uuid" }], error: null });
    await expect(listReceivableItems()).rejects.toThrow();
  });
});

describe("listMovements", () => {
  const movementRow = {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    item_id: ITEM_ID,
    movement_type: "receipt",
    quantity: "10",
    batch_no: "B-1",
    expiry_date: "2026-12-31",
    unit_cost: "40",
    reason_code: null,
    reference_type: "ad_hoc",
    notes: null,
    created_by: "user-1",
    created_at: "2026-10-04T10:00:00Z",
  };

  it("queries newest-first with server-side pagination", async () => {
    mockFrom.mockReturnValue(
      chainable({ data: [movementRow], error: null, count: 45 }),
    );
    const result = await listMovements({ itemId: ITEM_ID, page: 2 });
    expect(mockFrom).toHaveBeenCalledWith("stock_movements");
    const q = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(q.eq as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "item_id",
      ITEM_ID,
    );
    expect(q.order as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "created_at",
      { ascending: false },
    );
    // Page 2 of 20 -> rows 20..39.
    expect(q.range as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(20, 39);
    expect(result.total).toBe(45);
    expect(result.movements).toEqual([
      expect.objectContaining({
        id: movementRow.id,
        movementType: "receipt",
        quantity: 10,
        batchNo: "B-1",
      }),
    ]);
  });

  it("defaults to page 1 with page size 20", async () => {
    mockFrom.mockReturnValue(
      chainable({ data: [], error: null, count: 0 }),
    );
    await listMovements({ itemId: ITEM_ID });
    const q = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(q.range as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(0, 19);
  });

  it("rejects a bad item id and non-positive pages before any query", async () => {
    await expect(listMovements({ itemId: "bad" })).rejects.toThrow();
    await expect(listMovements({ itemId: ITEM_ID, page: 0 })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fails loudly on an unknown movement type (DB/client drift)", async () => {
    mockFrom.mockReturnValue(
      chainable({
        data: [{ ...movementRow, movement_type: "teleport" }],
        error: null,
        count: 1,
      }),
    );
    await expect(listMovements({ itemId: ITEM_ID })).rejects.toThrow();
  });

  it("surfaces query errors", async () => {
    mockFrom.mockReturnValue(
      chainable({ data: null, error: { message: "boom" } }),
    );
    await expect(listMovements({ itemId: ITEM_ID })).rejects.toThrow("boom");
  });
});

describe("listBatches", () => {
  const row = (
    batchNo: string,
    expiry: string | null,
    qty: string,
    at: string,
  ) => ({
    batch_no: batchNo,
    expiry_date: expiry,
    quantity: qty,
    created_at: at,
  });

  it("aggregates per-batch totals client-side", async () => {
    mockFrom.mockReturnValue(
      chainable({
        data: [
          row("B-2", "2026-12-31", "5", "2026-10-03T10:00:00Z"),
          row("B-1", "2026-11-30", "10", "2026-10-02T10:00:00Z"),
          row("B-1", "2026-10-15", "-3", "2026-10-04T10:00:00Z"),
        ],
        error: null,
      }),
    );
    const result = await listBatches({ itemId: ITEM_ID });
    const q = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(q.not as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "batch_no",
      "is",
      null,
    );
    expect(result).toEqual([
      {
        batchNo: "B-1",
        quantity: 7,
        earliestExpiry: "2026-10-15",
        lastMovementAt: "2026-10-04T10:00:00Z",
      },
      {
        batchNo: "B-2",
        quantity: 5,
        earliestExpiry: "2026-12-31",
        lastMovementAt: "2026-10-03T10:00:00Z",
      },
    ]);
  });

  it("returns an empty list when no batch was ever recorded", async () => {
    mockFrom.mockReturnValue(chainable({ data: [], error: null }));
    await expect(listBatches({ itemId: ITEM_ID })).resolves.toEqual([]);
  });

  it("rejects a bad item id before any query", async () => {
    await expect(listBatches({ itemId: "bad" })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("subscribeToItemMovements", () => {
  const mockUnsubscribe = vi.fn();
  const mockOn = vi.fn(() => ({
    subscribe: () => ({ unsubscribe: mockUnsubscribe }),
  }));
  const mockChannel = vi.fn(() => ({ on: mockOn }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSupabaseClient.mockReturnValue({
      channel: mockChannel,
    } as unknown as SupabaseClient);
  });

  it("subscribes to INSERTs on stock_movements filtered by item", () => {
    const onMovement = vi.fn();
    const unsubscribe = subscribeToItemMovements(ITEM_ID, onMovement);
    expect(mockChannel).toHaveBeenCalledWith(
      `stock-movements-item-${ITEM_ID}`,
    );
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "stock_movements",
        filter: `item_id=eq.${ITEM_ID}`,
      },
      expect.any(Function),
    );
    // Firing the postgres_changes callback notifies the caller…
    const firstCall = mockOn.mock.calls[0] as unknown as
      | [string, unknown, () => void]
      | undefined;
    const callback = firstCall?.[2];
    expect(callback).toBeInstanceOf(Function);
    callback?.();
    expect(onMovement).toHaveBeenCalledTimes(1);
    // …and the returned function unsubscribes the channel.
    unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid item id before touching the client", () => {
    expect(() => subscribeToItemMovements("bad", vi.fn())).toThrow();
    expect(mockChannel).not.toHaveBeenCalled();
  });
});

describe("logWastage", () => {
  const input = {
    itemId: ITEM_ID,
    quantity: 5,
    reason: "spoiled",
    notes: "smells off",
  };

  it("calls the log_wastage RPC with snake_case params", async () => {
    mockRpc.mockResolvedValue({ data: MOVEMENT_ID, error: null });
    const result = await logWastage(input);
    expect(mockRpc).toHaveBeenCalledWith("log_wastage", {
      p_item_id: ITEM_ID,
      p_quantity: 5,
      p_reason: "spoiled",
      p_notes: "smells off",
    });
    expect(result).toEqual({ movementId: MOVEMENT_ID });
  });

  it("sends null for blank notes", async () => {
    mockRpc.mockResolvedValue({ data: MOVEMENT_ID, error: null });
    await logWastage({ ...input, notes: "" });
    expect(mockRpc).toHaveBeenCalledWith(
      "log_wastage",
      expect.objectContaining({ p_notes: null }),
    );
  });

  it("rejects zero quantity before any RPC call", async () => {
    await expect(logWastage({ ...input, quantity: 0 })).rejects.toThrow(
      "greater than zero",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a missing reason before any RPC call", async () => {
    await expect(
      logWastage({ itemId: ITEM_ID, quantity: 1 }),
    ).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown reason code before any RPC call", async () => {
    await expect(logWastage({ ...input, reason: "moldy" })).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a usage reason code for wastage", async () => {
    await expect(
      logWastage({ ...input, reason: "kitchen_use" }),
    ).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors verbatim", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "log_wastage: item 123 not found in your restaurant." },
    });
    await expect(logWastage(input)).rejects.toThrow("not found in your restaurant");
  });
});

describe("logUsage", () => {
  const input = {
    itemId: ITEM_ID,
    quantity: 2,
    reason: "kitchen_use",
  };

  it("calls the log_usage RPC with snake_case params", async () => {
    mockRpc.mockResolvedValue({ data: MOVEMENT_ID, error: null });
    const result = await logUsage(input);
    expect(mockRpc).toHaveBeenCalledWith("log_usage", {
      p_item_id: ITEM_ID,
      p_quantity: 2,
      p_reason: "kitchen_use",
      p_notes: null,
    });
    expect(result).toEqual({ movementId: MOVEMENT_ID });
  });

  it("rejects negative quantity before any RPC call", async () => {
    await expect(logUsage({ ...input, quantity: -1 })).rejects.toThrow(
      "greater than zero",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a wastage reason code for usage", async () => {
    await expect(logUsage({ ...input, reason: "expired" })).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors verbatim", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "log_usage: your role cannot log usage." },
    });
    await expect(logUsage(input)).rejects.toThrow("cannot log usage");
  });
});
