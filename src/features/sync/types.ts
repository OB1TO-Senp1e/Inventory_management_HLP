import { z } from "zod";
import {
  logUsageSchema,
  logWastageSchema,
  receiveGoodsSchema,
} from "@/schemas/stock";

/**
 * Offline sync queue types (P6-02).
 *
 * Scope: wastage/usage logging and receiving — the fieldwork actions staff
 * perform where connectivity is flaky. Sales entry and stock counts are out
 * of scope (their tasks own their offline stories).
 */

/** Entry kinds. Discriminates the payload shape. */
export const syncEntryTypeSchema = z.enum(["wastage", "usage", "receiving"]);
export type SyncEntryType = z.infer<typeof syncEntryTypeSchema>;

/**
 * Queue lifecycle per entry:
 * - `pending`: waiting for connectivity (or its backoff window).
 * - `syncing`: being replayed right now.
 * - `failed`: the replay raised a non-network error (validation, archived
 *   item, …). The entry is KEPT with its error text — never silently
 *   dropped — until the user retries or discards it.
 */
export const syncEntryStatusSchema = z.enum(["pending", "syncing", "failed"]);
export type SyncEntryStatus = z.infer<typeof syncEntryStatusSchema>;

const syncEntryBaseSchema = z.object({
  id: z.string().uuid(),
  /** Tenant the entry was queued under — the drain only replays entries for
   * the currently signed-in restaurant, so a restaurant switch can never
   * post another tenant's entries. */
  restaurantId: z.string().min(1),
  createdAt: z.string(),
  attempts: z.number().int().min(0),
  /** ISO timestamp before which this entry is not retried (backoff). */
  nextRetryAt: z.string().nullable(),
  status: syncEntryStatusSchema,
  /** Server error text from the last failed replay; null otherwise. */
  error: z.string().nullable(),
});

/**
 * A queued offline action. The payload uses the SAME Zod schemas the online
 * forms use, so a queued entry can never post data the forms would reject —
 * and entries loaded from storage are re-validated on replay.
 */
export const syncEntrySchema = z.discriminatedUnion("type", [
  syncEntryBaseSchema.extend({
    type: z.literal("wastage"),
    payload: logWastageSchema,
  }),
  syncEntryBaseSchema.extend({
    type: z.literal("usage"),
    payload: logUsageSchema,
  }),
  syncEntryBaseSchema.extend({
    type: z.literal("receiving"),
    payload: receiveGoodsSchema,
  }),
]);
export type SyncEntry = z.infer<typeof syncEntrySchema>;

/** Input for enqueueing — the store stamps id/createdAt/attempts/status. */
export const newSyncEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("wastage"),
    restaurantId: z.string().min(1),
    payload: logWastageSchema,
  }),
  z.object({
    type: z.literal("usage"),
    restaurantId: z.string().min(1),
    payload: logUsageSchema,
  }),
  z.object({
    type: z.literal("receiving"),
    restaurantId: z.string().min(1),
    payload: receiveGoodsSchema,
  }),
]);
export type NewSyncEntry = z.infer<typeof newSyncEntrySchema>;

/**
 * Loose enqueue input for generic call sites (e.g. the mutation wrapper).
 * The type/payload correlation is enforced at runtime by
 * `newSyncEntrySchema` — a mismatched payload throws instead of queueing.
 */
export interface EnqueueInput {
  type: SyncEntryType;
  restaurantId: string;
  payload: unknown;
}

/**
 * Sentinel returned by the queue-aware mutations when the submission was
 * stored locally instead of posted. Pages branch on this (queued receipt
 * state vs. success report).
 */
export interface QueuedSubmission {
  queued: true;
  entryId: string;
}

export function isQueuedSubmission(value: unknown): value is QueuedSubmission {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { queued?: unknown }).queued === true &&
    typeof (value as { entryId?: unknown }).entryId === "string"
  );
}
