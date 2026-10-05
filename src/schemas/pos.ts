import { z } from "zod";
import { saleDateSchema } from "./sales";

/**
 * POS import schemas (V2-06). Client-side validation for the
 * `import_pos_sales` RPC; mirrors its guards so bad input never reaches
 * the network. RLS + the in-function role check remain the real
 * enforcement.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

export const posImportLineSchema = z.object({
  /** POS-side sale id — the dedupe key per provider. */
  externalSaleId: z.string().trim().min(1).max(128),
  /** Menu item chosen (auto-matched or manually mapped) in the preview. */
  menuItemId: uuidSchema,
  dishes: z.coerce
    .number()
    .positive("Dishes sold must be greater than zero.")
    .max(100000, "Dishes sold looks too large."),
  /** Original POS timestamp; informational — the entry posts under saleDate. */
  soldAt: z.string().datetime({ offset: true }).nullable(),
});

export type PosImportLine = z.infer<typeof posImportLineSchema>;

/** One import = provider + sale date + the confirmed lines. */
export const importPosSalesSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  saleDate: saleDateSchema,
  lines: z
    .array(posImportLineSchema)
    .min(1, "Select at least one sale to import.")
    .max(500, "Too many sales in one import."),
});

export type ImportPosSalesInput = z.infer<typeof importPosSalesSchema>;

/**
 * Aggregate import lines per dish (the RPC does this too, but the client
 * needs the aggregated lines for the pre-post over-sale preview via
 * `preview_sales_deductions`, which takes the P4-03 record-sales shape).
 */
export function aggregateImportLines(
  lines: PosImportLine[],
): { menuItemId: string; dishes: number }[] {
  const byDish = new Map<string, number>();
  for (const line of lines) {
    byDish.set(line.menuItemId, (byDish.get(line.menuItemId) ?? 0) + line.dishes);
  }
  return [...byDish.entries()].map(([menuItemId, dishes]) => ({
    menuItemId,
    dishes,
  }));
}
