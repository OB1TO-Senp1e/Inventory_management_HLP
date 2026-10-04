import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
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
 * Purchasing API (P3-01, P3-02) — the ONLY module allowed to touch the
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
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  lineCount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
}

const PO_SELECT =
  "id, supplier_id, status, order_date, expected_date, notes, created_at, updated_at, suppliers(name)";

const poRowSchema = z.object({
  id: z.string(),
  supplier_id: z.string(),
  status: purchaseOrderStatusSchema,
  order_date: z.string(),
  expected_date: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  suppliers: z.object({ name: z.string() }),
});

type PurchaseOrderRow = z.infer<typeof poRowSchema>;

function toPurchaseOrder(row: PurchaseOrderRow, lineCount: number, total: number): PurchaseOrder {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.suppliers.name,
    status: row.status,
    orderDate: row.order_date,
    expectedDate: row.expected_date,
    notes: row.notes,
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
  return { ...toPurchaseOrder(po, lines.length, total), lines };
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
  const patch: { expected_date: string | null; notes: string | null } = {
    expected_date: input.expectedDate ?? null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
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
