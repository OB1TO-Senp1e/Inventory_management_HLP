import { z } from "zod";

/**
 * Item schemas (P1-01). Client-side validation for the items catalog.
 * The `items` table itself is the DB source of truth; these schemas mirror
 * its constraints (name length, non-negative levels, FK uuids) so bad
 * input never reaches the network. RLS remains the real enforcement.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter an item name.")
  .max(200, "Name must be 200 characters or fewer.");

const quantitySchema = z.coerce
  .number({ invalid_type_error: "Enter a number." })
  .min(0, "Cannot be negative.")
  .max(1_000_000_000, "That number is too large.");

/**
 * Optional product barcode (V2-01). Any supplier label code — EAN-13, UPC,
 * Code 128, or a keyboard-wedge typed code. Blank becomes null (no
 * barcode); the DB enforces uniqueness per restaurant.
 */
const barcodeSchema = z
  .string()
  .trim()
  .max(64, "Barcode must be 64 characters or fewer.")
  .nullable()
  .optional();

export const itemSortColumnSchema = z.enum([
  "name",
  "par_level",
  "reorder_point",
  "created_at",
]);
export type ItemSortColumn = z.infer<typeof itemSortColumnSchema>;

export const createItemSchema = z.object({
  restaurantId: uuidSchema,
  name: nameSchema,
  categoryId: uuidSchema.nullable().optional(),
  unitId: z
    .string({
      required_error: "Choose a unit.",
      invalid_type_error: "Choose a unit.",
    })
    .min(1, "Choose a unit.")
    .uuid("Choose a unit."),
  storageLocationId: uuidSchema.nullable().optional(),
  parLevel: quantitySchema,
  reorderPoint: quantitySchema,
  barcode: barcodeSchema,
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = createItemSchema
  .omit({ restaurantId: true })
  .partial();
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const listItemsInputSchema = z.object({
  search: z.string().trim().max(200).optional(),
  categoryId: uuidSchema.optional(),
  active: z.boolean().optional(),
  sortColumn: itemSortColumnSchema.default("name"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ListItemsInput = z.infer<typeof listItemsInputSchema>;
/** Pre-defaults input shape, for hook/component props. */
export type ListItemsQuery = z.input<typeof listItemsInputSchema>;

/**
 * Barcode lookup input (V2-01). The same code can arrive from the camera
 * scanner, a keyboard wedge (typed + Enter), or paste — all of them go
 * through this schema before the RPC call.
 */
export const findItemByBarcodeSchema = z.object({
  barcode: z
    .string()
    .trim()
    .min(1, "Enter or scan a barcode.")
    .max(64, "Barcode must be 64 characters or fewer."),
});
export type FindItemByBarcodeInput = z.infer<typeof findItemByBarcodeSchema>;
