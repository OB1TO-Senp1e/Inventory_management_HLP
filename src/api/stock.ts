import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createOpeningBalanceSchema,
  getCurrentStockSchema,
  type CreateOpeningBalanceInput,
  type GetCurrentStockInput,
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
