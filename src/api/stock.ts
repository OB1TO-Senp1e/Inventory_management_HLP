import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createOpeningBalanceSchema,
  getCurrentStockSchema,
  listBatchesSchema,
  listMovementsSchema,
  logUsageSchema,
  logWastageSchema,
  movementTypeSchema,
  receiveGoodsSchema,
  type CreateOpeningBalanceInput,
  type GetCurrentStockInput,
  type ListBatchesInput,
  type ListMovementsInput,
  type LogUsageInput,
  type LogWastageInput,
  type MovementType,
  type ReceiveGoodsInput,
} from "@/schemas/stock";

/**
 * Stock ledger API — the ONLY module allowed to touch `stock_movements`,
 * the `current_stock` view, and the `create_opening_balance` RPC. All inputs
 * are Zod-validated before any client call; all outputs are Zod-validated
 * before they reach components.
 *
 * The ledger is append-only: this module exposes NO update or delete path.
 * Corrections are new movements (P2-02+ RPCs), never edits. RLS + trigger +
 * ACL enforce this in the database; the absence of functions here enforces
 * it in the client.
 */

export interface CurrentStock {
  itemId: string;
  quantity: number;
  lastMovementAt: string | null;
}

const currentStockRowSchema = z.object({
  restaurant_id: z.string(),
  item_id: z.string(),
  quantity: z.coerce.number(),
  last_movement_at: z.string().nullable(),
});

function toCurrentStock(row: z.infer<typeof currentStockRowSchema>): CurrentStock {
  return {
    itemId: row.item_id,
    quantity: row.quantity,
    lastMovementAt: row.last_movement_at,
  };
}

/**
 * Read derived stock for one item. The client never computes stock; the
 * `current_stock` view is the contract. Returns null when the item has no
 * movements yet.
 */
