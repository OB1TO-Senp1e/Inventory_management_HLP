import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  listPriceHistorySchema,
  listPricesByItemSchema,
  listPricesBySupplierSchema,
  setPreferredSupplierSchema,
  upsertPriceSchema,
  type ListPriceHistoryInput,
  type ListPricesByItemInput,
  type ListPricesBySupplierInput,
  type SetPreferredSupplierInput,
  type UpsertPriceInput,
} from "@/schemas/price";

/**
 * Supplier price-list API — the ONLY module allowed to touch the
 * `supplier_prices` and `supplier_price_history` tables (plus the
 * `set_preferred_supplier` RPC). All inputs are Zod-validated before any
 * client call; all outputs are Zod-validated before they reach components.
 *
 * `restaurantId` for writes comes from the caller's auth profile; RLS
 * `WITH CHECK` enforces that it matches the caller's JWT claims.
 * Price changes are audited automatically by the
 * `record_supplier_price_history()` trigger — the history table is
 * append-only and has no write path here by design.
 */

export interface SupplierPrice {
  id: string;
  supplierId: string;
  itemId: string;
  unitPrice: number;
  currency: string;
  isPreferred: boolean;
  itemName: string;
  itemUnit: string | null;
  supplierName: string;
  updatedAt: string;
}

export interface PriceHistoryEntry {
  id: string;
  supplierId: string;
  itemId: string;
  oldPrice: number | null;
  newPrice: number | null;
  changedAt: string;
  supplierName: string;
  itemName: string;
}

const priceRowSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  item_id: z.string(),
  unit_price: z.coerce.number(),
  currency: z.string(),
  is_preferred: z.boolean(),
  updated_at: z.string(),
  items: z.object({
    name: z.string(),
    units: z.object({ symbol: z.string() }).nullable(),
  }),
  suppliers: z.object({ name: z.string() }),
});

type PriceRow = z.infer<typeof priceRowSchema>;

function toSupplierPrice(row: PriceRow): SupplierPrice {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    itemId: row.item_id,
    unitPrice: row.unit_price,
    currency: row.currency,
    isPreferred: row.is_preferred,
    itemName: row.items.name,
    itemUnit: row.items.units?.symbol ?? null,
    supplierName: row.suppliers.name,
    updatedAt: row.updated_at,
  };
}

const PRICE_SELECT =
  "id, supplier_id, item_id, unit_price, currency, is_preferred, updated_at, " +
  "items!inner(name, units(symbol)), suppliers!inner(name)";

const historyRowSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  item_id: z.string(),
  old_price: z.coerce.number().nullable(),
  new_price: z.coerce.number().nullable(),
  changed_at: z.string(),
  suppliers: z.object({ name: z.string() }).nullable(),
  items: z.object({ name: z.string() }).nullable(),
});

type HistoryRow = z.infer<typeof historyRowSchema>;

function toPriceHistoryEntry(row: HistoryRow): PriceHistoryEntry {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    itemId: row.item_id,
    oldPrice: row.old_price,
    newPrice: row.new_price,
    changedAt: row.changed_at,
    supplierName: row.suppliers?.name ?? "—",
    itemName: row.items?.name ?? "—",
  };
}

const HISTORY_SELECT =
  "id, supplier_id, item_id, old_price, new_price, changed_at, " +
  "suppliers(name), items(name)";

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new Error("A price for this item and supplier already exists.");
  }
  return new Error(error.message);
}

/**
 * List all price rows for one supplier, ordered by item name. Powers the
 * supplier price-list screen.
 */
export async function listPricesBySupplier(
  rawInput: unknown,
): Promise<SupplierPrice[]> {
  const input: ListPricesBySupplierInput =
    listPricesBySupplierSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("supplier_prices")
    .select(PRICE_SELECT)
    .eq("supplier_id", input.supplierId)
    .order("name", { referencedTable: "items", ascending: true });
  if (error) {
    throw friendlyError(error);
  }
  const rows = z.array(priceRowSchema).parse(data);
  return rows.map(toSupplierPrice);
}

/**
 * List all price rows for one item across suppliers, cheapest first.
 * Powers per-item price comparison (and the future PO prefill in P3-01).
 */
export async function listPricesByItem(
  rawInput: unknown,
): Promise<SupplierPrice[]> {
  const input: ListPricesByItemInput = listPricesByItemSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("supplier_prices")
    .select(PRICE_SELECT)
    .eq("item_id", input.itemId)
    .order("unit_price", { ascending: true });
  if (error) {
    throw friendlyError(error);
  }
  const rows = z.array(priceRowSchema).parse(data);
  return rows.map(toSupplierPrice);
}

/**
 * Insert a price row, or update the unit price when the (supplier, item)
 * pair already exists. The history trigger audits the change.
 */
export async function upsertPrice(
  rawInput: unknown,
): Promise<SupplierPrice> {
  const parsed: UpsertPriceInput = upsertPriceSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("supplier_prices")
    .upsert(
      {
        restaurant_id: parsed.restaurantId,
        supplier_id: parsed.supplierId,
        item_id: parsed.itemId,
        unit_price: parsed.unitPrice,
      },
      { onConflict: "supplier_id,item_id" },
    )
    .select(PRICE_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toSupplierPrice(priceRowSchema.parse(data));
}

/**
 * Atomically switch the preferred supplier for an item via the
 * `set_preferred_supplier()` RPC. RPC exceptions surface as friendly
 * errors (unknown pair, archived supplier/item, wrong role).
 */
export async function setPreferredSupplier(
  rawInput: unknown,
): Promise<SupplierPrice> {
  const parsed: SetPreferredSupplierInput =
    setPreferredSupplierSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("set_preferred_supplier", {
    p_item_id: parsed.itemId,
    p_supplier_id: parsed.supplierId,
  });
  if (error) {
    throw new Error(
      error.message.replace(/^set_preferred_supplier:\s*/, ""),
    );
  }
  // The RPC returns the updated row without the joined names; re-read the
  // full row so the UI gets a consistent shape.
  const row = z
    .object({ id: z.string() })
    .parse(data);
  const { data: full, error: readError } = await client
    .from("supplier_prices")
    .select(PRICE_SELECT)
    .eq("id", row.id)
    .single();
  if (readError) {
    throw friendlyError(readError);
  }
  return toSupplierPrice(priceRowSchema.parse(full));
}

/**
 * Price-change history, newest first. Optionally scoped to a supplier,
 * an item, or a (supplier, item) pair.
 */
export async function listPriceHistory(
  rawInput: unknown,
): Promise<PriceHistoryEntry[]> {
  const input: ListPriceHistoryInput = listPriceHistorySchema.parse(rawInput);
  const client = getSupabaseClient();
  let query = client.from("supplier_price_history").select(HISTORY_SELECT);
  if (input.supplierId) {
    query = query.eq("supplier_id", input.supplierId);
  }
  if (input.itemId) {
    query = query.eq("item_id", input.itemId);
  }
  query = query.order("changed_at", { ascending: false }).limit(200);
  const { data, error } = await query;
  if (error) {
    throw friendlyError(error);
  }
  const rows = z.array(historyRowSchema).parse(data);
  return rows.map(toPriceHistoryEntry);
}
