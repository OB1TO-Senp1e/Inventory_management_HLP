import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  listPriceHistory,
  listPricesByItem,
  listPricesBySupplier,
  setPreferredSupplier,
  upsertPrice,
} from "./prices";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

/**
 * Thenable chainable mock: every builder method returns the builder itself
 * and awaiting it resolves the canned result — mirrors the supabase-js
 * PostgREST builder well enough to assert query construction.
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "upsert",
    "eq",
    "order",
    "limit",
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
const SUPPLIER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const priceRow = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  supplier_id: SUPPLIER_ID,
  item_id: ITEM_ID,
  unit_price: "45.50",
  currency: "INR",
  is_preferred: false,
  updated_at: "2026-10-04T00:00:00Z",
  items: { name: "Tomatoes", units: { symbol: "kg" } },
  suppliers: { name: "Fresh Farms" },
};

function mockQuery(result: QueryResult): Record<string, unknown> {
  const builder = chainable(result);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
    rpc: mockRpc,
  } as unknown as SupabaseClient);
});

describe("listPricesBySupplier", () => {
  it("queries by supplier id and maps rows with item names", async () => {
    mockQuery({ data: [priceRow], error: null });
    const result = await listPricesBySupplier({ supplierId: SUPPLIER_ID });
    expect(mockFrom).toHaveBeenCalledWith("supplier_prices");
    const builder = mockFrom.mock.results[0].value as Record<string, unknown>;
    expect(builder["eq"]).toHaveBeenCalledWith("supplier_id", SUPPLIER_ID);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      supplierId: SUPPLIER_ID,
      itemId: ITEM_ID,
      unitPrice: 45.5,
      currency: "INR",
      isPreferred: false,
      itemName: "Tomatoes",
      itemUnit: "kg",
      supplierName: "Fresh Farms",
    });
  });

  it("rejects a non-uuid supplier id", async () => {
    await expect(
      listPricesBySupplier({ supplierId: "not-a-uuid" }),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws the database error message", async () => {
    mockQuery({ data: null, error: { message: "boom" } });
    await expect(
      listPricesBySupplier({ supplierId: SUPPLIER_ID }),
    ).rejects.toThrow("boom");
  });
});

describe("listPricesByItem", () => {
  it("queries by item id ordered by price ascending", async () => {
    const builder = mockQuery({ data: [priceRow], error: null });
    const result = await listPricesByItem({ itemId: ITEM_ID });
    expect(builder["eq"]).toHaveBeenCalledWith("item_id", ITEM_ID);
    expect(builder["order"]).toHaveBeenCalledWith("unit_price", {
      ascending: true,
    });
    expect(result[0].unitPrice).toBe(45.5);
  });
});

describe("upsertPrice", () => {
  it("upserts on the (supplier_id, item_id) conflict target", async () => {
    const builder = mockQuery({ data: priceRow, error: null });
    const result = await upsertPrice({
      restaurantId: RID,
      supplierId: SUPPLIER_ID,
      itemId: ITEM_ID,
      unitPrice: 45.5,
    });
    expect(builder["upsert"]).toHaveBeenCalledWith(
      {
        restaurant_id: RID,
        supplier_id: SUPPLIER_ID,
        item_id: ITEM_ID,
        unit_price: 45.5,
      },
      { onConflict: "supplier_id,item_id" },
    );
    expect(result.unitPrice).toBe(45.5);
  });

  it("rejects zero and negative prices before any network call", async () => {
    await expect(
      upsertPrice({
        restaurantId: RID,
        supplierId: SUPPLIER_ID,
        itemId: ITEM_ID,
        unitPrice: 0,
      }),
    ).rejects.toThrow("greater than zero");
    await expect(
      upsertPrice({
        restaurantId: RID,
        supplierId: SUPPLIER_ID,
        itemId: ITEM_ID,
        unitPrice: -5,
      }),
    ).rejects.toThrow("greater than zero");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects non-numeric price input", async () => {
    await expect(
      upsertPrice({
        restaurantId: RID,
        supplierId: SUPPLIER_ID,
        itemId: ITEM_ID,
        unitPrice: "abc",
      }),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("maps unique violations to a friendly error", async () => {
    mockQuery({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(
      upsertPrice({
        restaurantId: RID,
        supplierId: SUPPLIER_ID,
        itemId: ITEM_ID,
        unitPrice: 45.5,
      }),
    ).rejects.toThrow("already exists");
  });
});

describe("setPreferredSupplier", () => {
  it("calls the RPC and re-reads the full row", async () => {
    mockRpc.mockResolvedValue({
      data: { id: priceRow.id },
      error: null,
    });
    mockQuery({ data: { ...priceRow, is_preferred: true }, error: null });
    const result = await setPreferredSupplier({
      itemId: ITEM_ID,
      supplierId: SUPPLIER_ID,
    });
    expect(mockRpc).toHaveBeenCalledWith("set_preferred_supplier", {
      p_item_id: ITEM_ID,
      p_supplier_id: SUPPLIER_ID,
    });
    expect(result.isPreferred).toBe(true);
  });

  it("strips the RPC name prefix from errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "set_preferred_supplier: supplier is archived",
      },
    });
    await expect(
      setPreferredSupplier({ itemId: ITEM_ID, supplierId: SUPPLIER_ID }),
    ).rejects.toThrow("supplier is archived");
    await expect(
      setPreferredSupplier({ itemId: ITEM_ID, supplierId: SUPPLIER_ID }),
    ).rejects.not.toThrow("set_preferred_supplier:");
  });

  it("rejects invalid ids before any network call", async () => {
    await expect(
      setPreferredSupplier({ itemId: "bad", supplierId: SUPPLIER_ID }),
    ).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("listPriceHistory", () => {
  const historyRow = {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    supplier_id: SUPPLIER_ID,
    item_id: ITEM_ID,
    old_price: "45.50",
    new_price: "48.00",
    changed_at: "2026-10-04T01:00:00Z",
    suppliers: { name: "Fresh Farms" },
    items: { name: "Tomatoes" },
  };

  it("filters by supplier and item, newest first", async () => {
    const builder = mockQuery({ data: [historyRow], error: null });
    const result = await listPriceHistory({
      supplierId: SUPPLIER_ID,
      itemId: ITEM_ID,
    });
    expect(builder["eq"]).toHaveBeenCalledWith("supplier_id", SUPPLIER_ID);
    expect(builder["eq"]).toHaveBeenCalledWith("item_id", ITEM_ID);
    expect(builder["order"]).toHaveBeenCalledWith("changed_at", {
      ascending: false,
    });
    expect(result[0]).toMatchObject({
      oldPrice: 45.5,
      newPrice: 48,
      supplierName: "Fresh Farms",
      itemName: "Tomatoes",
    });
  });

  it("maps null old/new prices (insert/delete history rows)", async () => {
    mockQuery({
      data: [
        { ...historyRow, old_price: null },
        { ...historyRow, id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", new_price: null },
      ],
      error: null,
    });
    const result = await listPriceHistory({ supplierId: SUPPLIER_ID });
    expect(result[0].oldPrice).toBeNull();
    expect(result[1].newPrice).toBeNull();
  });

  it("works with no filters (all history)", async () => {
    const builder = mockQuery({ data: [], error: null });
    await listPriceHistory({});
    expect(builder["eq"]).not.toHaveBeenCalled();
  });
});
