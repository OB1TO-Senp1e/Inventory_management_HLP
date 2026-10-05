import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createStockCountSchema,
  saveCountLineSchema,
  stockCountStatusSchema,
  type CreateStockCountInput,
  type SaveCountLineInput,
  type StockCountStatus,
} from "@/schemas/count";

/**
 * Stock counts API (P5-01) — the ONLY module allowed to touch the
 * `stock_counts` / `stock_count_lines` tables and the `create_stock_count`
 * RPC. All inputs are Zod-validated before any client call; all outputs are
 * Zod-validated before they reach components.
 *
 * Session creation goes through `create_stock_count` so the session +
 * per-item snapshot lines (expected_qty from `current_stock`) are inserted
 * atomically (SECURITY INVOKER — the caller's RLS applies, owner/manager
 * only). Progress saves are direct table updates; the database's guards
 * reject illegal status transitions, frozen snapshots, and submitted-sheet
 * edits.
 *
 * Role model (ARCHITECTURE.md §7): owner/manager see all sessions; staff
 * see and work only their assigned sessions (enforced by RLS — see the
 * migration).
 */

export interface StockCountLine {
  id: string;
  itemId: string;
  itemName: string;
  unitSymbol: string;
  expectedQty: number;
  countedQty: number | null;
}

export interface StockCount {
  id: string;
  title: string;
  status: StockCountStatus;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  /** Lines with a non-null counted_qty. */
  countedLines: number;
  totalLines: number;
}

export interface StockCountDetail extends StockCount {
  lines: StockCountLine[];
}

const countRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: stockCountStatusSchema,
  assigned_to: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const countLineRowSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  expected_qty: z.coerce.number(),
  counted_qty: z.coerce.number().nullable(),
  items: z.object({
    name: z.string(),
    units: z.object({ symbol: z.string() }),
  }),
});

const countListRowSchema = countRowSchema.extend({
  stock_count_lines: z.array(z.object({ counted_qty: z.number().nullable() })),
});

const countDetailRowSchema = countRowSchema.extend({
  stock_count_lines: z.array(countLineRowSchema),
});

const COUNT_LIST_SELECT =
  "id, title, status, assigned_to, created_at, updated_at, stock_count_lines(counted_qty)";

const COUNT_DETAIL_SELECT =
  "id, title, status, assigned_to, created_at, updated_at, " +
  "stock_count_lines(id, item_id, expected_qty, counted_qty, items(name, units(symbol)))";

function toStockCount(
  row: z.infer<typeof countListRowSchema>,
): StockCount {
  const totalLines = row.stock_count_lines.length;
  const countedLines = row.stock_count_lines.filter(
    (line) => line.counted_qty !== null,
  ).length;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    countedLines,
    totalLines,
  };
}

/** Progress % for a session (0 when it has no lines). */
export function countProgressPercent(count: StockCount): number {
  if (count.totalLines === 0) {
    return 0;
  }
  return Math.round((count.countedLines / count.totalLines) * 100);
}

/**
 * List the count sessions visible to the caller (RLS: owner/manager see
 * all; staff see only their assigned sessions). Newest first.
 */
export async function listStockCounts(): Promise<StockCount[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_counts")
    .select(COUNT_LIST_SELECT)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return z.array(countListRowSchema).parse(data).map(toStockCount);
}

/**
 * Load one session with its count sheet (lines + item names/units, sorted
 * by item name client-side for a stable sheet order).
 */
export async function getStockCount(id: string): Promise<StockCountDetail> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_counts")
    .select(COUNT_DETAIL_SELECT)
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const header = countDetailRowSchema.parse(data);
  const lines = header.stock_count_lines
    .map((line) => ({
      id: line.id,
      itemId: line.item_id,
      itemName: line.items.name,
      unitSymbol: line.items.units.symbol,
      expectedQty: line.expected_qty,
      countedQty: line.counted_qty,
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
  return {
    ...toStockCount({
      ...header,
      stock_count_lines: header.stock_count_lines.map((line) => ({
        counted_qty: line.counted_qty,
      })),
    }),
    lines,
  };
}

/**
 * Create a count session and snapshot one line per active item
 * (expected_qty from current_stock). Owner/manager only — the RPC and the
 * RLS INSERT policy both enforce it.
 */
export async function createStockCount(
  rawInput: unknown,
): Promise<StockCount> {
  const input: CreateStockCountInput = createStockCountSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("create_stock_count", {
    p_title: input.title,
    p_assigned_to: input.assignedTo ?? null,
  });
  if (error) {
    throw new Error(error.message);
  }
  // The RPC returns the fresh session row; its snapshot lines are all
  // uncounted, so countedLines starts at 0.
  const row = countRowSchema.parse(data);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    countedLines: 0,
    totalLines: 0,
  };
}

/**
 * Save one counted quantity. countedQty null clears the line back to "not
 * counted". The database rejects edits to submitted sheets and to
 * expected_qty (frozen snapshot).
 */
export async function saveCountLine(
  rawInput: unknown,
): Promise<StockCountLine> {
  const input: SaveCountLineInput = saveCountLineSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_count_lines")
    .update({ counted_qty: input.countedQty })
    .eq("count_id", input.countId)
    .eq("item_id", input.itemId)
    .select("id, item_id, expected_qty, counted_qty, items(name, units(symbol))")
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const line = countLineRowSchema.parse(data);
  return {
    id: line.id,
    itemId: line.item_id,
    itemName: line.items.name,
    unitSymbol: line.items.units.symbol,
    expectedQty: line.expected_qty,
    countedQty: line.counted_qty,
  };
}

/**
 * Submit a session for variance review (P5-02 picks it up from here).
 * The database's status trigger enforces the machine (draft/in_progress →
 * submitted, submitted terminal). The UI only offers this when every line
 * is counted.
 */
export async function submitStockCount(countId: string): Promise<StockCount> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_counts")
    .update({ status: "submitted" })
    .eq("id", countId)
    .select(COUNT_LIST_SELECT)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toStockCount(countListRowSchema.parse(data));
}

/**
 * Move a session's status (draft → in_progress → submitted). The database's
 * status trigger enforces the machine; submitted sessions are frozen.
 * Staff may move status on their own assigned sessions; only owner/manager
 * may change title/assignment (trigger-enforced).
 */
export async function updateStockCountStatus(
  countId: string,
  status: StockCountStatus,
): Promise<StockCount> {
  const parsed = stockCountStatusSchema.parse(status);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("stock_counts")
    .update({ status: parsed })
    .eq("id", countId)
    .select(COUNT_LIST_SELECT)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toStockCount(countListRowSchema.parse(data));
}
