import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import { endOfDayIST, startOfDayIST } from "@/lib/datetime";
import {
  aggregateFoodCostByDay,
  aggregatePriceChanges,
  aggregateUsage,
  aggregateWastageByReason,
  priceChangePct,
  type FoodCostDay,
  type PriceChangeEvent,
  type PriceChangeSummary,
  type ReportMovement,
  type UsageRow,
  type WastageReasonRow,
} from "@/lib/reports";
import {
  buildMenuEngineeringReport,
  parseSaleNotes,
  type MenuEngineeringReport,
} from "@/lib/menuEngineering";
import { listPriceHistory } from "./prices";
import { listMenuItems } from "./recipes";
import { reportRangeSchema, type ReportRange } from "@/schemas/reports";

/**
 * Reports API (P5-04). Owner/manager only at the route level — the staff
 * role never reaches these queries, so costs stay invisible to staff,
 * per the role matrix.
 *
 * Reads only: `stock_movements`, `items` cost/name columns, and
 * `supplier_price_history`. Aggregation is client-side (the v1-volumes
 * precedent from P2-05/P5-03); date ranges filter server-side through
 * PostgREST `gte`/`lte` on the timestamptz columns, with day boundaries
 * on the Asia/Kolkata wall clock.
 */

const movementRowSchema = z.object({
  item_id: z.string().uuid(),
  movement_type: z.string(),
  quantity: z.coerce.number(),
  reason_code: z.string().nullable(),
  created_at: z.string(),
  items: z.object({
    name: z.string(),
    avg_unit_cost: z.coerce.number().nullable(),
    units: z.object({ symbol: z.string() }),
  }),
});

const MOVEMENT_SELECT =
  "item_id, movement_type, quantity, reason_code, created_at, " +
  "items(name, avg_unit_cost, units(symbol))";

function toReportMovement(
  row: z.infer<typeof movementRowSchema>,
): ReportMovement {
  return {
    itemId: row.item_id,
    itemName: row.items.name,
    unitSymbol: row.items.units.symbol,
    movementType: row.movement_type,
    quantity: row.quantity,
    reasonCode: row.reason_code,
    createdAt: row.created_at,
  };
}

function costsByItem(
  rows: z.infer<typeof movementRowSchema>[],
): Map<string, number | null> {
  return new Map(rows.map((row) => [row.item_id, row.items.avg_unit_cost]));
}

async function listMovementsInRange(
  range: ReportRange,
  movementTypes: string[],
): Promise<z.infer<typeof movementRowSchema>[]> {
  const input = reportRangeSchema.parse(range);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_movements")
    .select(MOVEMENT_SELECT)
    .in("movement_type", movementTypes)
    .gte("created_at", startOfDayIST(input.from))
    .lte("created_at", endOfDayIST(input.to))
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    throw new Error(error.message);
  }
  return z.array(movementRowSchema).parse(data);
}

/**
 * Usage report: `usage` (kitchen use, staff meals, tastings) and
 * `sale_deduction` (ingredients sold via recipes) movements in the range,
 * aggregated per item and movement type with quantities and ₹ values.
 */
export async function getUsageReport(range: ReportRange): Promise<UsageRow[]> {
  const rows = await listMovementsInRange(range, ["usage", "sale_deduction"]);
  return aggregateUsage(rows.map(toReportMovement), costsByItem(rows));
}

/**
 * Wastage-by-reason report: `wastage` movements in the range grouped by
 * the closed-set reason code, with quantities and ₹ value lost.
 */
export async function getWastageReport(
  range: ReportRange,
): Promise<WastageReasonRow[]> {
  const rows = await listMovementsInRange(range, ["wastage"]);
  return aggregateWastageByReason(rows.map(toReportMovement), costsByItem(rows));
}

/**
 * Food-cost trend: daily ₹ cost of `sale_deduction` movements in the
 * range, bucketed on the IST calendar date. Ingredient cost of dishes
 * sold — revenue is not captured in v1 (no POS), so the trend is ₹, not
 * %; the live food-cost % per dish stays on /recipes (P4-02).
 */
export async function getFoodCostTrend(
  range: ReportRange,
): Promise<FoodCostDay[]> {
  const rows = await listMovementsInRange(range, ["sale_deduction"]);
  return aggregateFoodCostByDay(rows.map(toReportMovement), costsByItem(rows));
}

