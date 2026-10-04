import { z } from "zod";

/**
 * Taxonomy schemas (P1-02): item categories and storage locations.
 * Both tables share the same shape (name + active flag), so one schema set
 * covers both. The `item_categories` / `storage_locations` tables are the DB
 * source of truth; these schemas mirror their constraints (name length,
 * per-restaurant uniqueness is enforced by the DB) so bad input never
 * reaches the network. RLS remains the real enforcement.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

const taxonomyNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(120, "Name must be 120 characters or fewer.");

export const createTaxonomySchema = z.object({
  restaurantId: uuidSchema,
  name: taxonomyNameSchema,
});
export type CreateTaxonomyInput = z.infer<typeof createTaxonomySchema>;

export const updateTaxonomySchema = z.object({
  name: taxonomyNameSchema,
});
export type UpdateTaxonomyInput = z.infer<typeof updateTaxonomySchema>;
