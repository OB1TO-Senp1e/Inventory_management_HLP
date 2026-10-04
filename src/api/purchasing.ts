import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import { listStockOverview } from "./stock";
import {
  createPurchaseOrderSchema,
  purchaseOrderLineInputSchema,
  purchaseOrderStatusSchema,
  updatePurchaseOrderSchema,
  type CreatePurchaseOrderInput,
  type PurchaseOrderStatus,
  type UpdatePurchaseOrderInput,
} from "@/schemas/purchaseOrder";

/**
 * Purchasing API (P3-01, P3-02, P3-04) — the ONLY module allowed to touch the
 * `purchase_orders` and `purchase_order_lines` tables. All inputs are
 * Zod-validated before any client call; all outputs are Zod-validated
 * before they reach components.
 *
 * Draft creation goes through the `create_purchase_order` RPC so the PO
 * header + lines are inserted atomically (SECURITY INVOKER — the caller's
 * RLS applies). Draft edits use direct table writes; the database's
 * status-transition trigger rejects illegal edits.
 *
 * Lifecycle (P3-02): send/cancel/receive go through SECURITY DEFINER RPCs
 * (`send_purchase_order`, `cancel_purchase_order`,
 * `receive_purchase_order`) so status transitions, line receives, and the
 * ledger postings happen atomically with the database enforcing tenant +
 * role from JWT claims. Receiving posts receipt movements via
 * `receive_goods` (tagged purchase_order/<po_id>) using each line's
 * snapshotted unit price as the cost.
 *
 * Staff have no RLS policies on either table (costs) — every staff query
 * is denied by the database.
 */

export interface PurchaseOrderLine {
  id: string;
  itemId: string;
  itemName: string;
  unitSymbol: string;
  quantity: number;
  unitPrice: number;
  receivedQuantity: number;
  lineTotal: number;
  notes: string | null;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierAddress: string | null;
  supplierPhone: string | null;
  supplierEmail: string | null;
  supplierGstin: string | null;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  gstRate: number;
  lineCount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
  /** GST amount = total * gstRate / 100 (₹). */
  gstAmount: number;
  /** total + gstAmount (₹). */
  grandTotal: number;
}

const PO_SELECT =
  "id, supplier_id, status, order_date, expected_date, notes, gst_rate, created_at, updated_at, suppliers(name, address, phone, email, gstin)";

const poRowSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  status: purchaseOrderStatusSchema,
  order_date: z.string(),
  expected_date: z.string().nullable(),
  notes: z.string().nullable(),
  gst_rate: z.coerce.number(),
  created_at: z.string(),
  updated_at: z.string(),
  suppliers: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    gstin: z.string().nullable(),
  }),
});

type PurchaseOrderRow = z.infer<typeof poRowSchema>;

function toPurchaseOrder(row: PurchaseOrderRow, lineCount: number, total: number): PurchaseOrder {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.suppliers.name,
    supplierAddress: row.suppliers.address,
    supplierPhone: row.suppliers.phone,
    supplierEmail: row.suppliers.email,
    supplierGstin: row.suppliers.gstin,
    status: row.status,
    orderDate: row.order_date,
    expectedDate: row.expected_date,
    notes: row.notes,
    gstRate: row.gst_rate,
    lineCount,
    total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LINE_SELECT =
  "id, item_id, quantity, unit_price, received_quantity, notes, items(name, units(symbol))";

const lineRowSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  quantity: z.coerce.number(),
  unit_price: z.coerce.number(),
  received_quantity: z.coerce.number(),
  notes: z.string().nullable(),
  items: z.object({
    name: z.string(),
    units: z.object({ symbol: z.string() }),
  }),
});

type PurchaseOrderLineRow = z.infer<typeof lineRowSchema>;

function toPurchaseOrderLine(row: PurchaseOrderLineRow): PurchaseOrderLine {
  const quantity = row.quantity;
  const unitPrice = row.unit_price;
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.items.name,
    unitSymbol: row.items.units.symbol,
    quantity,
    unitPrice,
    receivedQuantity: row.received_quantity,
    lineTotal: quantity * unitPrice,
    notes: row.notes,
  };
}

function friendlyError(error: { code?: string; message: string }): Error {
  return new Error(error.message);
}

