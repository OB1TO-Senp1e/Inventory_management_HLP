import { AlertTriangle, Clock3, Loader2, WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { cn } from "@/lib/utils";
import { drainSyncQueue } from "./engine";
import { useSyncStatus } from "./useSyncStatus";

const pillClass = cn(
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs font-medium",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

/**
 * Sync status indicator (P6-02). Renders in the AppShell header (desktop +
 * mobile) next to the install button. Hidden when the queue is empty and
 * the device is online — sync status is only news when there is something
 * to say.
 *
 * - Offline: amber "Offline" pill.
 * - Syncing: "Syncing…" spinner.
 * - Failed: red "N failed" button — clicking retries the drain now.
 * - Pending: "N queued" button — clicking retries the drain when online.
 */
export function SyncStatusBadge() {
  const queryClient = useQueryClient();
  const { success } = useToast();
  const { profile } = useAuth();
  const { isOnline, pending, failed, syncing } = useSyncStatus();
  const restaurantId = profile?.restaurantId ?? null;

  const retryNow = () => {
    if (!isOnline) {
      return;
    }
    void drainSyncQueue({
      queryClient,
      restaurantId,
      onSynced: (count) => {
        success(
          count === 1
            ? "1 queued entry synced."
            : `${count} queued entries synced.`,
        );
      },
    });
  };

  const badge = (() => {
    const actionable = pending + failed;
    if (!isOnline) {
      return (
        <span
          className={cn(pillClass, "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200")}
          role="status"
        >
          <WifiOff aria-hidden="true" className="h-4 w-4" />
          Offline{actionable > 0 ? ` · ${actionable} queued` : ""}
        </span>
      );
    }
    if (syncing > 0) {
      return (
        <span
          className={cn(pillClass, "bg-secondary text-secondary-foreground")}
          role="status"
        >
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Syncing…
        </span>
      );
    }
    if (failed > 0) {
      return (
        <button
          type="button"
          onClick={retryNow}
          className={cn(
            pillClass,
            "bg-destructive/10 text-destructive hover:bg-destructive/20",
          )}
          aria-label={`${failed} queued ${failed === 1 ? "entry" : "entries"} failed to sync. Activate to retry now.`}
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          {failed} failed
        </button>
      );
    }
    if (pending > 0) {
      return (
        <button
          type="button"
          onClick={retryNow}
          className={cn(pillClass, "bg-secondary text-secondary-foreground hover:bg-accent")}
          aria-label={`${pending} ${pending === 1 ? "entry" : "entries"} queued for sync. Activate to sync now.`}
        >
          <Clock3 aria-hidden="true" className="h-4 w-4" />
          {pending} queued
        </button>
      );
    }
    return null;
  })();

  if (!badge) {
    return null;
  }
  return (
    <div data-testid="sync-status" aria-live="polite">
      {badge}
    </div>
  );
}
