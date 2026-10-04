import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  archiveCategory,
  archiveLocation,
  countCategoryItems,
  countLocationItems,
  createCategory,
  createLocation,
  deleteCategory,
  deleteLocation,
  listCategories,
  listLocations,
  updateCategory,
  updateLocation,
} from "./taxonomy";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

/**
 * Chainable mock with an ordered result queue: each `await` on the builder
 * consumes the next canned result. Mirrors the supabase-js PostgREST builder
 * well enough to assert query construction and multi-step flows
 * (e.g. usage pre-check, then delete).
 */
function mockQuerySequence(
  results: QueryResult[],
): Record<string, unknown> & { mockFrom: ReturnType<typeof vi.fn> } {
  const queue = [...results];
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "order",
    "single",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) => {
    const next = queue.shift() ?? { data: [], error: null };
    resolve(next);
  };
  const mockFrom = vi.fn().mockReturnValue(builder);
  mockedGetSupabaseClient.mockReturnValue({ from: mockFrom } as never);
  return { ...builder, mockFrom };
}

const RID = "11111111-1111-1111-1111-111111111111";
const CAT_ID = "c0000000-0000-0000-0000-000000000001";

const dbRow = {
  id: CAT_ID,
  restaurant_id: RID,
  name: "Vegetables",
  active: true,
  created_at: "2026-10-04T00:00:00Z",
  updated_at: "2026-10-04T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCategories / listLocations", () => {
  it("lists active categories ordered by name", async () => {
    const { mockFrom } = mockQuerySequence([{ data: [dbRow], error: null }]);
    const categories = await listCategories();
    expect(mockFrom).toHaveBeenCalledWith("item_categories");
    expect(categories).toEqual([
      {
        id: CAT_ID,
        name: "Vegetables",
        active: true,
        createdAt: "2026-10-04T00:00:00Z",
        updatedAt: "2026-10-04T00:00:00Z",
      },
    ]);
  });

  it("passes the active filter through", async () => {
    const ctx = mockQuerySequence([{ data: [], error: null }]);
    await listCategories(false);
    expect(ctx["eq"]).toHaveBeenCalledWith("active", false);
  });

  it("lists storage locations", async () => {
    const { mockFrom } = mockQuerySequence([{ data: [dbRow], error: null }]);
    const locations = await listLocations();
    expect(mockFrom).toHaveBeenCalledWith("storage_locations");
    expect(locations).toHaveLength(1);
  });
});

describe("createCategory / createLocation", () => {
  it("validates input before any network call", async () => {
    const { mockFrom } = mockQuerySequence([]);
    await expect(
      createCategory({ restaurantId: RID, name: "   " }),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates with the restaurant id from the caller", async () => {
    const ctx = mockQuerySequence([{ data: dbRow, error: null }]);
    const created = await createCategory({ restaurantId: RID, name: "Herbs" });
    expect(ctx["insert"]).toHaveBeenCalledWith({
      restaurant_id: RID,
      name: "Herbs",
    });
    expect(created.name).toBe("Vegetables");
  });

  it("maps duplicate names to a friendly error", async () => {
    mockQuerySequence([
      { data: null, error: { code: "23505", message: "duplicate key" } },
    ]);
    await expect(
      createCategory({ restaurantId: RID, name: "Vegetables" }),
    ).rejects.toThrow("already exists");
  });

  it("creates storage locations", async () => {
    const { mockFrom } = mockQuerySequence([{ data: dbRow, error: null }]);
    await createLocation({ restaurantId: RID, name: "Pantry" });
    expect(mockFrom).toHaveBeenCalledWith("storage_locations");
  });
});

describe("updateCategory / updateLocation", () => {
  it("renames a category", async () => {
    const ctx = mockQuerySequence([
      { data: { ...dbRow, name: "Fresh Herbs" }, error: null },
    ]);
    const updated = await updateCategory(CAT_ID, { name: "Fresh Herbs" });
    expect(ctx["update"]).toHaveBeenCalledWith({ name: "Fresh Herbs" });
    expect(ctx["eq"]).toHaveBeenCalledWith("id", CAT_ID);
    expect(updated.name).toBe("Fresh Herbs");
  });

  it("rejects blank names", async () => {
    const { mockFrom } = mockQuerySequence([]);
    await expect(updateLocation(CAT_ID, { name: "" })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("archiveCategory / archiveLocation", () => {
  it("archives via active=false", async () => {
    const ctx = mockQuerySequence([
      { data: { ...dbRow, active: false }, error: null },
    ]);
    const archived = await archiveCategory(CAT_ID);
    expect(ctx["update"]).toHaveBeenCalledWith({ active: false });
    expect(archived.active).toBe(false);
  });

  it("archives locations", async () => {
    const { mockFrom } = mockQuerySequence([
      { data: { ...dbRow, active: false }, error: null },
    ]);
    await archiveLocation(CAT_ID);
    expect(mockFrom).toHaveBeenCalledWith("storage_locations");
  });
});

describe("deleteCategory / deleteLocation", () => {
  it("refuses the delete when items reference the category", async () => {
    const ctx = mockQuerySequence([{ data: [], error: null, count: 3 }]);
    await expect(deleteCategory(CAT_ID)).rejects.toThrow(
      "still used by 3 items",
    );
    expect(ctx.mockFrom).toHaveBeenCalledWith("items");
    expect(ctx["delete"]).not.toHaveBeenCalled();
  });

  it("uses the singular form for one item", async () => {
    mockQuerySequence([{ data: [], error: null, count: 1 }]);
    await expect(deleteCategory(CAT_ID)).rejects.toThrow(
      "still used by 1 item.",
    );
  });

  it("deletes an unused category", async () => {
    const ctx = mockQuerySequence([
      { data: [], error: null, count: 0 },
      { data: null, error: null },
    ]);
    await deleteCategory(CAT_ID);
    expect(ctx["delete"]).toHaveBeenCalled();
  });

  it("maps a raced FK violation to the friendly message", async () => {
    mockQuerySequence([
      { data: [], error: null, count: 0 },
      {
        data: null,
        error: { code: "23503", message: "violates foreign key" },
      },
    ]);
    await expect(deleteCategory(CAT_ID)).rejects.toThrow(
      "still used by items",
    );
  });

  it("refuses the delete when items reference the location", async () => {
    mockQuerySequence([{ data: [], error: null, count: 2 }]);
    await expect(deleteLocation(CAT_ID)).rejects.toThrow(
      "still used by 2 items",
    );
  });

  it("deletes an unused location", async () => {
    const ctx = mockQuerySequence([
      { data: [], error: null, count: 0 },
      { data: null, error: null },
    ]);
    await deleteLocation(CAT_ID);
    expect(ctx["delete"]).toHaveBeenCalled();
  });
});

describe("countCategoryItems / countLocationItems", () => {
  it("returns the referencing item count", async () => {
    mockQuerySequence([{ data: [], error: null, count: 4 }]);
    await expect(countCategoryItems(CAT_ID)).resolves.toBe(4);
  });

  it("counts location references", async () => {
    const { mockFrom } = mockQuerySequence([
      { data: [], error: null, count: 0 },
    ]);
    await expect(countLocationItems(CAT_ID)).resolves.toBe(0);
    expect(mockFrom).toHaveBeenCalledWith("items");
  });
});