export async function getCurrentStock(
  rawInput: unknown,
): Promise<CurrentStock | null> {
  const input: GetCurrentStockInput = getCurrentStockSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("current_stock")
    .select("restaurant_id, item_id, quantity, last_movement_at")
    .eq("item_id", input.itemId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (data === null) {
    return null;
  }
  return toCurrentStock(currentStockRowSchema.parse(data));
}

export interface ReceivableItem {
  id: string;
  name: string;
  unitSymbol: string;
}

const receivableItemRowSchema = z.object({
  item_id: z.string().uuid(),
  item_name: z.string(),
  unit_symbol: z.string(),
});

function toReceivableItem(
  row: z.infer<typeof receivableItemRowSchema>,
): ReceivableItem {
  return {
    id: row.item_id,
    name: row.item_name,
    unitSymbol: row.unit_symbol,
  };
}

/**
 * List active items for stock-transaction pickers (receiving, usage/wastage,
 * counts) via the `list_receivable_items` RPC. Returns ONLY id + name + unit
 * symbol — deliberately no cost columns: staff use this picker, and the
 * role matrix (§7) says staff see no costs. SECURITY DEFINER with
 * tenant + role checks inside; direct `items` access stays RLS-governed.
 */
export async function listReceivableItems(): Promise<ReceivableItem[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("list_receivable_items");
  if (error) {
    throw new Error(error.message);
  }
  const rows = z.array(receivableItemRowSchema).parse(data);
  return rows.map(toReceivableItem);
}

export interface OpeningBalanceResult {
  movementId: string;
}
/**
 * Post the one-time opening balance for an item via the
 * `create_opening_balance` RPC. Owner/manager only (the RPC enforces this;
 * the UI additionally hides the action from staff).
 *
 * The RPC raises friendly exceptions for: non-positive quantity, negative
 * unit cost, unknown/cross-restaurant item, and duplicate opening balances.
 * Those messages are safe to show to the user verbatim.
 */
export async function createOpeningBalance(
  rawInput: unknown,
): Promise<OpeningBalanceResult> {
  const input: CreateOpeningBalanceInput =
    createOpeningBalanceSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("create_opening_balance", {
    p_item_id: input.itemId,
    p_quantity: input.quantity,
    p_unit_cost: input.unitCost,
  });
  if (error) {
    throw new Error(error.message);
  }
  const movementId = z.string().uuid().parse(data);
  return { movementId };
}

export interface LogMovementResult {
  movementId: string;
}

/**
 * Log wasted stock via the `log_wastage` RPC. Posts a negative-quantity
 * `wastage` movement with a closed-set reason code (stored in the
 * `reason_code` column). Owner/manager/staff — the RPC enforces this; staff
 * use this constantly, so the form stays fast and cost-free.
 *
 * The RPC raises friendly exceptions for: non-positive quantity, missing /
 * unknown reason code, unknown or archived item. Safe to show verbatim.
 */
export async function logWastage(
  rawInput: unknown,
): Promise<LogMovementResult> {
  const input: LogWastageInput = logWastageSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("log_wastage", {
    p_item_id: input.itemId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  });
  if (error) {
    throw new Error(error.message);
  }
  const movementId = z.string().uuid().parse(data);
  return { movementId };
}

/**
 * Log consumed stock via the `log_usage` RPC. Posts a negative-quantity
 * `usage` movement with a closed-set reason code (stored in the
 * `reason_code` column). Same roles and error contract as `logWastage`.
 */
export async function logUsage(rawInput: unknown): Promise<LogMovementResult> {
  const input: LogUsageInput = logUsageSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("log_usage", {
    p_item_id: input.itemId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  });
  if (error) {
    throw new Error(error.message);
  }
  const movementId = z.string().uuid().parse(data);
  return { movementId };
}

export interface ReceiveGoodsLineResult {
  movementId: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  oldAvgCost: number;
  newAvgCost: number;
}

export interface ReceiveGoodsResult {
  lines: ReceiveGoodsLineResult[];
}

const receiveGoodsLineResultSchema = z.object({
  movement_id: z.string().uuid(),
  item_id: z.string().uuid(),
  quantity: z.coerce.number(),
  unit_cost: z.coerce.number(),
  old_avg_cost: z.coerce.number(),
  new_avg_cost: z.coerce.number(),
});

function toReceiveGoodsLineResult(
  row: z.infer<typeof receiveGoodsLineResultSchema>,
): ReceiveGoodsLineResult {
  return {
    movementId: row.movement_id,
    itemId: row.item_id,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    oldAvgCost: row.old_avg_cost,
    newAvgCost: row.new_avg_cost,
  };
}

/**
 * Post an ad hoc receipt via the `receive_goods` RPC. All lines post
 * atomically; the RPC raises a friendly, line-numbered error when any line
 * is invalid. The returned per-line old→new average costs feed the receipt
 * report — the client never recomputes cost.
 *
 * Roles: owner, manager, staff (the RPC enforces this; the route guard
 * already limits the page to those three roles).
 */
export async function receiveGoods(
  rawInput: unknown,
): Promise<ReceiveGoodsResult> {
  const input: ReceiveGoodsInput = receiveGoodsSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("receive_goods", {
    p_lines: input.lines.map((line) => ({
      item_id: line.itemId,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      batch_no: line.batchNo ?? null,
      expiry_date: line.expiryDate ?? null,
      notes: line.notes ?? null,
    })),
  });
  if (error) {
    throw new Error(error.message);
  }
  const lines = z.array(receiveGoodsLineResultSchema).parse(data);
  return { lines: lines.map(toReceiveGoodsLineResult) };
}

const MOVEMENT_SELECT =
  "id, item_id, movement_type, quantity, batch_no, expiry_date, unit_cost, " +
  "reason_code, reference_type, notes, created_by, created_at";

const movementRowSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  // Validated against the enum: if the DB CHECK and this drift apart,
  // parsing fails loudly instead of rendering an unknown type.
  movement_type: movementTypeSchema,
  quantity: z.coerce.number(),
  batch_no: z.string().nullable(),
  expiry_date: z.string().nullable(),
  unit_cost: z.coerce.number().nullable(),
  reason_code: z.string().nullable(),
  reference_type: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

export interface StockMovement {
  id: string;
  itemId: string;
  movementType: MovementType;
  quantity: number;
  batchNo: string | null;
  expiryDate: string | null;
  unitCost: number | null;
  reasonCode: string | null;
  referenceType: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

function toStockMovement(
  row: z.infer<typeof movementRowSchema>,
): StockMovement {
  return {
    id: row.id,
    itemId: row.item_id,
    movementType: row.movement_type,
    quantity: row.quantity,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    unitCost: row.unit_cost,
    reasonCode: row.reason_code,
    referenceType: row.reference_type,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export interface ListMovementsResult {
  movements: StockMovement[];
  total: number;
}

/**
 * Paginated ledger history for one item, newest first (created_at desc,
 * id desc as a stable tiebreak). Read-only — the ledger is append-only.
 * Tenant isolation comes from RLS; staff may read (they need history
 * context for their own logging), but this page itself is owner/manager-only.
 */
export async function listMovements(
  rawInput: unknown,
): Promise<ListMovementsResult> {
  const input: ListMovementsInput = listMovementsSchema.parse(rawInput);
  const client = getSupabaseClient();
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;
  const { data, error, count } = await client
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .eq("item_id", input.itemId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) {
    throw new Error(error.message);
  }
  const movements = z.array(movementRowSchema).parse(data);
  return {
    movements: movements.map(toStockMovement),
    total: count ?? 0,
  };
}

const batchRowSchema = z.object({
  batch_no: z.string(),
  expiry_date: z.string().nullable(),
  quantity: z.coerce.number(),
  created_at: z.string(),
});

export interface ItemBatch {
  batchNo: string;
  quantity: number;
  earliestExpiry: string | null;
  lastMovementAt: string;
}

/**
 * Per-batch totals for one item, aggregated client-side from its
 * batch-tagged movements (total qty, earliest expiry, latest movement).
 * Fine for v1 volumes; RLS keeps it tenant-isolated like everything else.
 */
export async function listBatches(
  rawInput: unknown,
): Promise<ItemBatch[]> {
  const input: ListBatchesInput = listBatchesSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_movements")
    .select("batch_no, expiry_date, quantity, created_at")
    .eq("item_id", input.itemId)
    .not("batch_no", "is", null)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const rows = z.array(batchRowSchema).parse(data);
  const byBatch = new Map<
    string,
    { quantity: number; earliestExpiry: string | null; lastMovementAt: string }
  >();
  for (const row of rows) {
    const existing = byBatch.get(row.batch_no);
    if (!existing) {
      byBatch.set(row.batch_no, {
        quantity: row.quantity,
        earliestExpiry: row.expiry_date,
        lastMovementAt: row.created_at,
      });
    } else {
      // numeric quantities arrive as JS numbers — round the running total
      // so binary float addition can't produce 42.5000000001.
      existing.quantity =
        Math.round((existing.quantity + row.quantity) * 1e6) / 1e6;
      if (
        row.expiry_date &&
        (!existing.earliestExpiry || row.expiry_date < existing.earliestExpiry)
      ) {
        existing.earliestExpiry = row.expiry_date;
      }
      if (row.created_at > existing.lastMovementAt) {
        existing.lastMovementAt = row.created_at;
      }
    }
  }
  return [...byBatch.entries()]
    .map(([batchNo, agg]) => ({ batchNo, ...agg }))
    .sort((a, b) => a.batchNo.localeCompare(b.batchNo));
}

/**
 * Subscribe to new ledger movements for one item via a realtime channel.
 * The callback fires on every INSERT into `stock_movements` for the item;
 * the caller (a hook) invalidates the derived queries. Realtime must be
 * enabled for the table on the Supabase project — without it the channel
 * stays silent and the page still works through normal refetch, so this is
 * best-effort. Returns an unsubscribe function.
 *
 * Only this module touches the Supabase client: components use the
 * `useStockRealtime` hook in `@/features/items/stockHooks`.
 */
export function subscribeToItemMovements(
  itemId: string,
  onMovement: () => void,
): () => void {
  const parsedId = z.string().uuid("Invalid identifier.").parse(itemId);
  const client = getSupabaseClient();
  const channel = client
    .channel(`stock-movements-item-${parsedId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "stock_movements",
        filter: `item_id=eq.${parsedId}`,
      },
      () => onMovement(),
    )
    .subscribe();
  return () => {
    void channel.unsubscribe();
  };
}

const overviewItemRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  category_id: z.string().nullable(),
  unit_id: z.string(),
  storage_location_id: z.string().nullable(),
  par_level: z.coerce.number(),
  reorder_point: z.coerce.number(),
  item_categories: z.object({ name: z.string() }).nullable(),
  units: z.object({ name: z.string(), symbol: z.string() }),
  storage_locations: z.object({ name: z.string() }).nullable(),
});

const overviewBatchRowSchema = z.object({
  item_id: z.string(),
  batch_no: z.string(),
  expiry_date: z.string().nullable(),
  quantity: z.coerce.number(),
});

export interface StockOverviewRow {
  itemId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  locationId: string | null;
  locationName: string | null;
  unitSymbol: string;
  reorderPoint: number;
  parLevel: number;
  /** Derived quantity; 0 when the item has no movements yet. */
  quantity: number;
  lastMovementAt: string | null;
  /**
   * Earliest expiry among the item's batches that still hold stock
   * (positive remaining quantity). Null when no tracked batch has stock.
   */
  earliestExpiry: string | null;
}

/**
 * Every active item with its derived stock, for the stock overview screen
 * (P2-05). Three reads joined client-side — fine for v1 volumes; the
 * `current_stock` view stays the read contract (the client never sums the
 * ledger itself) and batch expiry aggregates mirror `listBatches`.
 *
 * No cost columns: the overview shows quantities only, so it stays safe
 * for every role that may reach the page (owner/manager today).
 */
export async function listStockOverview(): Promise<StockOverviewRow[]> {
  const client = getSupabaseClient();
  const [itemsRes, stockRes, batchRes] = await Promise.all([
    client
      .from("items")
      .select(
        "id, name, category_id, unit_id, storage_location_id, par_level, " +
          "reorder_point, item_categories(name), units(name, symbol), " +
          "storage_locations(name)",
      )
      .eq("active", true)
      .order("name"),
    client.from("current_stock").select("item_id, quantity, last_movement_at"),
    client
      .from("stock_movements")
      .select("item_id, batch_no, expiry_date, quantity")
      .not("batch_no", "is", null),
  ]);
  if (itemsRes.error) {
    throw new Error(itemsRes.error.message);
  }
  if (stockRes.error) {
    throw new Error(stockRes.error.message);
  }
  if (batchRes.error) {
    throw new Error(batchRes.error.message);
  }
  const itemRows = z.array(overviewItemRowSchema).parse(itemsRes.data);
  const stockRows = z.array(currentStockRowSchema).parse(stockRes.data);
  const batchRows = z.array(overviewBatchRowSchema).parse(batchRes.data);

  const stockByItem = new Map(
    stockRows.map((row) => [row.item_id, toCurrentStock(row)]),
  );

  // Per (item, batch): remaining qty (float-safe) + earliest expiry.
  const batchAgg = new Map<
    string,
    { itemId: string; quantity: number; earliestExpiry: string | null }
  >();
  for (const row of batchRows) {
    const key = `${row.item_id}${row.batch_no}`;
    const existing = batchAgg.get(key);
    if (!existing) {
      batchAgg.set(key, {
        itemId: row.item_id,
        quantity: row.quantity,
        earliestExpiry: row.expiry_date,
      });
    } else {
      existing.quantity =
        Math.round((existing.quantity + row.quantity) * 1e6) / 1e6;
      if (
        row.expiry_date &&
        (!existing.earliestExpiry || row.expiry_date < existing.earliestExpiry)
      ) {
        existing.earliestExpiry = row.expiry_date;
      }
    }
  }
  const expiryByItem = new Map<string, string>();
  for (const agg of batchAgg.values()) {
    if (agg.quantity <= 0 || !agg.earliestExpiry) {
      continue;
    }
    const current = expiryByItem.get(agg.itemId);
    if (!current || agg.earliestExpiry < current) {
      expiryByItem.set(agg.itemId, agg.earliestExpiry);
    }
  }

  return itemRows.map((row) => {
    const stock = stockByItem.get(row.id);
    return {
      itemId: row.id,
      name: row.name,
      categoryId: row.category_id,
      categoryName: row.item_categories?.name ?? null,
      locationId: row.storage_location_id,
      locationName: row.storage_locations?.name ?? null,
      unitSymbol: row.units.symbol,
      reorderPoint: row.reorder_point,
      parLevel: row.par_level,
      quantity: stock?.quantity ?? 0,
      lastMovementAt: stock?.lastMovementAt ?? null,
      earliestExpiry: expiryByItem.get(row.id) ?? null,
    };
  });
}

/**
 * Subscribe to ALL new ledger movements via a realtime channel (no item
 * filter — the overview watches every item). The caller invalidates the
 * overview query so the screen updates without a refresh. Best-effort like
 * `subscribeToItemMovements`: silent without realtime, page works via
 * refetch. Returns an unsubscribe function.
 */
export function subscribeToStockMovements(onMovement: () => void): () => void {
  const client = getSupabaseClient();
  const channel = client
    .channel("stock-movements-overview")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "stock_movements",
      },
      () => onMovement(),
    )
    .subscribe();
  return () => {
    void channel.unsubscribe();
  };
}
