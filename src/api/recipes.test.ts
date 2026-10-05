import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  addIngredient,
  archiveMenuItem,
  createMenuItem,
  getMenuItem,
  listMenuItems,
  listUnitConversions,
  removeIngredient,
  updateIngredient,
  updateMenuItem,
} from "./recipes";

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
    "ilike",
    "in",
    "order",
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
const MENU_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UNIT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
  } as unknown as SupabaseClient);
});

const menuRow = {
  id: MENU_ID,
  restaurant_id: RID,
  name: "Butter Chicken",
  description: "Creamy tomato curry",
  yield_quantity: 4,
  yield_unit: "servings",
  selling_price: 199,
  active: true,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T00:00:00Z",
  recipe_ingredients: [{ count: 2 }],
};

const ingredientRow = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  item_id: ITEM_ID,
  quantity: 500,
  unit_id: UNIT_ID,
  notes: null,
  items: {
    name: "Tomato",
    unit_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    avg_unit_cost: 40,
    units: { symbol: "kg" },
  },
  units: { symbol: "g" },
};

const costRow = {
  menu_item_id: MENU_ID,
  ingredient_cost: 123,
};

describe("listMenuItems", () => {
  it("returns menu items with ingredient counts", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [menuRow], error: null }));
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const result = await listMenuItems({});
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Butter Chicken");
    expect(result[0].yieldQuantity).toBe(4);
    expect(result[0].ingredientCount).toBe(2);
    expect(mockFrom).toHaveBeenCalledWith("menu_items");
  });

  it("merges live costs from the menu_item_costs view", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [menuRow], error: null }));
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const result = await listMenuItems({});
    // ₹123 for the full yield / 4 servings = ₹30.75 per dish.
    expect(result[0].sellingPrice).toBe(199);
    expect(result[0].ingredientCost).toBe(123);
    expect(result[0].costPerDish).toBeCloseTo(30.75, 10);
    // Food-cost % = 30.75 / 199 × 100.
    expect(result[0].foodCostPct).toBeCloseTo(15.4523, 3);
    expect(mockFrom).toHaveBeenCalledWith("menu_item_costs");
  });

  it("reports no food-cost % without a selling price", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: [{ ...menuRow, selling_price: null }], error: null }),
    );
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const result = await listMenuItems({});
    expect(result[0].sellingPrice).toBeNull();
    expect(result[0].costPerDish).toBeCloseTo(30.75, 10);
    expect(result[0].foodCostPct).toBeNull();
  });

  it("treats a missing cost row as zero", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: [menuRow], error: null }));
    mockFrom.mockReturnValueOnce(chainable({ data: [], error: null }));
    const result = await listMenuItems({});
    expect(result[0].ingredientCost).toBe(0);
    expect(result[0].costPerDish).toBe(0);
  });

  it("throws a friendly error on failure", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: null, error: { message: "boom" } }),
    );
    await expect(listMenuItems({})).rejects.toThrow("boom");
  });
});

describe("getMenuItem", () => {
  it("returns the item with ingredient lines", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({
        data: { ...menuRow, recipe_ingredients: [ingredientRow] },
        error: null,
      }),
    );
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const result = await getMenuItem(MENU_ID);
    expect(result.name).toBe("Butter Chicken");
    expect(result.ingredients).toHaveLength(1);
    expect(result.ingredients[0].itemName).toBe("Tomato");
    expect(result.ingredients[0].baseUnitSymbol).toBe("kg");
    expect(result.ingredients[0].unitSymbol).toBe("g");
    expect(result.ingredients[0].itemBaseUnitId).toBe(
      "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    );
    expect(result.ingredients[0].itemAvgUnitCost).toBe(40);
    expect(result.costPerDish).toBeCloseTo(30.75, 10);
    expect(result.foodCostPct).toBeCloseTo(15.4523, 3);
  });

  it("rejects a non-UUID id", async () => {
    await expect(getMenuItem("nope")).rejects.toThrow();
  });
});