const listPurchaseOrdersInputSchema = z.object({
  status: purchaseOrderStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPurchaseOrdersInput = z.infer<typeof listPurchaseOrdersInputSchema>;

/**
 * List purchase orders, newest first, with per-PO line counts and totals.
 * Totals are computed from the lines (unit_price is a snapshot at creation).
 */
export async function listPurchaseOrders(
  rawInput: unknown,
): Promise<{ orders: PurchaseOrder[]; total: number }> {
  const input = listPurchaseOrdersInputSchema.parse(rawInput);
  const client = getSupabaseClient();

  let query = client
    .from("purchase_orders")
    .select("id", { count: "exact" })
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (input.status) {
    query = query.eq("status", input.status);
  }
  const from = (input.page - 1) * input.pageSize;
  const { data: idRows, error: idError, count } = await query.range(from, from + input.pageSize - 1);
  if (idError) {
    throw friendlyError(idError);
  }
  const ids = z.array(z.object({ id: z.string() })).parse(idRows).map((r) => r.id);
  if (ids.length === 0) {
    return { orders: [], total: count ?? 0 };
  }

  const { data: poRows, error: poError } = await client
    .from("purchase_orders")
    .select(PO_SELECT)
    .in("id", ids)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (poError) {
    throw friendlyError(poError);
  }
  const pos = z.array(poRowSchema).parse(poRows);

  const { data: lineRows, error: lineError } = await client
    .from("purchase_order_lines")
    .select("po_id, quantity, unit_price")
    .in("po_id", ids);
  if (lineError) {
    throw friendlyError(lineError);
  }
  const lines = z
    .array(
      z.object({
        po_id: z.string(),
        quantity: z.coerce.number(),
        unit_price: z.coerce.number(),
      }),
    )
    .parse(lineRows);

  const byPo = new Map<string, { count: number; total: number }>();
  for (const line of lines) {
    const agg = byPo.get(line.po_id) ?? { count: 0, total: 0 };
    agg.count += 1;
    agg.total += line.quantity * line.unit_price;
    byPo.set(line.po_id, agg);
  }

  return {
    orders: pos.map((po) => {
      const agg = byPo.get(po.id) ?? { count: 0, total: 0 };
      return toPurchaseOrder(po, agg.count, agg.total);
    }),
    total: count ?? pos.length,
  };
}

/**
 * Fetch one PO with its lines (ordered by item name). Used by the detail
 * page and the edit dialog.
 */
export async function getPurchaseOrder(rawId: unknown): Promise<PurchaseOrderDetail> {
  const id = z.string().uuid().parse(rawId);
  const client = getSupabaseClient();

  const { data: poData, error: poError } = await client
    .from("purchase_orders")
    .select(PO_SELECT)
    .eq("id", id)
    .single();
  if (poError) {
    throw friendlyError(poError);
  }
  const po = poRowSchema.parse(poData);

  const { data: lineData, error: lineError } = await client
    .from("purchase_order_lines")
    .select(LINE_SELECT)
    .eq("po_id", id)
    .order("name", { referencedTable: "items", ascending: true });
  if (lineError) {
    throw friendlyError(lineError);
  }
  const lines = z.array(lineRowSchema).parse(lineData).map(toPurchaseOrderLine);

  const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const poDetail = toPurchaseOrder(po, lines.length, total);
  // Money math: round to paise (2dp) — GST and grand total derive from the
  // snapshotted subtotal and rate so every consumer agrees.
  const gstAmount = Math.round(total * (poDetail.gstRate / 100) * 100) / 100;
  const grandTotal = Math.round((total + gstAmount) * 100) / 100;
  return { ...poDetail, lines, gstAmount, grandTotal };
}

/**
 * Create a draft PO with lines, atomically, via the `create_purchase_order`
 * RPC. The supplier's current price list should be used to prefill
 * `unitPrice` per line (see `listPricesBySupplier` in api/prices.ts) —
 * the RPC snapshots whatever price the caller passes.
 */
export async function createPurchaseOrder(rawInput: unknown): Promise<string> {
  const input: CreatePurchaseOrderInput = createPurchaseOrderSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("create_purchase_order", {
    p_supplier_id: input.supplierId,
    p_order_date: input.orderDate,
    p_expected_date: input.expectedDate ?? null,
    p_notes: input.notes ?? null,
    p_gst_rate: input.gstRate ?? 0,
    p_lines: input.lines.map((l) => ({
      item_id: l.itemId,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      notes: l.notes ?? null,
    })),
  });
  if (error) {
    throw friendlyError(error);
  }
  return z.string().uuid().parse(data);
}

/**
 * Edit a draft PO's header. The database rejects edits to non-draft POs.
 */
export async function updatePurchaseOrder(rawInput: unknown): Promise<void> {
  const input: UpdatePurchaseOrderInput = updatePurchaseOrderSchema.parse(rawInput);
  const client = getSupabaseClient();
  const patch: { expected_date: string | null; notes: string | null; gst_rate?: number } = {
    expected_date: input.expectedDate ?? null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
  if (input.gstRate !== undefined && input.gstRate !== null) {
    patch.gst_rate = input.gstRate;
  }
  const { error } = await client
    .from("purchase_orders")
    .update(patch)
    .eq("id", input.id);
  if (error) {
    throw friendlyError(error);
  }
}

const poLineMutationSchema = purchaseOrderLineInputSchema.extend({
  poId: z.string().uuid(),
  restaurantId: z.string().uuid(),
});

/**
 * Add a line to a draft PO. The database rejects changes to non-draft POs.
 */
export async function addPurchaseOrderLine(rawInput: unknown): Promise<void> {
  const input = poLineMutationSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { error } = await client.from("purchase_order_lines").insert({
    restaurant_id: input.restaurantId,
    po_id: input.poId,
    item_id: input.itemId,
    quantity: input.quantity,
    unit_price: input.unitPrice,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  });
  if (error) {
    throw friendlyError(error);
  }
}

/**
 * Remove a line from a draft PO. The database rejects changes to non-draft POs.
 */
export async function removePurchaseOrderLine(rawLineId: unknown): Promise<void> {
  const lineId = z.string().uuid().parse(rawLineId);
  const client = getSupabaseClient();
  const { error } = await client.from("purchase_order_lines").delete().eq("id", lineId);
  if (error) {
    throw friendlyError(error);
  }
}

/** One line on a PO receive: how much of the line arrived now. */
export const receivePurchaseOrderLineSchema = z.object({
  poLineId: z.string().uuid(),
  // Quantity received in this receipt (base unit). Must be > 0 and must
  // not push the line's cumulative received_quantity past its ordered
  // quantity — the RPC enforces the cap; this is the client pre-check.
  quantity: z.coerce.number().positive("Receive quantity must be greater than zero."),
  batchNo: z
    .string()
    .trim()
    .max(60, "Batch number must be 60 characters or fewer.")
    .optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid expiry date.")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(500, "Notes must be 500 characters or fewer.")
    .optional(),
});

const receivePurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  lines: z
    .array(receivePurchaseOrderLineSchema)
    .min(1, "Receive at least one line."),
});

export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export interface ReceivePurchaseOrderResult {
  poId: string;
  status: PurchaseOrderStatus;
  lines: Array<{
    poLineId: string;
    itemId: string;
    quantity: number;
    receivedQuantity: number;
  }>;
}

const receiveResultLineSchema = z.object({
  po_line_id: z.string(),
  item_id: z.string(),
  quantity: z.coerce.number(),
  received_quantity: z.coerce.number(),
});

const receiveResultSchema = z.object({
  po_id: z.string(),
  status: purchaseOrderStatusSchema,
  lines: z.array(receiveResultLineSchema),
});

/**
 * Send a draft PO (draft → sent). The RPC requires at least one line.
 */
export async function sendPurchaseOrder(rawId: unknown): Promise<void> {
  const id = z.string().uuid().parse(rawId);
  const client = getSupabaseClient();
  const { error } = await client.rpc("send_purchase_order", { p_po_id: id });
  if (error) {
    throw friendlyError(error);
  }
}

/**
 * Cancel a draft or sent PO. received/cancelled are terminal.
 */
export async function cancelPurchaseOrder(rawId: unknown): Promise<void> {
  const id = z.string().uuid().parse(rawId);
  const client = getSupabaseClient();
  const { error } = await client.rpc("cancel_purchase_order", { p_po_id: id });
  if (error) {
    throw friendlyError(error);
  }
}

/**
 * Receive against a sent/partially_received PO. Posts receipt movements
 * (cost = each line's snapshotted PO unit price), bumps received_quantity,
 * and flips the PO to partially_received/received — atomically in the RPC.
 * Returns the new status plus per-line received quantities for the receipt
 * report.
 */
export async function receivePurchaseOrder(
  rawInput: unknown,
): Promise<ReceivePurchaseOrderResult> {
  const input = receivePurchaseOrderSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("receive_purchase_order", {
    p_po_id: input.id,
    p_lines: input.lines.map((l) => ({
      po_line_id: l.poLineId,
      quantity: l.quantity,
      batch_no: l.batchNo?.trim() ? l.batchNo.trim() : null,
      expiry_date: l.expiryDate ?? null,
      notes: l.notes?.trim() ? l.notes.trim() : null,
    })),
  });
  if (error) {
    throw friendlyError(error);
  }
  const result = receiveResultSchema.parse(data);
  return {
    poId: result.po_id,
    status: result.status,
    lines: result.lines.map((l) => ({
      poLineId: l.po_line_id,
      itemId: l.item_id,
      quantity: l.quantity,
      receivedQuantity: l.received_quantity,
    })),
  };
}

const preferredPriceRowSchema = z.object({
  item_id: z.string(),
  supplier_id: z.string(),
  unit_price: z.coerce.number(),
  currency: z.string(),
  suppliers: z.object({ name: z.string() }).nullable(),
});

export interface ReorderSuggestionLine {
  itemId: string;
  itemName: string;
  unitSymbol: string;
  currentQty: number;
  reorderPoint: number;
  parLevel: number;
  /** Order-up-to-par quantity; at least 1 base unit when par math gives ≤ 0. */
  suggestedQty: number;
  /** Null when the item has no preferred supplier (unassigned group). */
  unitPrice: number | null;
  currency: string;
}

export interface ReorderSuggestionGroup {
  /** Null for the "no preferred supplier" group (no PO can be created). */
  supplierId: string | null;
  supplierName: string;
  lines: ReorderSuggestionLine[];
}

/**
 * Reorder suggestions (P3-03): items at or below their reorder point
 * (same predicate as the P2-05 stock overview's low-stock badge), grouped
 * by preferred supplier. Items with no preferred supplier land in an
 * "unassigned" group that cannot create a PO (a PO needs a supplier and a
 * snapshotted unit price).
 *
 * Two reads joined client-side: `listStockOverview()` (items + derived
 * stock) and one `supplier_prices` query for the preferred prices of the
 * low-stock items. At most one preferred supplier per item per restaurant
 * (partial unique index — see the P1-04 migration), so the join is 1:1.
 *
 * Suggested quantity orders up to par_level. When par math yields ≤ 0
 * (misconfigured par ≤ current stock, yet still at/below reorder point),
 * suggest 1 base unit rather than 0 — the item was flagged low-stock, so
 * ordering nothing would be the surprising choice.
 */
export async function listReorderSuggestions(): Promise<
  ReorderSuggestionGroup[]
> {
  const overview = await listStockOverview();
  const lowStock = overview.filter((row) => row.quantity <= row.reorderPoint);
  if (lowStock.length === 0) {
    return [];
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("supplier_prices")
    .select("item_id, supplier_id, unit_price, currency, suppliers(name)")
    .eq("is_preferred", true)
    .in(
      "item_id",
      lowStock.map((row) => row.itemId),
    );
  if (error) {
    throw new Error(error.message);
  }
  const priceRows = z.array(preferredPriceRowSchema).parse(data);
  const priceByItem = new Map(priceRows.map((row) => [row.item_id, row]));

  const groups = new Map<string, ReorderSuggestionGroup>();
  const UNASSIGNED = "unassigned";
  for (const row of lowStock) {
    const price = priceByItem.get(row.itemId);
    const supplierId = price?.supplier_id ?? null;
    const key = supplierId ?? UNASSIGNED;
    let group = groups.get(key);
    if (!group) {
      group = {
        supplierId,
        supplierName:
          price?.suppliers?.name ?? "No preferred supplier",
        lines: [],
      };
      groups.set(key, group);
    }
    const rawQty = row.parLevel - row.quantity;
    const suggestedQty =
      rawQty > 0 ? Math.round(rawQty * 100) / 100 : 1;
    group.lines.push({
      itemId: row.itemId,
      itemName: row.name,
      unitSymbol: row.unitSymbol,
      currentQty: row.quantity,
      reorderPoint: row.reorderPoint,
      parLevel: row.parLevel,
      suggestedQty,
      unitPrice: price ? price.unit_price : null,
      currency: price ? price.currency : "INR",
    });
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.supplierId === null) return 1;
    if (b.supplierId === null) return -1;
    return a.supplierName.localeCompare(b.supplierName);
  });
  for (const group of sorted) {
    group.lines.sort((a, b) => a.itemName.localeCompare(b.itemName));
  }
  return sorted;
}

/**
 * The current restaurant's name, for the PO print header (P3-04).
 * RLS (`restaurants_select_own`) restricts this to the caller's restaurant.
 */
export async function getRestaurantName(): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("restaurants")
    .select("name")
    .limit(1)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return z.object({ name: z.string() }).parse(data).name;
}
