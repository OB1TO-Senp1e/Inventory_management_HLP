import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  computeStockValue,
  summarizeMovements,
  type MovementSummary,
} from "@/lib/dashboard";
import { startOfTodayIST } from "@/lib/datetime";
import { movementTypeSchema } from "@/schemas/stock";

/**
 * Dashboard API (P5-03). Owner/manager only at the route level — the staff
 * role never reaches these queries, so costs (avg_unit_cost, stock value,
 * value lost) stay invisible to staff, per the role matrix.
 *
 * Reads only: the `current_stock` view, `stock_movements`, and `items`
 * cost columns. No new DB objects — the low-stock and expiring-soon cards
 * reuse `listStockOverview()` directly (same data and predicates as the
 * /stock page, so the counts always match).
 */

const todayMovementRowSchema = z.object({
  item_id: z.string().uuid(),
  movement_type: movementTypeSchema,
  quantity: z.coerce.number(),
});

const itemCostRowSchema = z.object({
  id: z.string().uuid(),
  avg_unit_cost: z.coerce.number().nullable(),
});

const currentStockRowSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z.coerce.number(),
});

export interface DashboardSummary {
  usage: MovementSummary;
  wastage: MovementSummary;
  /** ₹ total stock value = Σ current qty × avg_unit_cost. */
  stockValue: number;
}

/**
 * Today's usage/wastage totals plus total stock value. "Today" is the
 * Asia/Kolkata day boundary; quantities are absolute (deductions are
 * stored negative) and values use each item's average unit cost.
 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const client = getSupabaseClient();
  const [movementsRes, costsRes, stockRes] = await Promise.all([
    client
      .from("stock_movements")
      .select("item_id, movement_type, quantity")
      .in("movement_type", ["usage", "wastage"])
      .gte("created_at", startOfTodayIST()),
    client.from("items").select("id, avg_unit_cost").eq("active", true),
    client.from("current_stock").select("item_id, quantity"),
  ]);
  if (movementsRes.error) {
    throw new Error(movementsRes.error.message);
  }
  if (costsRes.error) {
    throw new Error(costsRes.error.message);
  }
  if (stockRes.error) {
    throw new Error(stockRes.error.message);
  }

  const movements = z.array(todayMovementRowSchema).parse(movementsRes.data);
  const costs = z.array(itemCostRowSchema).parse(costsRes.data);
  const stock = z.array(currentStockRowSchema).parse(stockRes.data);

  const costsByItem = new Map(
    costs.map((row) => [row.id, row.avg_unit_cost]),
  );

  return {
    usage: summarizeMovements(
      movements.map((m) => ({
        itemId: m.item_id,
        movementType: m.movement_type,
        quantity: m.quantity,
      })),
      costsByItem,
      "usage",
    ),
    wastage: summarizeMovements(
      movements.map((m) => ({
        itemId: m.item_id,
        movementType: m.movement_type,
        quantity: m.quantity,
      })),
      costsByItem,
      "wastage",
    ),
    stockValue: computeStockValue(
      stock.map((s) => ({ itemId: s.item_id, quantity: s.quantity })),
      costsByItem,
    ),
  };
}
