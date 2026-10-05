import { z } from "zod";

/**
 * Stock count schemas (P5-01). Mirrors the `stock_counts` / `stock_count_lines`
 * tables (migration 20261005090000). The `create_stock_count` RPC takes the
 * title + assignee; `expected_qty` is snapshotted server-side from
 * `current_stock`, never sent by the client.
 */

export const stockCountStatusSchema = z.enum([
  "draft",
  "in_progress",
  "submitted",
]);
export type StockCountStatus = z.infer<typeof stockCountStatusSchema>;

export const createStockCountSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the count a title.")
    .max(200, "Title is too long (max 200 characters)."),
  /**
   * profiles.id (= auth user id) of the assignee. null/undefined means
   * unassigned. The RPC verifies the profile belongs to this restaurant.
   * The form's "Unassigned" option submits an empty string, coerced to
   * null here.
   */
  assignedTo: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().uuid().nullable().optional(),
  ),
});
export type CreateStockCountInput = z.infer<typeof createStockCountSchema>;

/**
 * One counted-quantity save. `countedQty: null` clears the line back to
 * "not counted". The component converts an empty input to null before
 * parsing (z.coerce.number would turn "" into 0 — wrong).
 */
export const saveCountLineSchema = z.object({
  countId: z.string().uuid(),
  itemId: z.string().uuid(),
  countedQty: z.number().min(0, "Quantity can't be negative.").nullable(),
});
export type SaveCountLineInput = z.infer<typeof saveCountLineSchema>;
