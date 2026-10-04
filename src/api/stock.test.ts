import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { createOpeningBalance, getCurrentStock, listReceivableItems, receiveGoods } from "./stock";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
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
    "eq",
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
