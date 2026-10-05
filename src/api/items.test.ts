import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  archiveItem,
  createItem,
  getItem,
  listItemCategories,
  listItems,
  listStorageLocations,
  listUnits,
  updateItem,
} from "./items";

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
    "eq",
    "ilike",
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
const RID = "11111111-1111-1111-1111-111111111111";
const ITEM_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const dbRow = {
  id: ITEM_ID,
  restaurant_id: RID,
  name: "Tomato",
  category_id: "c0000000-0000-0000-0000-000000000001",
  unit_id: "d0000000-0000-0000-0000-000000000001",
  storage_location_id: null,
  par_level: 10,
  reorder_point: 4,
  active: true,
  barcode: "8901234567890",
  created_at: "2026-10-04T00:00:00Z",
  updated_at: "2026-10-04T00:00:00Z",
  item_categories: { name: "Vegetables" },
  units: { name: "kilogram", symbol: "kg" },
  storage_locations: null,
};

function mockQuery(result: QueryResult): Record<string, unknown> {
  const builder = chainable(result);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReset();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
  } as unknown as SupabaseClient);
});

describe("listItems", () => {
  it("queries active items with default sort and first page", async () => {
    const builder = mockQuery({ data: [dbRow], error: null, count: 1 });
    const result = await listItems({});
    expect(mockFrom).toHaveBeenCalledWith("items");
    expect(builder["select"]).toHaveBeenCalledWith(
      "*, item_categories(name), units(name, symbol), storage_locations(name)",
      { count: "exact" },
    );
    expect(builder["eq"]).toHaveBeenCalledWith("active", true);
    expect(builder["order"]).toHaveBeenCalledWith("name", { ascending: true });
    expect(builder["range"]).toHaveBeenCalledWith(0, 19);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: ITEM_ID,
      name: "Tomato",
      categoryName: "Vegetables",
      unitSymbol: "kg",
      parLevel: 10,
      reorderPoint: 4,
    });
  });

  it("applies search, category filter, archived filter, sort and page 2", async () => {
    const builder = mockQuery({ data: [], error: null, count: 0 });
    await listItems({
      search: "toma",
      categoryId: "c0000000-0000-0000-0000-000000000001",
      active: false,
      sortColumn: "par_level",
      sortDirection: "desc",
      page: 2,
      pageSize: 10,
    });
    expect(builder["ilike"]).toHaveBeenCalledWith("name", "%toma%");
    expect(builder["eq"]).toHaveBeenCalledWith(
      "category_id",
      "c0000000-0000-0000-0000-000000000001",
    );
    expect(builder["eq"]).toHaveBeenCalledWith("active", false);
    expect(builder["order"]).toHaveBeenCalledWith("par_level", {
      ascending: false,
    });
    expect(builder["range"]).toHaveBeenCalledWith(10, 19);
  });

  it("escapes LIKE wildcards in the search term", async () => {
    const builder = mockQuery({ data: [], error: null, count: 0 });
    await listItems({ search: "100%_pure" });
    expect(builder["ilike"]).toHaveBeenCalledWith("name", "%100\\%\\_pure%");
  });

  it("rejects an invalid page without calling the client", async () => {
    await expect(listItems({ page: 0 })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("surfaces the database error message", async () => {
    mockQuery({ data: null, error: { message: "boom" }, count: null });
    await expect(listItems({})).rejects.toThrow("boom");
  });
});

describe("getItem", () => {
  it("rejects a non-uuid without calling the client", async () => {
    await expect(getItem("nope")).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches and maps a single row", async () => {
    mockQuery({ data: dbRow, error: null });
    const item = await getItem(ITEM_ID);
    expect(item.name).toBe("Tomato");
    expect(item.unitSymbol).toBe("kg");
    expect(item.storageLocationName).toBeNull();
  });
});

describe("createItem", () => {
  const valid = {
    restaurantId: RID,
    name: "Tomato",
    unitId: "d0000000-0000-0000-0000-000000000001",
    parLevel: 10,
    reorderPoint: 4,
  };

  it("rejects an empty name without calling the client", async () => {
    await expect(createItem({ ...valid, name: "  " })).rejects.toThrow(
      "Enter an item name.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a negative par level without calling the client", async () => {
    await expect(createItem({ ...valid, parLevel: -1 })).rejects.toThrow(
      "Cannot be negative.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a missing unit without calling the client", async () => {
    const { restaurantId, name, parLevel, reorderPoint } = valid;
    await expect(
      createItem({ restaurantId, name, parLevel, reorderPoint }),
    ).rejects.toThrow("Choose a unit.");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts with snake_case columns and returns the mapped item", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    const item = await createItem(valid);
    expect(builder["insert"]).toHaveBeenCalledWith({
      restaurant_id: RID,
      name: "Tomato",
      category_id: null,
      unit_id: "d0000000-0000-0000-0000-000000000001",
      storage_location_id: null,
      par_level: 10,
      reorder_point: 4,
      barcode: null,
    });
    expect(item.id).toBe(ITEM_ID);
    expect(item.barcode).toBe("8901234567890");
  });

  it("sends a trimmed barcode on create", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    await createItem({ ...valid, barcode: "  8901234567890  " });
    expect(builder["insert"]).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: "8901234567890" }),
    );
  });

  it("maps a duplicate-name violation to a friendly message", async () => {
    mockQuery({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(createItem(valid)).rejects.toThrow(
      "An item with this name already exists.",
    );
  });

  it("maps a duplicate-barcode violation to a friendly message", async () => {
    mockQuery({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "items_barcode_restaurant_unique"',
      },
    });
    await expect(
      createItem({ ...valid, barcode: "8901234567890" }),
    ).rejects.toThrow("This barcode is already used by another item.");
  });
});

describe("updateItem", () => {
  it("sends only the provided fields", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    await updateItem(ITEM_ID, { name: "Cherry Tomato", parLevel: 12 });
    expect(builder["update"]).toHaveBeenCalledWith({
      name: "Cherry Tomato",
      par_level: 12,
    });
    expect(builder["eq"]).toHaveBeenCalledWith("id", ITEM_ID);
  });

  it("sends barcode null when cleared", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    await updateItem(ITEM_ID, { barcode: null });
    expect(builder["update"]).toHaveBeenCalledWith({ barcode: null });
  });

  it("rejects an invalid id without calling the client", async () => {
    await expect(updateItem("nope", { name: "x" })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("archiveItem", () => {
  it("soft-deletes via active=false", async () => {
    const builder = mockQuery({
      data: { ...dbRow, active: false },
      error: null,
    });
    const item = await archiveItem(ITEM_ID);
    expect(builder["update"]).toHaveBeenCalledWith({ active: false });
    expect(builder["eq"]).toHaveBeenCalledWith("id", ITEM_ID);
    expect(item.active).toBe(false);
  });
});

describe("lookups", () => {
  it("lists categories ordered by name", async () => {
    const builder = mockQuery({
      data: [{ id: "c1", name: "Vegetables" }],
      error: null,
    });
    const categories = await listItemCategories();
    expect(mockFrom).toHaveBeenCalledWith("item_categories");
    expect(builder["eq"]).toHaveBeenCalledWith("active", true);
    expect(builder["order"]).toHaveBeenCalledWith("name");
    expect(categories).toEqual([{ id: "c1", name: "Vegetables" }]);
  });

  it("lists storage locations", async () => {
    const builder = mockQuery({
      data: [{ id: "l1", name: "Dry Store" }],
      error: null,
    });
    const locations = await listStorageLocations();
    expect(mockFrom).toHaveBeenCalledWith("storage_locations");
    expect(builder["eq"]).toHaveBeenCalledWith("active", true);
    expect(locations).toEqual([{ id: "l1", name: "Dry Store" }]);
  });

  it("lists units with their symbols", async () => {
    mockQuery({
      data: [{ id: "u1", name: "kilogram", symbol: "kg" }],
      error: null,
    });
    const units = await listUnits();
    expect(mockFrom).toHaveBeenCalledWith("units");
    expect(units).toEqual([{ id: "u1", name: "kilogram", symbol: "kg" }]);
  });
});
