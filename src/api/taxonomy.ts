import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createTaxonomySchema,
  updateTaxonomySchema,
  type CreateTaxonomyInput,
  type UpdateTaxonomyInput,
} from "@/schemas/taxonomy";

/**
 * Taxonomy API — the ONLY module allowed to write to `item_categories` and
 * `storage_locations` (the item form reads them through `src/api/items.ts`
 * lookups). All inputs are Zod-validated before any client call; all outputs
 * are Zod-validated before they reach components.
 *
 * Delete semantics (P1-02): a hard delete is blocked when the row is still
 * referenced by items — the database enforces this via ON DELETE RESTRICT
 * (see migration 20261004160900), and the API pre-checks the referencing
 * item count to surface a friendly "in use by N items" message before even
 * attempting the delete. Archiving (active=false) is always available as
 * the soft path and is what the UI offers for in-use rows.
 *
 * `restaurantId` for creates comes from the caller's auth profile
 * (`useAuth().profile`); RLS `WITH CHECK` enforces that it matches the
 * caller's JWT claims, so a forged id is rejected by the database.
 */

export interface TaxonomyItem {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const taxonomyRowSchema = z.object({
  id: z.string(),
  restaurant_id: z.string(),
  name: z.string(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

type TaxonomyRow = z.infer<typeof taxonomyRowSchema>;

const TAXONOMY_SELECT = "id, restaurant_id, name, active, created_at, updated_at";

function toTaxonomyItem(row: TaxonomyRow): TaxonomyItem {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new Error("An entry with this name already exists.");
  }
  if (error.code === "23503") {
    // Belt and braces: the pre-check in deleteCategory/deleteLocation should
    // catch this first, but a concurrent item create could win the race.
    return new Error(
      "This entry is still used by items and cannot be deleted. Archive it instead.",
    );
  }
  return new Error(error.message);
}

type TaxonomyTable = "item_categories" | "storage_locations";

/** List entries; `active` defaults to true (archived hidden unless requested). */
async function listTaxonomy(
  table: TaxonomyTable,
  active: boolean = true,
): Promise<TaxonomyItem[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .select(TAXONOMY_SELECT)
    .eq("active", active)
    .order("name");
  if (error) {
    throw friendlyError(error);
  }
  return z.array(taxonomyRowSchema).parse(data).map(toTaxonomyItem);
}

/** Create an entry. `restaurantId` must come from the caller's auth profile. */
async function createTaxonomy(
  table: TaxonomyTable,
  rawInput: unknown,
): Promise<TaxonomyItem> {
  const parsed: CreateTaxonomyInput = createTaxonomySchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .insert({ restaurant_id: parsed.restaurantId, name: parsed.name })
    .select(TAXONOMY_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toTaxonomyItem(taxonomyRowSchema.parse(data));
}

/** Rename an entry. */
async function updateTaxonomy(
  table: TaxonomyTable,
  id: string,
  rawInput: unknown,
): Promise<TaxonomyItem> {
  const parsedId = z.string().uuid().parse(id);
  const parsed: UpdateTaxonomyInput = updateTaxonomySchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .update({ name: parsed.name })
    .eq("id", parsedId)
    .select(TAXONOMY_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toTaxonomyItem(taxonomyRowSchema.parse(data));
}

/** Archive an entry (soft delete: active=false). */
async function archiveTaxonomy(
  table: TaxonomyTable,
  id: string,
): Promise<TaxonomyItem> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .update({ active: false })
    .eq("id", parsedId)
    .select(TAXONOMY_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toTaxonomyItem(taxonomyRowSchema.parse(data));
}

/**
 * Count items referencing a taxonomy row. Used by the UI to show
 * "in use by N items" and to decide whether hard delete is offered.
 * RLS scopes the count to the caller's restaurant.
 */
async function countReferencingItems(
  column: "category_id" | "storage_location_id",
  id: string,
): Promise<number> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { count, error } = await client
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq(column, parsedId);
  if (error) {
    throw friendlyError(error);
  }
  return count ?? 0;
}

/**
 * Hard-delete an entry. Refuses (with a friendly message) when items still
 * reference it — the database RESTRICT is the final enforcer.
 */
async function deleteTaxonomy(
  table: TaxonomyTable,
  column: "category_id" | "storage_location_id",
  noun: string,
  id: string,
): Promise<void> {
  const parsedId = z.string().uuid().parse(id);
  const inUse = await countReferencingItems(column, parsedId);
  if (inUse > 0) {
    throw new Error(
      `Cannot delete this ${noun}: it is still used by ${inUse} item${inUse === 1 ? "" : "s"}. Archive it instead.`,
    );
  }
  const client = getSupabaseClient();
  const { error } = await client.from(table).delete().eq("id", parsedId);
  if (error) {
    throw friendlyError(error);
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Item categories for the settings screen and pickers. */
export function listCategories(active: boolean = true): Promise<TaxonomyItem[]> {
  return listTaxonomy("item_categories", active);
}

/** Create an item category. `restaurantId` must come from the auth profile. */
export function createCategory(rawInput: unknown): Promise<TaxonomyItem> {
  return createTaxonomy("item_categories", rawInput);
}

/** Rename an item category. */
export function updateCategory(
  id: string,
  rawInput: unknown,
): Promise<TaxonomyItem> {
  return updateTaxonomy("item_categories", id, rawInput);
}

/** Archive an item category (soft delete). */
export function archiveCategory(id: string): Promise<TaxonomyItem> {
  return archiveTaxonomy("item_categories", id);
}

/** Hard-delete an item category; blocked with a friendly error when in use. */
export function deleteCategory(id: string): Promise<void> {
  return deleteTaxonomy("item_categories", "category_id", "category", id);
}

/** How many items reference this category (for the "in use" affordance). */
export function countCategoryItems(id: string): Promise<number> {
  return countReferencingItems("category_id", id);
}

// ---------------------------------------------------------------------------
// Storage locations
// ---------------------------------------------------------------------------

/** Storage locations for the settings screen and pickers. */
export function listLocations(active: boolean = true): Promise<TaxonomyItem[]> {
  return listTaxonomy("storage_locations", active);
}

/** Create a storage location. `restaurantId` must come from the auth profile. */
export function createLocation(rawInput: unknown): Promise<TaxonomyItem> {
  return createTaxonomy("storage_locations", rawInput);
}

/** Rename a storage location. */
export function updateLocation(
  id: string,
  rawInput: unknown,
): Promise<TaxonomyItem> {
  return updateTaxonomy("storage_locations", id, rawInput);
}

/** Archive a storage location (soft delete). */
export function archiveLocation(id: string): Promise<TaxonomyItem> {
  return archiveTaxonomy("storage_locations", id);
}

/** Hard-delete a storage location; blocked with a friendly error when in use. */
export function deleteLocation(id: string): Promise<void> {
  return deleteTaxonomy(
    "storage_locations",
    "storage_location_id",
    "location",
    id,
  );
}

/** How many items reference this location (for the "in use" affordance). */
export function countLocationItems(id: string): Promise<number> {
  return countReferencingItems("storage_location_id", id);
}