describe("createMenuItem", () => {
  it("validates input before any network call", async () => {
    await expect(
      createMenuItem({ name: "", yieldQuantity: 0, yieldUnit: "" }, RID),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts and returns the created item", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: { ...menuRow, recipe_ingredients: [] }, error: null }),
    );
    const result = await createMenuItem(
      {
        name: "Butter Chicken",
        yieldQuantity: 4,
        yieldUnit: "servings",
        sellingPrice: 199,
      },
      RID,
    );
    expect(result.name).toBe("Butter Chicken");
    expect(result.sellingPrice).toBe(199);
    // A new recipe has no ingredients: zero cost, zero food cost.
    expect(result.ingredientCost).toBe(0);
    expect(result.costPerDish).toBe(0);
    expect(result.foodCostPct).toBe(0);
    expect(mockFrom).toHaveBeenCalledWith("menu_items");
  });

  it("omits the selling price when not provided", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({
        data: { ...menuRow, selling_price: null, recipe_ingredients: [] },
        error: null,
      }),
    );
    const result = await createMenuItem(
      { name: "Butter Chicken", yieldQuantity: 4, yieldUnit: "servings" },
      RID,
    );
    expect(result.sellingPrice).toBeNull();
    expect(result.foodCostPct).toBeNull();
  });
});

describe("updateMenuItem", () => {
  it("updates header fields", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: menuRow, error: null }),
    );
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const result = await updateMenuItem(MENU_ID, { name: "New name" });
    expect(result.name).toBe("Butter Chicken");
  });

  it("patches and clears the selling price", async () => {
    // Set a price.
    mockFrom.mockReturnValueOnce(
      chainable({ data: { ...menuRow, selling_price: 249 }, error: null }),
    );
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const priced = await updateMenuItem(MENU_ID, { sellingPrice: 249 });
    expect(priced.sellingPrice).toBe(249);
    expect(priced.foodCostPct).toBeCloseTo((30.75 / 249) * 100, 3);
    // Clear it back to null with a blank field.
    mockFrom.mockReturnValueOnce(
      chainable({ data: { ...menuRow, selling_price: null }, error: null }),
    );
    mockFrom.mockReturnValueOnce(chainable({ data: [costRow], error: null }));
    const cleared = await updateMenuItem(MENU_ID, { sellingPrice: "" });
    expect(cleared.sellingPrice).toBeNull();
    expect(cleared.foodCostPct).toBeNull();
  });
});

describe("archiveMenuItem", () => {
  it("soft-deletes via active=false", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: null, error: null }));
    await archiveMenuItem(MENU_ID);
    expect(mockFrom).toHaveBeenCalledWith("menu_items");
  });
});

describe("addIngredient", () => {
  it("validates the line before any network call", async () => {
    await expect(
      addIngredient(
        MENU_ID,
        { itemId: ITEM_ID, quantity: -1, unitId: UNIT_ID },
        RID,
      ),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts and returns the ingredient", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: ingredientRow, error: null }),
    );
    const result = await addIngredient(
      MENU_ID,
      { itemId: ITEM_ID, quantity: 500, unitId: UNIT_ID },
      RID,
    );
    expect(result.itemName).toBe("Tomato");
    expect(result.quantity).toBe(500);
    expect(mockFrom).toHaveBeenCalledWith("recipe_ingredients");
  });
});

describe("updateIngredient", () => {
  it("updates the line", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({ data: ingredientRow, error: null }),
    );
    const result = await updateIngredient("dddddddd-dddd-dddd-dddd-dddddddddddd", {
      itemId: ITEM_ID,
      quantity: 600,
      unitId: UNIT_ID,
    });
    expect(result.quantity).toBe(500);
  });
});

describe("removeIngredient", () => {
  it("deletes the line", async () => {
    mockFrom.mockReturnValueOnce(chainable({ data: null, error: null }));
    await removeIngredient("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect(mockFrom).toHaveBeenCalledWith("recipe_ingredients");
  });
});

describe("listUnitConversions", () => {
  it("maps rows to camelCase", async () => {
    mockFrom.mockReturnValueOnce(
      chainable({
        data: [{ from_unit_id: "a", to_unit_id: "b", factor: 0.001 }],
        error: null,
      }),
    );
    const result = await listUnitConversions();
    expect(result).toEqual([{ fromUnitId: "a", toUnitId: "b", factor: 0.001 }]);
    expect(mockFrom).toHaveBeenCalledWith("unit_conversions");
  });
});
