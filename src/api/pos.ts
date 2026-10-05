import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  importPosSalesSchema,
  type ImportPosSalesInput,
} from "@/schemas/pos";
import {
  recordSalesResultSchema,
  toRecordSalesResult,
  type RecordSalesResult,
} from "./sales";

/**
 * POS import API (V2-06) — the ONLY module allowed to call the
 * `import_pos_sales` RPC or read `pos_imports`.
 *
 * `import_pos_sales` posts atomically: it aggregates the lines per dish,
 * calls `record_sales` internally (identical ledger effects, over_sale
 * flags and audit entries to a manual entry), and records one
 * `pos_imports` row per external sale. Re-importing an external sale
 * raises — the unique (restaurant_id, provider, external_sale_id) index
 * is the dedupe backstop; the client pre-filters via
 * `listImportedExternalIds` and shows "already imported" badges.
 */

// recordSalesResultSchema is module-private in ./sales; re-declare the
// summary shape here (kept in sync by the shared RPC contract).
const importResultSchema = z.object({
  provider: z.string(),
  sale_date: z.string(),
  imported: z.coerce.number(),
  sales: recordSalesResultSchema,
});

export interface PosImportResult {
  provider: string;
  saleDate: string;
  imported: number;
  sales: RecordSalesResult;
}

/**
 * Import POS sales: posts through `import_pos_sales` and returns the
 * import summary (provider, sale date, imported count) plus the
 * record_sales summary (lines + deducted ingredients).
 */
export async function importPosSales(
  rawInput: unknown,
): Promise<PosImportResult> {
  const input: ImportPosSalesInput = importPosSalesSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("import_pos_sales", {
    p_provider: input.provider,
    p_sales: input.lines.map((line) => ({
      external_sale_id: line.externalSaleId,
      menu_item_id: line.menuItemId,
      dishes: line.dishes,
      sold_at: line.soldAt,
    })),
    p_sale_date: input.saleDate,
  });
  if (error) {
    throw new Error(error.message);
  }
  const parsed = importResultSchema.parse(data);
  return {
    provider: parsed.provider,
    saleDate: parsed.sale_date,
    imported: parsed.imported,
    sales: toRecordSalesResult(parsed.sales),
  };
}

/**
 * External sale ids already imported for a provider (this restaurant,
 * via RLS). The import preview filters these out and marks them
 * "already imported".
 */
export async function listImportedExternalIds(
  provider: string,
): Promise<Set<string>> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("pos_imports")
    .select("external_sale_id")
    .eq("provider", provider);
  if (error) {
    throw new Error(error.message);
  }
  return new Set(
    z
      .array(z.object({ external_sale_id: z.string() }))
      .parse(data)
      .map((row) => row.external_sale_id),
  );
}
