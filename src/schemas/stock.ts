import { z } from "zod";

/**
 * Stock ledger schemas (P2-01). Client-side validation for the append-only
 * `stock_movements` ledger and the `create_opening_balance` RPC.
 *
 * Signed-quantity rule (mirrors the DB): quantities are NUMERIC, never float,
 * and zero is meaningless — a movement must move stock. The RPC takes only
 * positive quantities (it always adds stock); other movement types
 * (P2-02/P2-03) sign their quantities explicitly.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

const positiveQuantitySchema = z.coerce
  .number({ invalid_type_error: "Enter a number." })
  .positive("Quantity must be greater than zero.")
  .max(1_000_000_000, "That number is too large.");

const unitCostSchema = z.coerce
  .number({ invalid_type_error: "Enter a number." })
  .min(0, "Unit cost cannot be negative.")
  .max(1_000_000_000, "That number is too large.");

export const createOpeningBalanceSchema = z.object({
  itemId: uuidSchema,
  quantity: positiveQuantitySchema,
  unitCost: unitCostSchema,
});
export type CreateOpeningBalanceInput = z.infer<
  typeof createOpeningBalanceSchema
>;

export const getCurrentStockSchema = z.object({
  itemId: uuidSchema,
});
export type GetCurrentStockInput = z.infer<typeof getCurrentStockSchema>;

/**
 * Ad hoc goods receiving (P2-02). One receipt = one `receive_goods` RPC call
 * with 1..N lines. Quantities are in the item's BASE UNIT (unit conversion
 * lands in P2-05 — the UI labels every quantity field with the base unit).
 * Empty optional strings from the form are normalized to undefined.
 */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const todayIso = () => new Date().toISOString().slice(0, 10);

export const receiveGoodsLineSchema = z.object({
  itemId: uuidSchema,
  quantity: positiveQuantitySchema,
  unitCost: unitCostSchema,
  batchNo: blankToUndefined(
    z.string().trim().max(80, "Batch no. must be 80 characters or fewer."),
  ),
  expiryDate: blankToUndefined(
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry must look like YYYY-MM-DD.")
      .refine((d) => d >= todayIso(), "Expiry cannot be in the past."),
  ),
  notes: blankToUndefined(
    z.string().trim().max(500, "Notes must be 500 characters or fewer."),
  ),
});
export type ReceiveGoodsLineInput = z.infer<typeof receiveGoodsLineSchema>;

export const receiveGoodsSchema = z.object({
  lines: z
    .array(receiveGoodsLineSchema)
    .min(1, "Add at least one line to the receipt."),
});
export type ReceiveGoodsInput = z.infer<typeof receiveGoodsSchema>;
