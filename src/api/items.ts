import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createItemSchema,
  listItemsInputSchema,
  updateItemSchema,
  type CreateItemInput,
  type ListItemsInput,
  type UpdateItemInput,
} from "@/schemas/item";

/**
 * Items API — the ONLY module allowed to touch the `items` table (plus the
 * lookup tables the item form needs: `item_categories`, `storage_locations`,
 * `units`). All inputs are Zod-validated before any client call; all outputs
 * are Zod-validated before they reach components. No network calls happen
 * with unvalidated input.
 *
 * `restaurantId` for creates comes from the caller's auth profile
 * (`useAuth().profile`); RLS `WITH CHECK` enforces that it matches the
 * caller's JWT claims, so a forged id is rejected by the database.
 */

export interface Item {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string;
  unitName: string;
  unitSymbol: string;
  storageLocationId: string | null;
  storageLocationName: string | null;
  parLevel: number;
  reorderPoint: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LookupOption {
  id: string;
  name: string;
  symbol?: string;
}

export interface ListItemsResult {
  items: Item[];
  total: number;
}

const ITEM_SELECT =
  "*, item_categories(name), units(name, symbol), storage_locations(name)";

const itemRowSchema = z.object({
  id: z.string(),
  restaurant_id: z.string(),
  name: z.string(),
  category_id: z.string().nullable(),
  unit_id: z.string(),
  storage_location_id: z.string().nullable(),
  par_level: z.coerce.number(),
  reorder_point: z.coerce.number(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  item_categories: z.object({ name: z.string() }).nullable(),
  units: z.object({ name: z.string(), symbol: z.string() }),
  storage_locations: z.object({ name: z.string() }).nullable(),
});

type ItemRow = z.infer<typeof itemRowSchema>;

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.item_categories?.name ?? null,
    unitId: row.unit_id,
    unitName: row.units.name,
    unitSymbol: row.units.symbol,
    storageLocationId: row.storage_location_id,
    storageLocationName: row.storage_locations?.name ?? null,
    parLevel: row.par_level,
    reorderPoint: row.reorder_point,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Escape PostgREST LIKE wildcards in a user search term. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new Error("An item with this name already exists.");
  }
  return new Error(error.message);
}

/**
 * List items with server-side search, filters, sorting and pagination.
 * `active` defaults to true (archived items are hidden unless requested).
 */
export async function listItems(rawInput: unknown): Promise<ListItemsResult> {
  const input: ListItemsInput = listItemsInputSchema.parse(rawInput);
  const client = getSupabaseClient();
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  let query = client
    .from("items")
    .select(ITEM_SELECT, { count: "exact" });
  query = query.eq("active", input.active ?? true);
  if (input.categoryId) {
    query = query.eq("category_id", input.categoryId);
  }
  if (input.search) {
    query = query.ilike("name", `%${escapeLike(input.search)}%`);
  }
  query = query.order(input.sortColumn, {
    ascending: input.sortDirection === "asc",
  });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw friendlyError(error);
  }
  const rows = z.array(itemRowSchema).parse(data);
  return { items: rows.map(toItem), total: count ?? rows.length };
}

/** Fetch a single item by id (used by the edit dialog). */
export async function getItem(id: string): Promise<Item> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("items")
    .select(ITEM_SELECT)
    .eq("id", parsedId)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toItem(itemRowSchema.parse(data));
}

/** Create an item. `restaurantId` must come from the caller's auth profile. */
export async function createItem(rawInput: unknown): Promise<Item> {
  const parsed: CreateItemInput = createItemSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("items")
    .insert({
      restaurant_id: parsed.restaurantId,
      name: parsed.name,
      category_id: parsed.categoryId ?? null,
      unit_id: parsed.unitId,
      storage_location_id: parsed.storageLocationId ?? null,
      par_level: parsed.parLevel,
      reorder_point: parsed.reorderPoint,
    })
    .select(ITEM_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toItem(itemRowSchema.parse(data));
}

/** Update an item's editable fields. Archiving goes through `archiveItem`. */
export async function updateItem(id: string, rawInput: unknown): Promise<Item> {
  const parsedId = z.string().uuid().parse(id);
  const parsed: UpdateItemInput = updateItemSchema.parse(rawInput);
  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) patch["name"] = parsed.name;
  if (parsed.categoryId !== undefined) patch["category_id"] = parsed.categoryId;
  if (parsed.unitId !== undefined) patch["unit_id"] = parsed.unitId;
  if (parsed.storageLocationId !== undefined)
    patch["storage_location_id"] = parsed.storageLocationId;
  if (parsed.parLevel !== undefined) patch["par_level"] = parsed.parLevel;
  if (parsed.reorderPoint !== undefined)
    patch["reorder_point"] = parsed.reorderPoint;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("items")
    .update(patch)
    .eq("id", parsedId)
    .select(ITEM_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toItem(itemRowSchema.parse(data));
}

/**
 * Archive an item (soft delete: `active=false`). Items are never
 * hard-deleted — stock history must keep resolving item names.
 */
export async function archiveItem(id: string): Promise<Item> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("items")
    .update({ active: false })
    .eq("id", parsedId)
    .select(ITEM_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toItem(itemRowSchema.parse(data));
}

const categoryRowSchema = z.object({ id: z.string(), name: z.string() });
const unitRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
});

/** Categories for the item form dropdown (active only; RLS scopes to the restaurant). */
export async function listItemCategories(): Promise<LookupOption[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("item_categories")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) {
    throw friendlyError(error);
  }
  return z.array(categoryRowSchema).parse(data);
}

/** Storage locations for the item form dropdown (active only). */
export async function listStorageLocations(): Promise<LookupOption[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("storage_locations")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) {
    throw friendlyError(error);
  }
  return z.array(categoryRowSchema).parse(data);
}

/** Units for the item form dropdown (symbol shown next to quantities). */
export async function listUnits(): Promise<LookupOption[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("units")
    .select("id, name, symbol")
    .order("name");
  if (error) {
    throw friendlyError(error);
  }
  return z
    .array(unitRowSchema)
    .parse(data)
    .map((u) => ({ id: u.id, name: u.name, symbol: u.symbol }));
}
