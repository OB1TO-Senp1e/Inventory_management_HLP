import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import type { UnitConversion } from "@/lib/units";
import {
  createMenuItemSchema,
  listMenuItemsSchema,
  recipeIngredientInputSchema,
  updateMenuItemSchema,
  type CreateMenuItemInput,
  type ListMenuItemsInput,
  type RecipeIngredientInput,
  type UpdateMenuItemInput,
} from "@/schemas/recipe";

/**
 * Recipes API (P4-01) — the ONLY module allowed to touch `menu_items`,
 * `recipe_ingredients`, and `unit_conversions`. All inputs are Zod-validated
 * before any client call; all outputs are Zod-validated before they reach
 * components.
 *
 * Ingredient quantities are stored for the FULL recipe yield in the chosen
 * `unit_id`. The unit must be the item's base unit or directly convertible
 * to it — the UI only offers convertible units (see `convertibleUnits` in
 * `@/lib/units`) and the database trigger rejects the rest.
 *
 * `restaurantId` for creates comes from the caller's auth profile
 * (`useAuth().profile`); RLS `WITH CHECK` enforces that it matches the
 * caller's JWT claims, so a forged id is rejected by the database.
 *
 * Staff have no RLS policies on these tables (recipes carry costs from
 * P4-02) — every staff query is denied by the database.
 */

export interface RecipeIngredient {
  id: string;
  itemId: string;
  itemName: string;
  /** The item's base unit symbol (for display next to the chosen unit). */
  baseUnitSymbol: string;
  quantity: number;
  unitId: string;
  unitSymbol: string;
  notes: string | null;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  yieldQuantity: number;
  yieldUnit: string;
  active: boolean;
  ingredientCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItemDetail extends MenuItem {
  ingredients: RecipeIngredient[];
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new Error("A menu item with this name already exists.");
  }
  return new Error(error.message);
}

const menuItemRowSchema = z.object({
  id: z.string(),
  restaurant_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  yield_quantity: z.coerce.number(),
  yield_unit: z.string(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const ingredientRowSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  quantity: z.coerce.number(),
  unit_id: z.string(),
  notes: z.string().nullable(),
  items: z.object({
    name: z.string(),
    units: z.object({ symbol: z.string() }),
  }),
  units: z.object({ symbol: z.string() }),
});

const conversionRowSchema = z.object({
  from_unit_id: z.string(),
  to_unit_id: z.string(),
  factor: z.coerce.number(),
});

function toMenuItem(
  row: z.infer<typeof menuItemRowSchema>,
  ingredientCount: number,
): MenuItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    yieldQuantity: row.yield_quantity,
    yieldUnit: row.yield_unit,
    active: row.active,
    ingredientCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toIngredient(
  row: z.infer<typeof ingredientRowSchema>,
): RecipeIngredient {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.items.name,
    baseUnitSymbol: row.items.units.symbol,
    quantity: row.quantity,
    unitId: row.unit_id,
    unitSymbol: row.units.symbol,
    notes: row.notes,
  };
}

/** List menu items with ingredient counts. */
export async function listMenuItems(
  rawInput: unknown,
): Promise<MenuItem[]> {
  const input: ListMenuItemsInput = listMenuItemsSchema.parse(rawInput);
  const client = getSupabaseClient();
  let query = client
    .from("menu_items")
    .select("*, recipe_ingredients(count)")
    .order("name");
  if (input.active !== undefined) {
    query = query.eq("active", input.active);
  }
  if (input.search) {
    query = query.ilike("name", `%${input.search}%`);
  }
  const { data, error } = await query;
  if (error) {
    throw friendlyError(error);
  }
  const rows = z
    .array(
      menuItemRowSchema.extend({
        recipe_ingredients: z.array(z.object({ count: z.coerce.number() })),
      }),
    )
    .parse(data);
  return rows.map((row) =>
    toMenuItem(row, row.recipe_ingredients[0]?.count ?? 0),
  );
}

