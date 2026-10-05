import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  alertPreferencesSchema,
  createNotificationSchema,
  notificationSchema,
  type AlertPreferences,
  type CreateNotification,
  type Notification,
} from "@/schemas/notifications";
import { DEFAULT_ALERT_PREFERENCES } from "@/schemas/notifications";

/**
 * Smart-alert API (V2-03). Owner/manager only at the RLS level (staff have
 * no policies on either table, so every query from them returns zero
 * rows); the routes are additionally guarded to owner/manager.
 *
 * Reads only names + quantities — the notifications table carries no cost
 * columns by design.
 */

const NOTIFICATION_SELECT =
  "id, type, title, body, item_id, batch_no, outlet_id, read_at, created_at";

const notificationRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  item_id: z.string(),
  batch_no: z.string().nullable(),
  outlet_id: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});

function toNotification(row: z.infer<typeof notificationRowSchema>): Notification {
  return notificationSchema.parse({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    itemId: row.item_id,
    batchNo: row.batch_no,
    outletId: row.outlet_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  });
}

/** Newest-first inbox, bounded for v1 volumes. */
export async function listNotifications(): Promise<Notification[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(error.message);
  }
  return z.array(notificationRowSchema).parse(data).map(toNotification);
}

export async function markNotificationRead(rawId: unknown): Promise<void> {
  const id = z.string().uuid().parse(rawId);
  const client = getSupabaseClient();
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) {
    throw new Error(error.message);
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Insert one alert. Returns null when the dedupe unique index rejects the
 * row (another client already alerted this condition) — the caller treats
 * that as "already alerted", not an error.
 */
export async function createNotification(
  rawInput: unknown,
): Promise<Notification | null> {
  const input: CreateNotification = createNotificationSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("notifications")
    .insert({
      type: input.type,
      title: input.title,
      body: input.body,
      item_id: input.itemId,
      batch_no: input.batchNo,
    })
    .select(NOTIFICATION_SELECT)
    .single();
  if (error) {
    if (error.code === "23505") {
      return null;
    }
    throw new Error(error.message);
  }
  return toNotification(notificationRowSchema.parse(data));
}

/** Delete one alert — the engine's "condition cleared" resolution path. */
export async function deleteNotification(rawId: unknown): Promise<void> {
  const id = z.string().uuid().parse(rawId);
  const client = getSupabaseClient();
  const { error } = await client.from("notifications").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

const preferenceRowSchema = z.object({
  low_stock_enabled: z.boolean(),
  expiry_enabled: z.boolean(),
  expiry_days_window: z.number(),
});

function toPreferences(
  row: z.infer<typeof preferenceRowSchema>,
): AlertPreferences {
  return alertPreferencesSchema.parse({
    lowStockEnabled: row.low_stock_enabled,
    expiryEnabled: row.expiry_enabled,
    expiryDaysWindow: row.expiry_days_window,
  });
}

/**
 * The restaurant's preferences, or the defaults when no row exists yet.
 * (The row is created on the first save.)
 */
export async function getAlertPreferences(): Promise<AlertPreferences> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("alert_preferences")
    .select("low_stock_enabled, expiry_enabled, expiry_days_window")
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return { ...DEFAULT_ALERT_PREFERENCES };
  }
  return toPreferences(preferenceRowSchema.parse(data));
}

/**
 * Upsert the restaurant's alert preferences via the
 * `upsert_alert_preferences` RPC. The tenant comes from the JWT claims
 * inside the RPC, so the client never needs its own restaurant_id (the
 * mocked e2e profile carries a non-UUID placeholder). Always sends the
 * complete desired state — the RPC upserts the whole row.
 */
export async function updateAlertPreferences(
  rawPrefs: unknown,
): Promise<AlertPreferences> {
  const prefs: AlertPreferences = alertPreferencesSchema.parse(rawPrefs);
  const client = getSupabaseClient();
  const { data, error } = await client
    .rpc("upsert_alert_preferences", {
      p_low_stock_enabled: prefs.lowStockEnabled,
      p_expiry_enabled: prefs.expiryEnabled,
      p_expiry_days_window: prefs.expiryDaysWindow,
    })
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toPreferences(preferenceRowSchema.parse(data));
}

const expiringBatchRowSchema = z.object({
  item_id: z.string(),
  batch_no: z.string(),
  expiry_date: z.string().nullable(),
  quantity: z.coerce.number(),
});

const batchItemRowSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export interface ExpiringBatch {
  itemId: string;
  itemName: string;
  batchNo: string;
  quantity: number;
  /** ISO YYYY-MM-DD. */
  expiryDate: string;
}

/**
 * Batches that still hold stock and expire within `daysWindow` days
 * (including already-expired ones). Alert-engine input only — the /stock
 * "Expiring soon" filter keeps its own shared 7-day constant.
 */
export async function listExpiringBatches(
  rawDaysWindow: unknown,
): Promise<ExpiringBatch[]> {
  const daysWindow = z.number().int().min(1).max(90).parse(rawDaysWindow);
  const client = getSupabaseClient();
  const [batchRes, itemRes] = await Promise.all([
    client
      .from("stock_movements")
      .select("item_id, batch_no, expiry_date, quantity")
      .not("batch_no", "is", null)
      .not("expiry_date", "is", null),
    client.from("items").select("id, name").eq("active", true),
  ]);
  if (batchRes.error) {
    throw new Error(batchRes.error.message);
  }
  if (itemRes.error) {
    throw new Error(itemRes.error.message);
  }
  const batchRows = z.array(expiringBatchRowSchema).parse(batchRes.data);
  const itemRows = z.array(batchItemRowSchema).parse(itemRes.data);
  const names = new Map(itemRows.map((r) => [r.id, r.name]));

  // Per (item, batch): remaining qty (float-safe) + earliest expiry.
  const byBatch = new Map<
    string,
    { itemId: string; quantity: number; earliestExpiry: string | null }
  >();
  for (const row of batchRows) {
    const key = `${row.item_id}${row.batch_no}`;
    const existing = byBatch.get(key);
    if (!existing) {
      byBatch.set(key, {
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

  const horizon = new Date(Date.now() + daysWindow * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const out: ExpiringBatch[] = [];
  for (const [key, agg] of byBatch) {
    if (agg.quantity <= 0 || !agg.earliestExpiry) {
      continue;
    }
    if (agg.earliestExpiry > horizon) {
      continue;
    }
    const itemName = names.get(agg.itemId);
    if (!itemName) {
      continue; // archived item: no alert
    }
    const batchNo = key.slice(agg.itemId.length);
    out.push({
      itemId: agg.itemId,
      itemName,
      batchNo,
      quantity: agg.quantity,
      expiryDate: agg.earliestExpiry,
    });
  }
  // Most urgent first: already expired, then soonest expiry.
  return out.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}
