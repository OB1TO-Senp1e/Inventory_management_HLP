import { toISTDateString } from "@/lib/datetime";

/**
 * Pure report math (P5-04). The API layer fetches raw rows; everything
 * below is unit-testable aggregation with no I/O. Costs are each item's
 * average unit cost (the same cost basis the dashboard uses); items
 * without a recorded cost contribute ₹0.
 */

export interface ReportMovement {
  itemId: string;
  itemName: string;
  unitSymbol: string;
  movementType: string;
  /** Signed ledger quantity (negative for deductions). */
  quantity: number;
  /** Closed-set reason code; set only on wastage movements. */
  reasonCode: string | null;
  /** timestamptz ISO string, bucketed on the IST calendar date. */
  createdAt: string;
}

export interface UsageRow {
  itemId: string;
  itemName: string;
  unitSymbol: string;
  movementType: string;
  lines: number;
  /** Total absolute quantity, in base units. */
  quantity: number;
  /** ₹ value = Σ |qty| × avg_unit_cost. */
  value: number;
}

/**
 * Usage report aggregation: `usage` (kitchen use, staff meals, tastings)
 * and `sale_deduction` (ingredients sold via recipes) movements, grouped
 * per item and movement type so the two stay distinguishable.
 */
export function aggregateUsage(
  movements: ReportMovement[],
  costsByItem: Map<string, number | null>,
): UsageRow[] {
  const byKey = new Map<string, UsageRow>();
  for (const m of movements) {
    if (m.movementType !== "usage" && m.movementType !== "sale_deduction") {
      continue;
    }
    const key = `${m.itemId}|${m.movementType}`;
    const qty = Math.abs(m.quantity);
    const existing = byKey.get(key);
    if (existing) {
      existing.lines += 1;
      existing.quantity += qty;
      existing.value += qty * (costsByItem.get(m.itemId) ?? 0);
    } else {
      byKey.set(key, {
        itemId: m.itemId,
        itemName: m.itemName,
        unitSymbol: m.unitSymbol,
        movementType: m.movementType,
        lines: 1,
        quantity: qty,
        value: qty * (costsByItem.get(m.itemId) ?? 0),
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.value - a.value ||
      a.itemName.localeCompare(b.itemName) ||
      a.movementType.localeCompare(b.movementType),
  );
}

export interface WastageReasonRow {
  reasonCode: string;
  lines: number;
  /** Total absolute quantity, in base units (mixed units across items). */
  quantity: number;
  /** ₹ value lost = Σ |qty| × avg_unit_cost. */
  value: number;
}

/** Wastage-by-reason aggregation: `wastage` movements grouped by the closed-set reason code. */
export function aggregateWastageByReason(
  movements: ReportMovement[],
  costsByItem: Map<string, number | null>,
): WastageReasonRow[] {
  const byReason = new Map<string, WastageReasonRow>();
  for (const m of movements) {
    if (m.movementType !== "wastage") {
      continue;
    }
    const reason = m.reasonCode ?? "other_wastage";
    const qty = Math.abs(m.quantity);
    const existing = byReason.get(reason);
    if (existing) {
      existing.lines += 1;
      existing.quantity += qty;
      existing.value += qty * (costsByItem.get(m.itemId) ?? 0);
    } else {
      byReason.set(reason, {
        reasonCode: reason,
        lines: 1,
        quantity: qty,
        value: qty * (costsByItem.get(m.itemId) ?? 0),
      });
    }
  }
  return [...byReason.values()].sort(
    (a, b) => b.value - a.value || a.reasonCode.localeCompare(b.reasonCode),
  );
}

export interface FoodCostDay {
  /** IST calendar date, YYYY-MM-DD. */
  date: string;
  /** ₹ cost of ingredients sold that day (sale_deduction × avg_unit_cost). */
  foodCost: number;
}

/**
 * Food-cost trend: daily ₹ cost of `sale_deduction` movements, bucketed on
 * the IST calendar date. This is the ingredient cost of dishes sold — v1
 * has no POS, so revenue (and hence a daily food-cost %) is not captured;
 * the live food-cost % per dish stays on /recipes (P4-02).
 */
export function aggregateFoodCostByDay(
  movements: ReportMovement[],
  costsByItem: Map<string, number | null>,
): FoodCostDay[] {
  const byDay = new Map<string, number>();
  for (const m of movements) {
    if (m.movementType !== "sale_deduction") {
      continue;
    }
    const date = toISTDateString(m.createdAt);
    const cost = Math.abs(m.quantity) * (costsByItem.get(m.itemId) ?? 0);
    byDay.set(date, (byDay.get(date) ?? 0) + cost);
  }
  return [...byDay.entries()]
    .map(([date, foodCost]) => ({ date, foodCost }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface PriceChangeEvent {
  supplierId: string;
  supplierName: string;
  itemId: string;
  itemName: string;
  /** null on the very first recorded price (no previous price). */
  oldPrice: number | null;
  newPrice: number | null;
  /** timestamptz ISO string. */
  changedAt: string;
}

export interface PriceChangeSummary {
  supplierId: string;
  supplierName: string;
  itemId: string;
  itemName: string;
  /** Number of change events in the range. */
  changes: number;
  /** Earliest recorded price in the range (may be null on first set). */
  firstOldPrice: number | null;
  /** Latest recorded price in the range. */
  lastNewPrice: number | null;
  /** % change from first old to last new; null when not computable. */
  changePct: number | null;
}

/** % change for one price event; null when either side is missing or the old price is 0. */
export function priceChangePct(
  oldPrice: number | null,
  newPrice: number | null,
): number | null {
  if (oldPrice === null || newPrice === null || oldPrice === 0) {
    return null;
  }
  return ((newPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Supplier price-change summary: per (supplier, item) pair, the net %
 * change from the first recorded old price to the last recorded new
 * price within the range. Events must arrive newest-first (the
 * `listPriceHistory` order); the summary is chronological inside.
 */
export function aggregatePriceChanges(
  events: PriceChangeEvent[],
): PriceChangeSummary[] {
  const byPair = new Map<string, PriceChangeEvent[]>();
  for (const event of events) {
    const key = `${event.supplierId}|${event.itemId}`;
    const list = byPair.get(key);
    if (list) {
      list.push(event);
    } else {
      byPair.set(key, [event]);
    }
  }
  const summaries: PriceChangeSummary[] = [];
  for (const list of byPair.values()) {
    const chronological = [...list].sort((a, b) =>
      a.changedAt.localeCompare(b.changedAt),
    );
    const first = chronological[0];
    const last = chronological[chronological.length - 1];
    summaries.push({
      supplierId: first.supplierId,
      supplierName: first.supplierName,
      itemId: first.itemId,
      itemName: first.itemName,
      changes: chronological.length,
      firstOldPrice: first.oldPrice,
      lastNewPrice: last.newPrice,
      changePct: priceChangePct(first.oldPrice, last.newPrice),
    });
  }
  return summaries.sort(
    (a, b) =>
      Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0) ||
      a.itemName.localeCompare(b.itemName),
  );
}
