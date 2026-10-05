import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { listStockOverview, subscribeToStockMovements } from "@/api/stock";
import {
  createNotification,
  deleteNotification,
  getAlertPreferences,
  listExpiringBatches,
  listNotifications,
} from "@/api/notifications";
import { computeAlertConditions, diffAlerts } from "@/lib/alerts";
import { notificationKeys } from "./hooks";

/**
 * Smart-alert evaluation engine (V2-03). Mounted once in AppShell for
 * owner/manager roles. Evaluates stock conditions and maintains the
 * `notifications` inbox:
 *
 *  - on mount,
 *  - every 15 minutes,
 *  - when the tab regains focus,
 *  - shortly after any ledger movement (debounced; covers receiving,
 *    wastage/usage, sales, and count approvals — every writer posts
 *    `stock_movements` rows).
 *
 * New conditions insert one notification per (type, item, batch) and fire
 * a Notification API toast when the user granted permission; cleared
 * conditions delete their notification ("resolved"). A concurrent
 * evaluation is skipped, failures are swallowed — this is a best-effort
 * background engine and must never break the app shell.
 *
 * Honest limitation: this only fires while the app is open. True
 * background push (app closed) needs a server-side scheduler + Web Push
 * (VAPID) — noted in ARCHITECTURE.md as a deployment follow-up.
 */

const EVALUATION_INTERVAL_MS = 15 * 60 * 1000;
const REALTIME_DEBOUNCE_MS = 3000;

function fireLocalPush(title: string, body: string): void {
  if (typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  try {
    // The toast is informational; clicking it does nothing (the inbox is
    // one tap away behind the header bell).
    new Notification(title, { body });
  } catch {
    // Permission revoked mid-flight or platform limitation — ignore.
  }
}

export function useAlertEngine(): void {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const runningRef = useRef(false);
  const debounceRef = useRef<number | null>(null);

  const role = profile?.role;
  const canRun = role === "owner" || role === "manager";

  useEffect(() => {
    if (!canRun) {
      return;
    }
    let cancelled = false;

    async function evaluate(): Promise<void> {
      if (runningRef.current || cancelled) {
        return;
      }
      runningRef.current = true;
      try {
        const prefs = await getAlertPreferences();
        if (cancelled) {
          return;
        }
        const [overview, batches, active] = await Promise.all([
          listStockOverview(),
          listExpiringBatches(prefs.expiryDaysWindow),
          listNotifications(),
        ]);
        if (cancelled) {
          return;
        }
        const conditions = computeAlertConditions(overview, batches, prefs);
        const { toCreate, toResolve } = diffAlerts(conditions, active);
        for (const input of toCreate) {
          if (cancelled) {
            break;
          }
          // A null return means a racing client already alerted it.
          const created = await createNotification(input);
          if (created) {
            fireLocalPush(created.title, created.body);
          }
        }
        for (const stale of toResolve) {
          if (cancelled) {
            break;
          }
          await deleteNotification(stale.id);
        }
        if (toCreate.length > 0 || toResolve.length > 0) {
          await queryClient.invalidateQueries({
            queryKey: notificationKeys.all,
          });
        }
      } catch {
        // Best-effort: the inbox page and badge surface their own errors.
      } finally {
        runningRef.current = false;
      }
    }

    function scheduleDebounced(): void {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        void evaluate();
      }, REALTIME_DEBOUNCE_MS);
    }

    void evaluate();
    const intervalId = window.setInterval(() => {
      void evaluate();
    }, EVALUATION_INTERVAL_MS);
    const onFocus = () => {
      void evaluate();
    };
    window.addEventListener("focus", onFocus);
    // Realtime is best-effort: without a configured backend (unit tests)
    // the subscription throws at setup — the interval + focus triggers
    // still evaluate.
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = subscribeToStockMovements(scheduleDebounced);
    } catch {
      unsubscribe = null;
    }

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      unsubscribe?.();
    };
  }, [canRun, queryClient]);
}
