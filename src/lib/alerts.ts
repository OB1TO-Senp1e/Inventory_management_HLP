import type { StockOverviewRow } from "@/api/stock";
import type { ExpiringBatch } from "@/api/notifications";
import { formatDate, formatNumber } from "@/lib/format";
import {
  notificationKey,
  notificationKeyOf,
  type AlertPreferences,
  type CreateNotification,
  type Notification,
  type NotificationType,
} from "@/schemas/notifications";

/**
 * Smart-alert engine math (V2-03). Pure functions — the API layer fetches
 * raw rows and the hook in `src/features/alerts` orchestrates; everything
 * below is unit-testable with no I/O.
 *
 * Alert sources (reusing the P2-05/P5-03 definitions):
 *  - low stock: on-hand quantity at or below the reorder point
 *    (`isLowStock` semantics). A null reorder point means "no alerting for
 *    this item" — the item simply never produces a low-stock condition.
 *  - expiring soon: a batch that still holds stock and expires within the
 *    configured window (already-expired batches included).
 *
 * Dedupe rule: one ACTIVE notification per (type, item, batch). The client
 * checks existing active rows before inserting; the DB unique index
 * (`notifications_dedupe_unique`) backstops racing clients. A notification
 * whose condition no longer holds is DELETED ("resolved"), so a cleared-
 * then-recurring condition generates a fresh notification.
 */

export interface AlertCondition {
  type: NotificationType;
  itemId: string;
  batchNo: string | null;
  title: string;
  body: string;
}

function lowStockBody(row: StockOverviewRow): string {
  const qty = `${formatNumber(row.quantity)} ${row.unitSymbol}`;
  const point = `${formatNumber(row.reorderPoint)} ${row.unitSymbol}`;
  return `${qty} left (reorder at ${point})`;
}

/**
 * Compute the current alert conditions from a stock overview snapshot,
 * expiring batches, and the restaurant's preferences. Disabled alert
 * types produce no conditions.
 */
export function computeAlertConditions(
  overview: StockOverviewRow[],
  batches: ExpiringBatch[],
  prefs: AlertPreferences,
): AlertCondition[] {
  const conditions: AlertCondition[] = [];

  if (prefs.lowStockEnabled) {
    for (const row of overview) {
      // Null reorder point: the item opts out of low-stock alerting.
      if (row.reorderPoint == null) {
        continue;
      }
      if (row.quantity <= row.reorderPoint) {
        conditions.push({
          type: "low_stock",
          itemId: row.itemId,
          batchNo: null,
          title: `${row.name} is running low`,
          body: lowStockBody(row),
        });
      }
    }
  }

  if (prefs.expiryEnabled) {
    const today = new Date().toISOString().slice(0, 10);
    for (const batch of batches) {
      const expired = batch.expiryDate < today;
      conditions.push({
        type: "expiring_soon",
        itemId: batch.itemId,
        batchNo: batch.batchNo,
        title: expired
          ? `${batch.itemName} batch ${batch.batchNo} has expired`
          : `${batch.itemName} batch ${batch.batchNo} expiring soon`,
        body: expired
          ? `${formatNumber(batch.quantity)} units still in stock — expired ${formatDate(batch.expiryDate)}`
          : `${formatNumber(batch.quantity)} units expire on ${formatDate(batch.expiryDate)}`,
      });
    }
  }

  return conditions;
}

export interface AlertDiff {
  /** Conditions with no active notification — insert these. */
  toCreate: CreateNotification[];
  /** Active notifications whose condition cleared — delete these. */
  toResolve: Notification[];
}

/**
 * Diff current conditions against the active (unresolved) notifications:
 * new conditions become inserts, stale notifications become resolutions.
 * A read-but-still-active notification suppresses re-alerting — the user
 * already acknowledged it.
 */
export function diffAlerts(
  conditions: AlertCondition[],
  active: Notification[],
): AlertDiff {
  const activeKeys = new Set(active.map(notificationKeyOf));
  const conditionKeys = new Set(
    conditions.map((c) => notificationKey(c.type, c.itemId, c.batchNo)),
  );
  return {
    toCreate: conditions
      .filter((c) => !activeKeys.has(notificationKey(c.type, c.itemId, c.batchNo)))
      .map((c) => ({
        type: c.type,
        title: c.title,
        body: c.body,
        itemId: c.itemId,
        batchNo: c.batchNo,
      })),
    toResolve: active.filter((n) => !conditionKeys.has(notificationKeyOf(n))),
  };
}
