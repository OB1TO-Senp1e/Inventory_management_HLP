import { z } from "zod";

/**
 * Sales entry schemas (P4-03). Client-side validation for recording a day's
 * sales through the `record_sales` RPC. The RPC is the DB source of truth;
 * these schemas mirror its constraints so bad input never reaches the
 * network. RLS + the in-function role check remain the real enforcement.
 *
 * One entry = one sale date (default today) + one line per dish with the
 * number of dishes sold. The client aggregates duplicate dish rows before
 * calling the RPC (the RPC rejects duplicate dishes in one entry).
 * Each dish must be active and have a recipe — the RPC enforces this;
 * the picker only offers active dishes.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

const dishesSchema = z.coerce
  .number()
  .positive("Dishes sold must be greater than zero.")
  .max(100000, "Dishes sold looks too large.");

/** ISO date (YYYY-MM-DD) for the sale day. Defaults to today on the client. */
export const saleDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Sale date must be YYYY-MM-DD.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Sale date is not a real date.");

export const salesLineSchema = z.object({
  menuItemId: uuidSchema,
  dishes: dishesSchema,
});

export type SalesLine = z.infer<typeof salesLineSchema>;

/** Record one day's sales: date + one aggregated line per dish. */
export const recordSalesSchema = z.object({
  saleDate: saleDateSchema,
  lines: z
    .array(salesLineSchema)
    .min(1, "Add at least one dish.")
    .max(200, "Too many dishes in one entry.")
    .refine(
      (lines) => new Set(lines.map((line) => line.menuItemId)).size === lines.length,
      "Each dish may appear only once — quantities are aggregated per dish.",
    ),
});

export type RecordSalesInput = z.infer<typeof recordSalesSchema>;

/**
 * Aggregate duplicate dish rows (same dish entered twice) into one line per
 * dish, summing the dishes sold. Used by the entry form before submit so
 * the RPC's duplicate-dish guard never fires on honest input.
 */
export function aggregateSalesLines(lines: SalesLine[]): SalesLine[] {
  const byDish = new Map<string, number>();
  for (const line of lines) {
    byDish.set(line.menuItemId, (byDish.get(line.menuItemId) ?? 0) + line.dishes);
  }
  return [...byDish.entries()].map(([menuItemId, dishes]) => ({
    menuItemId,
    dishes,
  }));
}

/** Today's date as YYYY-MM-DD in the device's local timezone. */
export function todayISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
