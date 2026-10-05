import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  logPoResend,
  receivePurchaseOrder,
  removePurchaseOrderLine,
  sendPurchaseOrder,
  updatePurchaseOrder,
} from "./purchasing";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));
// listReorderSuggestions delegates the stock read to ./stock — mock it so
// these tests cover only the suggestion/grouping logic.
vi.mock("./stock", () => ({ listStockOverview: vi.fn() }));

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
  gst_rate: 18,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T00:00:00Z",
  sent_at: null,
  sent_via: null,
  suppliers: {
    name: "Fresh Farms",
    address: "APMC Market",
    phone: "+91 98200 12345",
    email: null,
    gstin: "27ABCDE1234F1Z5",
  },
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

  it("computes GST amount and grand total from the snapshotted rate", async () => {
    mockFrom
      .mockReturnValueOnce(chainable({ data: poRow, error: null }))
      .mockReturnValueOnce(chainable({ data: [lineRow], error: null }));

    const po = await getPurchaseOrder(PO_ID);
    expect(po.gstRate).toBe(18);
    // 325 * 18% = 58.5, rounded to paise.
    expect(po.gstAmount).toBeCloseTo(58.5);
    expect(po.grandTotal).toBeCloseTo(383.5);
  });

  it("rounds GST to paise on awkward totals", async () => {
    const awkwardLine = { ...lineRow, quantity: 3, unit_price: 33.33 };
    mockFrom
      .mockReturnValueOnce(chainable({ data: poRow, error: null }))
      .mockReturnValueOnce(chainable({ data: [awkwardLine], error: null }));

    const po = await getPurchaseOrder(PO_ID);
    // 99.99 * 18% = 17.9982 → 18.00
    expect(po.gstAmount).toBeCloseTo(18, 2);
    expect(po.grandTotal).toBeCloseTo(117.99, 2);
  });

  it("exposes supplier details for the print view", async () => {
    mockFrom
      .mockReturnValueOnce(chainable({ data: poRow, error: null }))
      .mockReturnValueOnce(chainable({ data: [lineRow], error: null }));

    const po = await getPurchaseOrder(PO_ID);
    expect(po.supplierAddress).toBe("APMC Market");
    expect(po.supplierGstin).toBe("27ABCDE1234F1Z5");
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
      gstRate: 18,
      lines: [{ itemId: ITEM_ID, quantity: 10, unitPrice: 32.5 }],
    });
    expect(id).toBe(PO_ID);
    expect(mockRpc).toHaveBeenCalledWith("create_purchase_order", {
      p_supplier_id: SUPPLIER_ID,
      p_order_date: "2026-10-05",
      p_expected_date: null,
      p_notes: null,
      p_gst_rate: 18,
      p_lines: [
        { item_id: ITEM_ID, quantity: 10, unit_price: 32.5, notes: null },
      ],
    });
  });

  it("defaults gstRate to 0", async () => {
    mockRpc.mockResolvedValue({ data: PO_ID, error: null });
    await createPurchaseOrder({
      supplierId: SUPPLIER_ID,
      orderDate: "2026-10-05",
      lines: [{ itemId: ITEM_ID, quantity: 10, unitPrice: 32.5 }],
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "create_purchase_order",
      expect.objectContaining({ p_gst_rate: 0 }),
    );
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

describe("sendPurchaseOrder / cancelPurchaseOrder", () => {
  it("calls the send RPC with the PO id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await sendPurchaseOrder(PO_ID);
    expect(mockRpc).toHaveBeenCalledWith("send_purchase_order", { p_po_id: PO_ID });
  });

  it("passes the channel through to the send RPC", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await sendPurchaseOrder(PO_ID, "whatsapp");
    expect(mockRpc).toHaveBeenCalledWith("send_purchase_order", {
      p_po_id: PO_ID,
      p_channel: "whatsapp",
    });
  });

  it("rejects an invalid channel before any network call", async () => {
    await expect(sendPurchaseOrder(PO_ID, "pigeon")).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls the cancel RPC with the PO id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await cancelPurchaseOrder(PO_ID);
    expect(mockRpc).toHaveBeenCalledWith("cancel_purchase_order", { p_po_id: PO_ID });
  });

  it("rejects invalid ids before any network call", async () => {
    await expect(sendPurchaseOrder("not-a-uuid")).rejects.toThrow();
    await expect(cancelPurchaseOrder("not-a-uuid")).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "only draft purchase orders can be sent" } });
    await expect(sendPurchaseOrder(PO_ID)).rejects.toThrow(/only draft/);
    mockRpc.mockResolvedValue({ data: null, error: { message: "only draft or sent" } });
    await expect(cancelPurchaseOrder(PO_ID)).rejects.toThrow(/draft or sent/);
  });
});