/** One menu item with its ingredient lines. */
export async function getMenuItem(id: string): Promise<MenuItemDetail> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("menu_items")
    .select(
      "*, recipe_ingredients(id, item_id, quantity, unit_id, notes, items(name, units(symbol)), units(symbol))",
    )
    .eq("id", parsedId)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  const row = menuItemRowSchema
    .extend({ recipe_ingredients: z.array(ingredientRowSchema) })
    .parse(data);
  return {
    ...toMenuItem(row, row.recipe_ingredients.length),
    ingredients: row.recipe_ingredients.map(toIngredient),
  };
}

/** Create a menu item (dish). */
export async function createMenuItem(
  rawInput: unknown,
  restaurantId: string,
): Promise<MenuItem> {
  const input: CreateMenuItemInput = createMenuItemSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("menu_items")
    .insert({
      restaurant_id: restaurantId,
      name: input.name,
      description: input.description ?? null,
      yield_quantity: input.yieldQuantity,
      yield_unit: input.yieldUnit,
    })
    .select()
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toMenuItem(menuItemRowSchema.parse(data), 0);
}

/** Edit a menu item's header fields. */
export async function updateMenuItem(
  id: string,
  rawInput: unknown,
): Promise<MenuItem> {
  const parsedId = z.string().uuid().parse(id);
  const input: UpdateMenuItemInput = updateMenuItemSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("menu_items")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description ?? null,
      }),
      ...(input.yieldQuantity !== undefined && {
        yield_quantity: input.yieldQuantity,
      }),
      ...(input.yieldUnit !== undefined && { yield_unit: input.yieldUnit }),
    })
    .eq("id", parsedId)
    .select("*, recipe_ingredients(count)")
    .single();
  if (error) {
    throw friendlyError(error);
  }
  const row = menuItemRowSchema
    .extend({
      recipe_ingredients: z.array(z.object({ count: z.coerce.number() })),
    })
    .parse(data);
  return toMenuItem(row, row.recipe_ingredients[0]?.count ?? 0);
}

/** Archive a menu item (soft delete; recipes are history). */
export async function archiveMenuItem(id: string): Promise<void> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { error } = await client
    .from("menu_items")
    .update({ active: false })
    .eq("id", parsedId);
  if (error) {
    throw friendlyError(error);
  }
}

/** Add an ingredient line to a recipe. */
export async function addIngredient(
  menuItemId: string,
  rawInput: unknown,
  restaurantId: string,
): Promise<RecipeIngredient> {
  const parsedMenuItemId = z.string().uuid().parse(menuItemId);
  const input: RecipeIngredientInput =
    recipeIngredientInputSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("recipe_ingredients")
    .insert({
      restaurant_id: restaurantId,
      menu_item_id: parsedMenuItemId,
      item_id: input.itemId,
      quantity: input.quantity,
      unit_id: input.unitId,
      notes: input.notes ?? null,
    })
    .select(
      "id, item_id, quantity, unit_id, notes, items(name, units(symbol)), units(symbol)",
    )
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toIngredient(ingredientRowSchema.parse(data));
}

/** Edit an ingredient line. */
export async function updateIngredient(
  id: string,
  rawInput: unknown,
): Promise<RecipeIngredient> {
  const parsedId = z.string().uuid().parse(id);
  const input: RecipeIngredientInput =
    recipeIngredientInputSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("recipe_ingredients")
    .update({
      item_id: input.itemId,
      quantity: input.quantity,
      unit_id: input.unitId,
      notes: input.notes ?? null,
    })
    .eq("id", parsedId)
    .select(
      "id, item_id, quantity, unit_id, notes, items(name, units(symbol)), units(symbol)",
    )
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toIngredient(ingredientRowSchema.parse(data));
}

/** Remove an ingredient line. */
export async function removeIngredient(id: string): Promise<void> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { error } = await client
    .from("recipe_ingredients")
    .delete()
    .eq("id", parsedId);
  if (error) {
    throw friendlyError(error);
  }
}

/** All explicit unit conversions for the caller's restaurant. */
export async function listUnitConversions(): Promise<UnitConversion[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("unit_conversions")
    .select("from_unit_id, to_unit_id, factor");
  if (error) {
    throw friendlyError(error);
  }
  return z
    .array(conversionRowSchema)
    .parse(data)
    .map((row) => ({
      fromUnitId: row.from_unit_id,
      toUnitId: row.to_unit_id,
      factor: row.factor,
    }));
}
