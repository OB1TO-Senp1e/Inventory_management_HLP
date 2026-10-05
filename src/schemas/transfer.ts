import { z } from "zod";

/**
 * Transfer schemas (V2-07). An inter-outlet transfer moves stock from the
 * caller's current outlet (the source — never a client parameter) to a
 * destination outlet of the same restaurant. The transfer_stock() RPC posts
 * paired transfer_out/transfer_in movements atomically.
 */

export const transferStockSchema = z.object({
  toOutletId: z.string().uuid("Choose a destination outlet."),
  itemId: z.string().uuid("Choose an item."),
  quantity: z
    .number({ invalid_type_error: "Quantity must be a number." })
    .positive("Quantity must be greater than zero."),
  batchNo: z
    .string()
    .trim()
    .max(80, "Batch number must be 80 characters or fewer.")
    .nullish()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(500, "Notes must be 500 characters or fewer.")
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type TransferStockInput = z.infer<typeof transferStockSchema>;

const transferResultRowSchema = z.object({
  transfer_id: z.string(),
  from_outlet_id: z.string(),
  from_outlet_name: z.string(),
  to_outlet_id: z.string(),
  to_outlet_name: z.string(),
  item_id: z.string(),
  item_name: z.string(),
  quantity: z.coerce.number(),
  unit_symbol: z.string(),
  batch_no: z.string().nullable(),
  transfer_out_movement_id: z.string(),
  transfer_in_movement_id: z.string(),
});

export interface TransferResult {
  transferId: string;
  fromOutletId: string;
  fromOutletName: string;
  toOutletId: string;
  toOutletName: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitSymbol: string;
  batchNo: string | null;
}

export function toTransferResult(row: unknown): TransferResult {
  const r = transferResultRowSchema.parse(row);
  return {
    transferId: r.transfer_id,
    fromOutletId: r.from_outlet_id,
    fromOutletName: r.from_outlet_name,
    toOutletId: r.to_outlet_id,
    toOutletName: r.to_outlet_name,
    itemId: r.item_id,
    itemName: r.item_name,
    quantity: r.quantity,
    unitSymbol: r.unit_symbol,
    batchNo: r.batch_no,
  };
}