export interface PriceChangeReportEvent {
  date: string;
  supplierName: string;
  itemName: string;
  oldPrice: number | null;
  newPrice: number | null;
  changePct: number | null;
}

export interface PriceChangeReport {
  events: PriceChangeReportEvent[];
  summaries: PriceChangeSummary[];
}

/**
 * Supplier price-change report: `supplier_price_history` events in the
 * range (client-side date filter over the newest-first history), plus a
 * per-(supplier, item) net-change summary.
 */
export async function getPriceChangeReport(
  range: ReportRange,
): Promise<PriceChangeReport> {
  const input = reportRangeSchema.parse(range);
  const fromTs = new Date(startOfDayIST(input.from)).getTime();
  const toTs = new Date(endOfDayIST(input.to)).getTime();
  const history = await listPriceHistory({});
  const events: PriceChangeEvent[] = history
    .filter((entry) => {
      const ts = new Date(entry.changedAt).getTime();
      return Number.isFinite(ts) && ts >= fromTs && ts <= toTs;
    })
    .map((entry) => ({
      supplierId: entry.supplierId,
      supplierName: entry.supplierName,
      itemId: entry.itemId,
      itemName: entry.itemName,
      oldPrice: entry.oldPrice,
      newPrice: entry.newPrice,
      changedAt: entry.changedAt,
    }));
  return {
    events: events.map((event) => ({
      date: event.changedAt,
      supplierName: event.supplierName,
      itemName: event.itemName,
      oldPrice: event.oldPrice,
      newPrice: event.newPrice,
      changePct: priceChangePct(event.oldPrice, event.newPrice),
    })),
    summaries: aggregatePriceChanges(events),
  };
}

const saleNotesRowSchema = z.object({
  notes: z.string().nullable(),
  created_at: z.string(),
});

/**
 * Menu engineering report (V2-02): dish popularity vs profitability for
 * the dishes sold in the range, classified into the Star / Plowhorse /
 * Puzzle / Dog quadrants.
 *
 * Per-dish quantities sold are parsed from the `notes` of
 * `sale_deduction` movements (the `record_sales` RPC writes
 * "Sale YYYY-MM-DD: Dish xQTY, ..." there — see `parseSaleNotes`). The
 * date range filters on the movement's posting time (`created_at`),
 * consistent with the food-cost trend tab; the sale date embedded in the
 * notes is business metadata, not the filter key.
 *
 * Costs and prices are the CURRENT live values (`listMenuItems` merges
 * the `menu_item_costs` view, P4-02): the report evaluates historical
 * sales at today's cost and price, stated plainly in the UI.
 *
 * Staff lockout: the route guard keeps staff off /reports entirely, and
 * `menu_items` / `menu_item_costs` have no staff RLS policies, so the
 * cost-bearing half of this query is denied to staff at the database
 * (verified in `supabase/tests/v2_02_menu_engineering_test.sql`).
 */
export async function getMenuEngineeringReport(
  range: ReportRange,
): Promise<MenuEngineeringReport> {
  const input = reportRangeSchema.parse(range);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_movements")
    .select("notes, created_at")
    .eq("movement_type", "sale_deduction")
    .gte("created_at", startOfDayIST(input.from))
    .lte("created_at", endOfDayIST(input.to))
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    throw new Error(error.message);
  }
  const notesRows = z.array(saleNotesRowSchema).parse(data);

  const salesByDishName = new Map<string, number>();
  for (const row of notesRows) {
    for (const sale of parseSaleNotes(row.notes)) {
      salesByDishName.set(
        sale.name,
        (salesByDishName.get(sale.name) ?? 0) + sale.qty,
      );
    }
  }

  // All menu items (active and archived): a dish sold in the range may
  // have been archived since. Unmatched historical names are reported as
  // unknown dishes, never dropped silently.
  const menuItems = await listMenuItems({});
  return buildMenuEngineeringReport(
    salesByDishName,
    menuItems.map((item) => ({
      id: item.id,
      name: item.name,
      active: item.active,
      sellingPrice: item.sellingPrice,
      costPerDish: item.costPerDish,
      ingredientCount: item.ingredientCount,
    })),
  );
}
