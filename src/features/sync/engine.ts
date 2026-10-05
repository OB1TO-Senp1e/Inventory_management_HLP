import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { logUsage, logWastage, receiveGoods } from "@/api/stock";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import { isNetworkError, isOnline } from "./offline";
import {
  getPendingSyncEntries,
  markSyncEntryFailed,
  markSyncEntryPending,
  markSyncEntrySyncing,
  removeSyncEntry,
  type SyncEntry,
} from "./queue";

/**
 * The sync engine (P6-02).
 *
 * Drain semantics:
 * - FIFO by creation time, current restaurant only (entries carry the
 *   restaurant they were queued under — a restaurant switch can never post
 *   another tenant's entries).
 * - Each entry replays through the SAME api function the online form uses,
 *   which re-validates the payload with the form's Zod schema.
 * - Network failure mid-drain: the entry goes back to `pending` and the
 *   drain stops — the `online` listener or the next interval tick retries.
 * - Any other error (RPC validation, archived item, RLS denial): the entry
 *   is marked `failed` WITH its error text and a backoff window, and the
 *   drain continues with the next entry. Nothing is ever silently dropped.
 *
 * At-least-once note: an entry is removed only after the replay resolves.
 * If the RPC committed but the response was lost to a network drop, the
 * replay can post twice. The ledger is append-only inserts (no
 * last-writer-wins), and receiving/wastage/usage have no natural dedupe
 * key in v1 — this edge is documented, not silently "fixed".
 */

export interface DrainResult {
  attempted: number;
  synced: number;
  failed: number;
  /** True when the drain stopped because the connection dropped mid-pass. */
  stoppedOffline: boolean;
}

export interface DrainDeps {
  queryClient: QueryClient;
  restaurantId: string | null;
  /** V2-07: current outlet. Entries queued under a different outlet are
   *  marked failed (visible conflict) instead of silently misposted. */
  outletId: string | null;
  onSynced?: (count: number) => void;
  onFailed?: (count: number) => void;
}

/** Replay one entry through its RPC. Throws on network or server errors. */
export async function replaySyncEntry(entry: SyncEntry): Promise<void> {
  switch (entry.type) {
    case "wastage":
      await logWastage(entry.payload);
      break;
    case "usage":
      await logUsage(entry.payload);
      break;
    case "receiving":
      await receiveGoods(entry.payload);
      break;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "Unknown error");
}

export async function drainSyncQueue(deps: DrainDeps): Promise<DrainResult> {
  const result: DrainResult = {
    attempted: 0,
    synced: 0,
    failed: 0,
    stoppedOffline: false,
  };
  if (!isOnline() || deps.restaurantId === null) {
    return result;
  }
  const entries = getPendingSyncEntries().filter(
    (entry) => entry.restaurantId === deps.restaurantId,
  );
  for (const entry of entries) {
    result.attempted++;
    // V2-07: an outlet switch while offline must not silently mispost.
    // Entries tagged with a different outlet become visible conflicts.
    if (
      entry.outletId !== null &&
      deps.outletId !== null &&
      entry.outletId !== deps.outletId
    ) {
      markSyncEntryFailed(
        entry.id,
        "Queued at a different outlet. Switch back to that outlet to sync, or discard and re-enter.",
      );
      result.failed++;
      continue;
    }
    markSyncEntrySyncing(entry.id);
    try {
      await replaySyncEntry(entry);
      removeSyncEntry(entry.id);
      result.synced++;
    } catch (err) {
      if (isNetworkError(err)) {
        markSyncEntryPending(entry.id);
        result.stoppedOffline = true;
        break;
      }
      markSyncEntryFailed(entry.id, errorMessage(err));
      result.failed++;
    }
  }
  if (result.synced > 0) {
    // Same invalidation set as the online mutations — the ledger changed.
    void deps.queryClient.invalidateQueries({ queryKey: stockQueryKey });
    void deps.queryClient.invalidateQueries({ queryKey: itemsQueryKey });
    void deps.queryClient.invalidateQueries({ queryKey: recipesQueryKey });
    deps.onSynced?.(result.synced);
  }
  if (result.failed > 0) {
    deps.onFailed?.(result.failed);
  }
  return result;
}

const DRAIN_INTERVAL_MS = 30_000;

/**
 * Starts the sync engine for the signed-in session. Mount once inside the
 * authenticated tree (AppShell). Drains on mount (previous-session entries),
 * on the `online` event, and every 30s while entries remain.
 */
export function useSyncEngine(): void {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const { profile } = useAuth();
  const restaurantId = profile?.restaurantId ?? null;
  const outletId = profile?.currentOutletId ?? null;

  useEffect(() => {
    if (restaurantId === null) {
      return;
    }
    const deps: DrainDeps = {
      queryClient,
      restaurantId,
      outletId,
      onSynced: (count) => {
        success(
          count === 1
            ? "1 queued entry synced."
            : `${count} queued entries synced.`,
        );
      },
      onFailed: (count) => {
        toastError(
          count === 1
            ? "1 queued entry failed to sync — review it in the queue."
            : `${count} queued entries failed to sync — review them in the queue.`,
        );
      },
    };
    if (isOnline()) {
      void drainSyncQueue(deps);
    }
    const onOnline = () => {
      void drainSyncQueue(deps);
    };
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => {
      if (getPendingSyncEntries().length > 0) {
        void drainSyncQueue(deps);
      }
    }, DRAIN_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [queryClient, success, toastError, restaurantId, outletId]);
}
