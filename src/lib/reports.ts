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

/**
 * Revenue report math (V2-10). Pure functions — no I/O.
 *
 * Revenue is DESCRIPTIVE: Σ (dish qty sold × dish's current sale price).
 * Prices are the live operator-set values (P4-01), never snapshotted, so
 * historical sales are evaluated at today's prices — the UI states this
 * plainly. There is no refund concept in the ledger, so revenue is gross
 * of refunds. No recommended prices are computed here (pricing guardrail,
 * ARCHITECTURE.md §11).
 */

export interface RevenueDishSale {
  name: string;
  qty: number;
  /** IST calendar date (YYYY-MM-DD) of the sale movement's posting time. */
  date: string;
}

export interface RevenueDay {
  /** IST calendar date, YYYY-MM-DD. */
  date: string;
  /** ₹ revenue = Σ dish qty × live sale price. */
  revenue: number;
  /** ₹ food cost = Σ |sale_deduction qty| × avg_unit_cost. */
  foodCost: number;
  /**
   * (foodCost / revenue) × 100. Null when revenue is 0 — a gap in the
   * trend, never 0% (0% would claim free food).
   */
  foodCostPct: number | null;
}

export interface RevenueDishRow {
  name: string;
  qtySold: number;
  /** Null when the dish has no sale price set. */
  sellingPrice: number | null;
  /** qtySold × sellingPrice; 0 when the price is unknown. */
  revenue: number;
  /** revenue / totalRevenue; 0 when totalRevenue is 0. */
  share: number;
}

export interface UnpricedDishSale {
  name: string;
  qtySold: number;
}

export interface RevenueReport {
  /** One row per IST date with any sale activity, chronological. */
  days: RevenueDay[];
  /** One row per dish sold, sorted by revenue descending. */
  dishes: RevenueDishRow[];
  totalRevenue: number;
  totalFoodCost: number;
  /** (totalFoodCost / totalRevenue) × 100; null when totalRevenue is 0. */
  overallFoodCostPct: number | null;
  /** totalRevenue / daysInRange. */
  avgDailyRevenue: number;
  /**
   * Dishes sold without a sale price — excluded from revenue but never
   * dropped silently.
   */
  unpricedDishes: UnpricedDishSale[];
}

/**
 * Revenue aggregation: dish sales (parsed from `sale_deduction` notes)
 * valued at live sale prices, joined with daily food cost.
 *
 * @param sales per-dish quantities with their IST sale date
 * @param pricesByName live sale price per dish name (null = not set)
 * @param foodCostByDay daily ingredient cost keyed by IST date
 * @param daysInRange number of calendar days in the selected range
 *   (inclusive) — the denominator for avgDailyRevenue
 */
export function aggregateRevenue(
  sales: RevenueDishSale[],
  pricesByName: Map<string, number | null>,
  foodCostByDay: Map<string, number>,
  daysInRange: number,
): RevenueReport {
  const revenueByDay = new Map<string, number>();
  const qtyByDish = new Map<string, number>();
  const unpricedQty = new Map<string, number>();

  for (const sale of sales) {
    qtyByDish.set(sale.name, (qtyByDish.get(sale.name) ?? 0) + sale.qty);
    const price = pricesByName.get(sale.name) ?? null;
    if (price === null) {
      unpricedQty.set(sale.name, (unpricedQty.get(sale.name) ?? 0) + sale.qty);
      continue;
    }
    const lineRevenue = sale.qty * price;
    revenueByDay.set(sale.date, (revenueByDay.get(sale.date) ?? 0) + lineRevenue);
  }

  const totalRevenue = [...revenueByDay.values()].reduce((a, b) => a + b, 0);

  const dishes: RevenueDishRow[] = [...qtyByDish.entries()].map(
    ([name, qtySold]) => {
      const sellingPrice = pricesByName.get(name) ?? null;
      const revenue = sellingPrice === null ? 0 : qtySold * sellingPrice;
      return {
        name,
        qtySold,
        sellingPrice,
        revenue,
        share: totalRevenue > 0 ? revenue / totalRevenue : 0,
      };
    },
  );
  dishes.sort(
    (a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name),
  );

  const daySet = new Set<string>([
    ...revenueByDay.keys(),
    ...foodCostByDay.keys(),
  ]);
  const days: RevenueDay[] = [...daySet].sort().map((date) => {
    const revenue = revenueByDay.get(date) ?? 0;
    const foodCost = foodCostByDay.get(date) ?? 0;
    return {
      date,
      revenue,
      foodCost,
      foodCostPct: revenue > 0 ? (foodCost / revenue) * 100 : null,
    };
  });

  const totalFoodCost = [...foodCostByDay.values()].reduce(
    (a, b) => a + b,
    0,
  );

  const unpricedDishes: UnpricedDishSale[] = [...unpricedQty.entries()]
    .map(([name, qtySold]) => ({ name, qtySold }))
    .sort((a, b) => b.qtySold - a.qtySold || a.name.localeCompare(b.name));

  return {
    days,
    dishes,
    totalRevenue,
    totalFoodCost,
    overallFoodCostPct:
      totalRevenue > 0 ? (totalFoodCost / totalRevenue) * 100 : null,
    avgDailyRevenue: daysInRange > 0 ? totalRevenue / daysInRange : 0,
    unpricedDishes,
  };
}
