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
 * cross-restaurant dishes, non-positive counts). Movements that take an
 * item's stock below zero are flagged `over_sale` by the RPC, which also
 * writes one `audit_log` entry (action `over_sale`) per over-sale call.
 *
 * P4-04: `previewSalesDeductions` runs the same deduction math BEFORE the
 * entry posts, so the UI can warn about ingredients that would go below
 * zero and ask for explicit confirmation. The over_sale flag + audit entry
 * are still computed server-side inside `record_sales` (the preview and
 * the post are separate transactions, so stock can move between them).
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

/**
 * Exported for the POS import API (V2-06): `import_pos_sales` nests the
 * `record_sales` summary inside its own result, under the same contract.
 */
export { recordSalesResultSchema };

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

/**
 * Exported for the POS import API (V2-06), which nests this summary.
 */
export function toRecordSalesResult(
  raw: z.infer<typeof recordSalesResultSchema>,
): RecordSalesResult {
  return toResult(raw);
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

const previewRowSchema = z.object({
  item_id: z.string(),
  item_name: z.string(),
  unit_symbol: z.string(),
  current_quantity: z.coerce.number(),
  deduction_quantity: z.coerce.number(),
  projected_quantity: z.coerce.number(),
  would_go_negative: z.coerce.boolean(),
});

export interface SalesPreviewItem {
  itemId: string;
  itemName: string;
  unitSymbol: string;
  currentQuantity: number;
  deductionQuantity: number;
  projectedQuantity: number;
  wouldGoNegative: boolean;
}

/**
 * Preview one day's sales BEFORE posting: per-ingredient deduction vs the
 * live current stock, through the `preview_sales_deductions` RPC. The UI
 * shows the warning for `wouldGoNegative` rows and asks for explicit
 * confirmation; the RPC still computes the authoritative flag itself.
 */
export async function previewSalesDeductions(
  rawInput: unknown,
): Promise<SalesPreviewItem[]> {
  const input: RecordSalesInput = recordSalesSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("preview_sales_deductions", {
    p_lines: input.lines.map((line) => ({
      menu_item_id: line.menuItemId,
      dishes: line.dishes,
    })),
  });
  if (error) {
    throw new Error(error.message);
  }
  return z.array(previewRowSchema).parse(data).map((row) => ({
    itemId: row.item_id,
    itemName: row.item_name,
    unitSymbol: row.unit_symbol,
    currentQuantity: row.current_quantity,
    deductionQuantity: row.deduction_quantity,
    projectedQuantity: row.projected_quantity,
    wouldGoNegative: row.would_go_negative,
  }));
}
