import { z } from "zod";

/**
 * Recipe schemas (P4-01). Client-side validation for menu items and their
 * ingredient lines. The `menu_items` / `recipe_ingredients` /
 * `unit_conversions` tables are the DB source of truth; these schemas
 * mirror their constraints so bad input never reaches the network. RLS
 * remains the real enforcement.
 *
 * Ingredient quantities are for the FULL recipe yield (not per serving),
 * expressed in `unitId`. The unit must be the item's base unit or directly
 * convertible to it — the UI only offers convertible units and the
 * database trigger rejects the rest.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name must be 120 characters or fewer.");

const positiveQuantity = (message: string) =>
  z.coerce.number().positive(message);

/**
 * Selling price in INR (P4-02). Optional on create: a recipe may exist
 * before pricing is set. A blank field stays unset (undefined); the
 * update schema maps blank to null so an existing price can be cleared.
 */
const createSellingPriceSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().positive("Selling price must be greater than zero.").optional(),
);

/** Create a menu item (dish). */
export const createMenuItemSchema = z.object({
  name: nameSchema,
  description: z
    .string()
    .trim()
    .max(1000, "Description must be 1000 characters or fewer.")
    .optional(),
  yieldQuantity: positiveQuantity("Yield must be greater than zero."),
  yieldUnit: z
    .string()
    .trim()
    .min(1, "Yield unit is required (e.g. servings).")
    .max(32, "Yield unit must be 32 characters or fewer."),
  sellingPrice: createSellingPriceSchema,
});

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;

/** Edit a menu item's header fields. */
export const updateMenuItemSchema = createMenuItemSchema.partial().extend({
  // Blank clears the selling price (→ NULL); a set value must stay > 0.
  sellingPrice: z
    .preprocess(
      (value) => (value === "" || value === undefined ? null : value),
      z.coerce
        .number()
        .positive("Selling price must be greater than zero.")
        .nullable(),
    )
    .optional(),
});

export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;

/** One ingredient line: inventory item + quantity for the full yield. */
export const recipeIngredientInputSchema = z.object({
  itemId: uuidSchema,
  quantity: positiveQuantity("Quantity must be greater than zero."),
  unitId: uuidSchema,
  notes: z
    .string()
    .trim()
    .max(500, "Ingredient notes must be 500 characters or fewer.")
    .optional(),
});

export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;

/** Query input for listing menu items. */
export const listMenuItemsSchema = z.object({
  search: z.string().trim().max(120).optional(),
  active: z.boolean().optional(),
});

export type ListMenuItemsInput = z.infer<typeof listMenuItemsSchema>;
