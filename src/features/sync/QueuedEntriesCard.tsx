import { AlertTriangle, Clock3, Loader2, Trash2, UtensilsCrossed, Truck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { drainSyncQueue } from "./engine";
import {
  removeSyncEntry,
  resetSyncEntryForRetry,
  type SyncEntry,
  type SyncEntryType,
} from "./queue";

const TYPE_META: Record<SyncEntryType, { label: string; Icon: typeof Truck }> = {
  wastage: { label: "Wastage", Icon: Trash2 },
  usage: { label: "Usage", Icon: UtensilsCrossed },
  receiving: { label: "Receipt", Icon: Truck },
};

const STATUS_META = {
  pending: { label: "Queued", Icon: Clock3, className: "bg-secondary text-secondary-foreground" },
  syncing: { label: "Syncing", Icon: Loader2, className: "bg-secondary text-secondary-foreground" },
  failed: { label: "Failed", Icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
} as const;

function humanizeReason(reason: string): string {
  return reason
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity);
}

/** One-line summary of what the entry will post when it syncs. */
function entrySummary(entry: SyncEntry, itemName?: (itemId: string) => string | undefined): string {
  const name = (itemId: string) => itemName?.(itemId) ?? "item";
  switch (entry.type) {
    case "wastage":
    case "usage":
      return `${formatQuantity(entry.payload.quantity)} × ${name(entry.payload.itemId)} — ${humanizeReason(entry.payload.reason)}`;
    case "receiving": {
      const lines = entry.payload.lines;
      const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
      return `${lines.length} ${lines.length === 1 ? "line" : "lines"}, ${formatQuantity(totalQty)} total units`;
    }
  }
}

import { formatDateTime } from "@/lib/format";

export interface QueuedEntriesCardProps {
  entries: SyncEntry[];
  /** Resolve an item id to a display name (the pages have the picker data). */
  itemName?: (itemId: string) => string | undefined;
}

/**
 * Queued offline entries for the /wastage and /receiving pages (P6-02).
 * Renders nothing when the filtered list is empty. Failed entries keep
 * their server error text and offer retry (backoff reset) or discard —
 * the data was never posted, so discarding loses nothing server-side.
 */
export function QueuedEntriesCard({ entries, itemName }: QueuedEntriesCardProps) {
  const queryClient = useQueryClient();
  const { success } = useToast();
  const { profile } = useAuth();
  const restaurantId = profile?.restaurantId ?? null;
  const outletId = profile?.currentOutletId ?? null;

  if (entries.length === 0) {
    return null;
  }

  const retryAll = () => {
    for (const entry of entries) {
      if (entry.status === "failed") {
        resetSyncEntryForRetry(entry.id);
      }
    }
    void drainSyncQueue({ queryClient, restaurantId, outletId });
  };

  const retryOne = (id: string) => {
    resetSyncEntryForRetry(id);
    void drainSyncQueue({ queryClient, restaurantId, outletId });
  };

  const discardOne = (id: string) => {
    removeSyncEntry(id);
    success("Queued entry discarded.");
  };

  const failedCount = entries.filter((e) => e.status === "failed").length;

  return (
    <section
      aria-label="Queued offline entries"
      className="mb-6 rounded-md border border-dashed p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Pending sync ({entries.length})
        </h2>
        {failedCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            onClick={retryAll}
          >
            Retry all
          </Button>
        )}
      </div>
      <ul className="space-y-3">
        {entries.map((entry) => {
          const { label, Icon } = TYPE_META[entry.type];
          const status = STATUS_META[entry.status];
          const StatusIcon = status.Icon;
          return (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-md bg-muted/40 p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {label}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      status.className,
                    )}
                  >
                    <StatusIcon
                      aria-hidden="true"
                      className={cn("h-3 w-3", entry.status === "syncing" && "animate-spin")}
                    />
                    {status.label}
                  </span>
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {entrySummary(entry, itemName)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Queued {formatDateTime(entry.createdAt)}
                  {entry.attempts > 0 && ` · ${entry.attempts} ${entry.attempts === 1 ? "attempt" : "attempts"}`}
                </p>
                {entry.error && (
                  <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                    {entry.error}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {entry.status === "failed" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => retryOne(entry.id)}
                  >
                    Retry
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] text-destructive hover:text-destructive"
                  onClick={() => discardOne(entry.id)}
                  aria-label={`Discard queued ${label.toLowerCase()} entry`}
                >
                  Discard
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
