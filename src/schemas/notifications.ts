import { z } from "zod";

/**
 * Smart-alert schemas (V2-03). Notifications are a per-restaurant inbox for
 * low-stock and expiring-soon conditions; preferences are one row per
 * restaurant (absent row = all defaults).
 */

/** Machine-readable notification types — mirrors the DB CHECK constraint. */
export const notificationTypeSchema = z.enum(["low_stock", "expiring_soon"]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Human-readable labels for the notification types. */
export const notificationTypeLabels: Record<NotificationType, string> = {
  low_stock: "Low stock",
  expiring_soon: "Expiring soon",
};

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  itemId: z.string().uuid(),
  batchNo: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** Dedupe key: one active notification per (type, item, batch). */
export function notificationKey(
  type: NotificationType,
  itemId: string,
  batchNo: string | null,
): string {
  return `${type}|${itemId}|${batchNo ?? ""}`;
}

export function notificationKeyOf(n: Pick<Notification, "type" | "itemId" | "batchNo">): string {
  return notificationKey(n.type, n.itemId, n.batchNo);
}

/** Alert preferences. `expiryDaysWindow` matches EXPIRY_SOON_DAYS default (7). */
export const alertPreferencesSchema = z.object({
  lowStockEnabled: z.boolean(),
  expiryEnabled: z.boolean(),
  expiryDaysWindow: z.number().int().min(1).max(90),
});
export type AlertPreferences = z.infer<typeof alertPreferencesSchema>;

/** Defaults used when the restaurant has no preference row yet. */
export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  lowStockEnabled: true,
  expiryEnabled: true,
  expiryDaysWindow: 7,
};

export const updateAlertPreferencesSchema = z.object({
  lowStockEnabled: z.boolean().optional(),
  expiryEnabled: z.boolean().optional(),
  expiryDaysWindow: z.number().int().min(1).max(90).optional(),
});
export type UpdateAlertPreferences = z.infer<typeof updateAlertPreferencesSchema>;

export const createNotificationSchema = z.object({
  type: notificationTypeSchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).default(""),
  itemId: z.string().uuid(),
  batchNo: z.string().trim().max(64).nullable().default(null),
});
export type CreateNotification = z.infer<typeof createNotificationSchema>;
