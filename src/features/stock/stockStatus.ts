import type { StockOverviewRow } from "@/api/stock";
import { expiryStatus } from "@/lib/expiry";

/**
 * Stock status predicates shared by the stock overview page and the
 * dashboard (P5-03). The definitions live here — not duplicated per
 * screen — so the dashboard's low-stock / expiring-soon counts always
 * match what the /stock filters show.
 */

/** Low stock = on-hand quantity at or below the reorder point. */
export function isLowStock(row: StockOverviewRow): boolean {
  return row.quantity <= row.reorderPoint;
}

/**
 * Expiring = the item's earliest stocked batch is expiring soon or already
 * expired (same definition as the /stock "Expiring soon" filter).
 */
export function isExpiring(row: StockOverviewRow): boolean {
  const status = expiryStatus(row.earliestExpiry);
  return status === "soon" || status === "expired";
}
