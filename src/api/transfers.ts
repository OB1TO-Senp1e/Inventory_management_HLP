import { getSupabaseClient } from "@/lib/supabase";
import {
  toTransferResult,
  transferStockSchema,
  type TransferResult,
  type TransferStockInput,
} from "@/schemas/transfer";

/**
 * Transfers API (V2-07). The source outlet is the caller's current outlet —
 * it is never sent by the client. The transfer_stock() RPC validates the
 * destination (different, active, same restaurant), checks on-hand stock
 * strictly, and posts the paired movements atomically.
 */

function parseOrThrow<T>(
  schema: { parse: (v: unknown) => T },
  input: unknown,
  what: string,
): T {
  try {
    return schema.parse(input);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : `Invalid ${what}.`);
  }
}

/**
 * Transfer stock from the current outlet to another outlet.
 * Throws with the RPC's human-readable message on any guard failure
 * (over-transfer, self-transfer, inactive destination, role).
 */
export async function transferStock(
  rawInput: unknown,
): Promise<TransferResult> {
  const input: TransferStockInput = parseOrThrow(
    transferStockSchema,
    rawInput,
    "transfer",
  );
  const client = getSupabaseClient();
  const { data, error } = await client
    .rpc("transfer_stock", {
      p_to_outlet_id: input.toOutletId,
      p_item_id: input.itemId,
      p_quantity: input.quantity,
      p_batch_no: input.batchNo,
      p_notes: input.notes,
    })
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toTransferResult(data);
}