describe("logPoResend", () => {
  it("calls the resend RPC with the PO id and channel", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await logPoResend(PO_ID, "email");
    expect(mockRpc).toHaveBeenCalledWith("log_po_resend", {
      p_po_id: PO_ID,
      p_channel: "email",
    });
  });

  it("rejects invalid input before any network call", async () => {
    await expect(logPoResend("not-a-uuid", "email")).rejects.toThrow();
    await expect(logPoResend(PO_ID, "pigeon")).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "only sent purchase orders can be re-sent" } });
    await expect(logPoResend(PO_ID, "email")).rejects.toThrow(/re-sent/);
  });
});

describe("receivePurchaseOrder", () => {
  const LINE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

  it("calls the receive RPC with snake_case payloads and parses the result", async () => {
    mockRpc.mockResolvedValue({
      data: {
        po_id: PO_ID,
        status: "partially_received",
        lines: [
          {
            po_line_id: LINE_ID,
            item_id: ITEM_ID,
            quantity: 10,
            received_quantity: 6,
          },
        ],
      },
      error: null,
    });
    const result = await receivePurchaseOrder({
      id: PO_ID,
      lines: [
        {
          poLineId: LINE_ID,
          quantity: 6,
          batchNo: "B-001",
          expiryDate: "2026-12-31",
          notes: "first drop",
        },
      ],
    });
    expect(result.poId).toBe(PO_ID);
    expect(result.status).toBe("partially_received");
    expect(result.lines).toEqual([
      { poLineId: LINE_ID, itemId: ITEM_ID, quantity: 10, receivedQuantity: 6 },
    ]);
    expect(mockRpc).toHaveBeenCalledWith("receive_purchase_order", {
      p_po_id: PO_ID,
      p_lines: [
        {
          po_line_id: LINE_ID,
          quantity: 6,
          batch_no: "B-001",
          expiry_date: "2026-12-31",
          notes: "first drop",
        },
      ],
    });
  });

  it("trims blanks to null and rejects empty lines before any network call", async () => {
    mockRpc.mockResolvedValue({
      data: { po_id: PO_ID, status: "partially_received", lines: [] },
      error: null,
    });
    await receivePurchaseOrder({
      id: PO_ID,
      lines: [{ poLineId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", quantity: 2, batchNo: "  " }],
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "receive_purchase_order",
      expect.objectContaining({
        p_lines: [
          {
            po_line_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
            quantity: 2,
            batch_no: null,
            expiry_date: null,
            notes: null,
          },
        ],
      }),
    );
    await expect(receivePurchaseOrder({ id: PO_ID, lines: [] })).rejects.toThrow(
      /at least one line/,
    );
  });

  it("rejects non-positive quantities before any network call", async () => {
    mockRpc.mockClear();
    await expect(
      receivePurchaseOrder({
        id: PO_ID,
        lines: [{ poLineId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", quantity: 0 }],
      }),
    ).rejects.toThrow(/greater than zero/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors (e.g. over-receive)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "would exceed the ordered quantity" },
    });
    await expect(
      receivePurchaseOrder({
        id: PO_ID,
        lines: [{ poLineId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", quantity: 99 }],
      }),
    ).rejects.toThrow(/exceed the ordered quantity/);
  });
});

describe("listReorderSuggestions", () => {
  const ITEM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const ITEM_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const SUP_A = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const SUP_B = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

  function overviewRow(overrides: Record<string, unknown>) {
    return {
      itemId: ITEM_A,
      name: "Tomato",
      categoryId: null,
      categoryName: null,
      locationId: null,
      locationName: null,
      unitSymbol: "kg",
      reorderPoint: 10,
      parLevel: 50,
      quantity: 5,
      lastMovementAt: null,
      earliestExpiry: null,
      ...overrides,
    };
  }

  function priceRow(overrides: Record<string, unknown>) {
    return {
      item_id: ITEM_A,
      supplier_id: SUP_A,
      unit_price: 30,
      currency: "INR",
      suppliers: { name: "Fresh Farms" },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] without querying prices when nothing is low-stock", async () => {
    const { listStockOverview } = await import("./stock");
    vi.mocked(listStockOverview).mockResolvedValue([
      overviewRow({ quantity: 42 }),
    ]);
    const { listReorderSuggestions } = await import("./purchasing");
    expect(await listReorderSuggestions()).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("groups low-stock items by preferred supplier with order-up-to-par quantities", async () => {
    const { listStockOverview } = await import("./stock");
    vi.mocked(listStockOverview).mockResolvedValue([
      overviewRow({ itemId: ITEM_A, name: "Tomato", quantity: 5, parLevel: 50, reorderPoint: 10 }),
      overviewRow({ itemId: ITEM_B, name: "Milk", unitSymbol: "L", quantity: 8, parLevel: 40, reorderPoint: 10 }),
      // Above reorder point — excluded.
      overviewRow({ itemId: ITEM_C, name: "Flour", quantity: 100, parLevel: 50, reorderPoint: 10 }),
    ]);
    mockFrom.mockReturnValueOnce(
      chainable({
        data: [
          priceRow({ item_id: ITEM_A, supplier_id: SUP_A, unit_price: 30, suppliers: { name: "Fresh Farms" } }),
          priceRow({ item_id: ITEM_B, supplier_id: SUP_B, unit_price: 58, suppliers: { name: "Dairy Co" } }),
        ],
        error: null,
      }),
    );
    const { listReorderSuggestions } = await import("./purchasing");
    const groups = await listReorderSuggestions();
    expect(groups).toHaveLength(2);
    // Sorted by supplier name.
    expect(groups[0].supplierName).toBe("Dairy Co");
    expect(groups[0].lines[0]).toMatchObject({
      itemId: ITEM_B,
      itemName: "Milk",
      suggestedQty: 32, // 40 - 8
      unitPrice: 58,
    });
    expect(groups[1].supplierName).toBe("Fresh Farms");
    expect(groups[1].lines[0]).toMatchObject({
      itemId: ITEM_A,
      suggestedQty: 45, // 50 - 5
      unitPrice: 30,
    });
  });

  it("puts items without a preferred supplier in the unassigned group", async () => {
    const { listStockOverview } = await import("./stock");
    vi.mocked(listStockOverview).mockResolvedValue([
      overviewRow({ itemId: ITEM_A, quantity: 5 }),
    ]);
    mockFrom.mockReturnValueOnce(chainable({ data: [], error: null }));
    const { listReorderSuggestions } = await import("./purchasing");
    const groups = await listReorderSuggestions();
    expect(groups).toHaveLength(1);
    expect(groups[0].supplierId).toBeNull();
    expect(groups[0].supplierName).toBe("No preferred supplier");
    expect(groups[0].lines[0].unitPrice).toBeNull();
  });

  it("suggests at least 1 base unit when par math yields <= 0", async () => {
    const { listStockOverview } = await import("./stock");
    vi.mocked(listStockOverview).mockResolvedValue([
      // Misconfigured: par (5) < current (8), yet at/below reorder (10).
      overviewRow({ itemId: ITEM_A, quantity: 8, parLevel: 5, reorderPoint: 10 }),
    ]);
    mockFrom.mockReturnValueOnce(
      chainable({ data: [priceRow({})], error: null }),
    );
    const { listReorderSuggestions } = await import("./purchasing");
    const groups = await listReorderSuggestions();
    expect(groups[0].lines[0].suggestedQty).toBe(1);
  });

  it("throws when the preferred-price query fails", async () => {
    const { listStockOverview } = await import("./stock");
    vi.mocked(listStockOverview).mockResolvedValue([overviewRow({})]);
    mockFrom.mockReturnValueOnce(
      chainable({ data: null, error: { message: "boom" } }),
    );
    const { listReorderSuggestions } = await import("./purchasing");
    await expect(listReorderSuggestions()).rejects.toThrow(/boom/);
  });
});
