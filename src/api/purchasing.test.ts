import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  addPurchaseOrderLine,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  removePurchaseOrderLine,
  updatePurchaseOrder,
} from "./purchasing";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "in",
    "order",
    "range",
    "single",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) =>
    resolve(result);
  return builder;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const RID = "11111111-1111-1111-1111-111111111111";
const PO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SUPPLIER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ITEM_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
    rpc: mockRpc,
  } as unknown as SupabaseClient);
});

const poRow = {
  id: PO_ID,
  supplier_id: SUPPLIER_ID,
  status: "draft",
  order_date: "2026-10-05",
  expected_date: null,
  notes: null,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T00:00:00Z",
  suppliers: { name: "Fresh Farms" },
};

const lineRow = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  item_id: ITEM_ID,
  quantity: 10,
  unit_price: 32.5,
  received_quantity: 0,
  notes: null,
  items: { name: "Tomato", units: { symbol: "kg" } },
};

describe("listPurchaseOrders", () => {
  it("returns POs with computed line counts and totals", async () => {
    const idBuilder = chainable({ data: [{ id: PO_ID }], error: null, count: 1 });
    const poBuilder = chainable({ data: [poRow], error: null });
    const lineBuilder = chainable({
      data: [{ po_id: PO_ID, quantity: 10, unit_price: 32.5 }],
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(idBuilder)
      .mockReturnValueOnce(poBuilder)
      .mockReturnValueOnce(lineBuilder);

    const result = await listPurchaseOrders({ page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].supplierName).toBe("Fresh Farms");
    expect(result.orders[0].lineCount).toBe(1);
    expect(result.orders[0].total).toBeCloseTo(325);
  });

  it("returns empty when no POs match", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [], error: null, count: 0 }));
    const result = await listPurchaseOrders({ page: 1, pageSize: 20 });
    expect(result.orders).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("throws on query error", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: null, error: { message: "db down" } }),
    );
    await expect(listPurchaseOrders({})).rejects.toThrow("db down");
  });
});

describe("getPurchaseOrder", () => {
  it("returns the PO with lines and computed total", async () => {
    mockFrom
      .mockReturnValueOnce(chainable({ data: poRow, error: null }))
      .mockReturnValueOnce(chainable({ data: [lineRow], error: null }));

    const po = await getPurchaseOrder(PO_ID);
    expect(po.id).toBe(PO_ID);
    expect(po.lines).toHaveLength(1);
    expect(po.lines[0].itemName).toBe("Tomato");
    expect(po.lines[0].lineTotal).toBeCloseTo(325);
    expect(po.total).toBeCloseTo(325);
  });

  it("rejects invalid ids before any network call", async () => {
    await expect(getPurchaseOrder("not-a-uuid")).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("createPurchaseOrder", () => {
  it("calls the RPC with snake_case line payloads and returns the id", async () => {
    mockRpc.mockResolvedValue({ data: PO_ID, error: null });
    const id = await createPurchaseOrder({
      supplierId: SUPPLIER_ID,
      orderDate: "2026-10-05",
      lines: [{ itemId: ITEM_ID, quantity: 10, unitPrice: 32.5 }],
    });
    expect(id).toBe(PO_ID);
    expect(mockRpc).toHaveBeenCalledWith("create_purchase_order", {
      p_supplier_id: SUPPLIER_ID,
      p_order_date: "2026-10-05",
      p_expected_date: null,
      p_notes: null,
      p_lines: [
        { item_id: ITEM_ID, quantity: 10, unit_price: 32.5, notes: null },
      ],
    });
  });

  it("rejects empty lines before any network call", async () => {
    await expect(
      createPurchaseOrder({ supplierId: SUPPLIER_ID, lines: [] }),
    ).rejects.toThrow(/at least one line/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate items in one PO", async () => {
    await expect(
      createPurchaseOrder({
        supplierId: SUPPLIER_ID,
        lines: [
          { itemId: ITEM_ID, quantity: 1, unitPrice: 10 },
          { itemId: ITEM_ID, quantity: 2, unitPrice: 11 },
        ],
      }),
    ).rejects.toThrow(/only once/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "archived supplier" } });
    await expect(
      createPurchaseOrder({
        supplierId: SUPPLIER_ID,
        lines: [{ itemId: ITEM_ID, quantity: 1, unitPrice: 10 }],
      }),
    ).rejects.toThrow("archived supplier");
  });
});

describe("updatePurchaseOrder", () => {
  it("patches header fields", async () => {
    const builder = chainable({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await updatePurchaseOrder({ id: PO_ID, notes: "  rush  " });
    expect(builder["update"]).toHaveBeenCalledWith({
      expected_date: null,
      notes: "rush",
    });
  });
});

describe("addPurchaseOrderLine / removePurchaseOrderLine", () => {
  it("inserts a line with the caller restaurant", async () => {
    const builder = chainable({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await addPurchaseOrderLine({
      poId: PO_ID,
      restaurantId: RID,
      itemId: ITEM_ID,
      quantity: 5,
      unitPrice: 20,
    });
    expect(builder["insert"]).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: RID,
        po_id: PO_ID,
        item_id: ITEM_ID,
        quantity: 5,
        unit_price: 20,
      }),
    );
  });

  it("deletes a line by id", async () => {
    const builder = chainable({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await removePurchaseOrderLine("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect(builder["delete"]).toHaveBeenCalled();
  });
});
