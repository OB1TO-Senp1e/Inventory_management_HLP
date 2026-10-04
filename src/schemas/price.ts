import { z } from "zod";

/**
 * Price-list schemas (P1-04). Client-side validation for the
 * `supplier_prices` table. The DB is the source of truth (unit_price > 0
 * check, per-pair uniqueness, one-preferred-per-item partial index); these
 * schemas mirror those constraints so bad input never reaches the network.
 * RLS remains the real enforcement.
 *
 * Money travels as a number through the client (the DB stores numeric).
 * The form coerces text input; no arithmetic is done client-side — the
 * display layer formats with `formatINR`.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

const unitPriceSchema = z.coerce
  .number({ invalid_type_error: "Enter a price." })
  .gt(0, "Price must be greater than zero.")
  .max(1_000_000_000, "That price is too large.");

/** Shared price field schema (reused by the price dialog form). */
export { unitPriceSchema };

export const upsertPriceSchema = z.object({
  restaurantId: uuidSchema,
  supplierId: uuidSchema,
  itemId: uuidSchema,
  unitPrice: unitPriceSchema,
});
export type UpsertPriceInput = z.infer<typeof upsertPriceSchema>;

export const setPreferredSupplierSchema = z.object({
  itemId: uuidSchema,
  supplierId: uuidSchema,
});
export type SetPreferredSupplierInput = z.infer<
  typeof setPreferredSupplierSchema
>;

export const listPricesBySupplierSchema = z.object({
  supplierId: uuidSchema,
});
export type ListPricesBySupplierInput = z.infer<
  typeof listPricesBySupplierSchema
>;

export const listPricesByItemSchema = z.object({
  itemId: uuidSchema,
});
export type ListPricesByItemInput = z.infer<typeof listPricesByItemSchema>;

export const listPriceHistorySchema = z.object({
  supplierId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
});
export type ListPriceHistoryInput = z.infer<typeof listPriceHistorySchema>;
