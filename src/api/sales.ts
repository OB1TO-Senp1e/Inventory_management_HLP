import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  recordSalesSchema,
  type RecordSalesInput,
} from "@/schemas/sales";

/**
 * Sales API — the ONLY module allowed to call the `record_sales` RPC.
 * All inputs are Zod-validated before the call; the RPC summary is
 * Zod-validated before it reaches components.
 *
 * Deductions post as `sale_deduction` movements (append-only ledger);
 * the RPC aggregates one movement per inventory item per entry and
 * rejects bad input (archived dish, dish without recipe, duplicates,
 * cross-restaurant dishes, non-positive counts).
 */

const summaryLineSchema = z.object({
  menu_item_id: z.string(),
  name: z.string(),
  dishes: z.coerce.number(),
});

const summaryIngredientSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  quantity: z.coerce.number(),
  unit_symbol: z.string(),
});

const recordSalesResultSchema = z.object({
  sale_date: z.string(),
  lines: z.array(summaryLineSchema),
  ingredients: z.array(summaryIngredientSchema),
});

export interface SalesSummaryLine {
  menuItemId: string;
  name: string;
  dishes: number;
}

export interface SalesSummaryIngredient {
  itemId: string;
  name: string;
  quantity: number;
  unitSymbol: string;
}

export interface RecordSalesResult {
  saleDate: string;
  lines: SalesSummaryLine[];
  ingredients: SalesSummaryIngredient[];
}

function toResult(
  raw: z.infer<typeof recordSalesResultSchema>,
): RecordSalesResult {
  return {
    saleDate: raw.sale_date,
    lines: raw.lines.map((line) => ({
      menuItemId: line.menu_item_id,
      name: line.name,
      dishes: line.dishes,
    })),
    ingredients: raw.ingredients.map((ing) => ({
      itemId: ing.item_id,
      name: ing.name,
      quantity: ing.quantity,
      unitSymbol: ing.unit_symbol,
    })),
  };
}

/**
 * Record one day's sales. Posts aggregated `sale_deduction` movements per
 * ingredient through the `record_sales` RPC and returns the summary.
 */
export async function recordSales(
  rawInput: unknown,
): Promise<RecordSalesResult> {
  const input: RecordSalesInput = recordSalesSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("record_sales", {
    p_lines: input.lines.map((line) => ({
      menu_item_id: line.menuItemId,
      dishes: line.dishes,
    })),
    p_sale_date: input.saleDate,
  });
  if (error) {
    throw new Error(error.message);
  }
  return toResult(recordSalesResultSchema.parse(data));
}
