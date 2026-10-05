/**
 * Recipe costing math (P4-02). Pure functions — no I/O, no Supabase.
 *
 * Cost basis is `items.avg_unit_cost` (the same weighted-average cost the
 * stock overview uses; maintained by the receiving RPCs in P2-02). There
 * is no new cost pipeline: these functions only DERIVE cost from live
 * data, so the cost per dish updates automatically whenever ingredient
 * costs change.
 *
 * Ingredient quantities are for the FULL recipe yield (P4-01). Each line
 * is converted to the item's base unit with the direct (one-hop)
 * conversions from `src/lib/units.ts` — the same rule the database
 * trigger enforces, mirrored by the `menu_item_costs` view.
 */

import { convertQuantity, type UnitConversion } from "./units";

/** One ingredient line with the fields needed to cost it. */
export interface CostedIngredient {
  /** Quantity for the full recipe yield, in `unitId`. */
  quantity: number;
  /** The unit the quantity is expressed in. */
  unitId: string;
  /** The inventory item's base unit. */
  itemBaseUnitId: string;
  /** The item's current weighted-average cost per base unit (INR). */
  avgUnitCost: number;
}

/**
 * Total ingredient cost for the FULL recipe yield in INR.
 * Returns null when a line cannot be converted to the item's base unit
 * (defensive — the builder only offers convertible units and the DB
 * trigger rejects the rest, so this should not happen with saved data).
 */
export function totalIngredientCost(
  lines: CostedIngredient[],
  conversions: UnitConversion[],
): number | null {
  let total = 0;
  for (const line of lines) {
    const qtyInBaseUnit = convertQuantity(
      line.quantity,
      line.unitId,
      line.itemBaseUnitId,
      conversions,
    );
    if (qtyInBaseUnit === null) {
      return null;
    }
    total += qtyInBaseUnit * line.avgUnitCost;
  }
  return total;
}

/**
 * Cost per dish: the total ingredient cost for the full yield divided by
 * the recipe's yield quantity.
 */
export function costPerDish(
  totalCost: number,
  yieldQuantity: number,
): number {
  return totalCost / yieldQuantity;
}

/**
 * Food-cost % = cost per dish / selling price × 100.
 * Returns null when no selling price is set — the UI shows "—" instead.
 */
export function foodCostPct(
  dishCost: number,
  sellingPrice: number | null,
): number | null {
  if (sellingPrice === null || sellingPrice <= 0) {
    return null;
  }
  return (dishCost / sellingPrice) * 100;
}
