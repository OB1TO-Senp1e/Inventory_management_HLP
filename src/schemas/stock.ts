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
