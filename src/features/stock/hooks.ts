import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  listReceivableItems,
  logUsage,
  logWastage,
  receiveGoods,
  type LogMovementResult,
  type ReceivableItem,
  type ReceiveGoodsResult,
} from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import { isNetworkError, isOnline } from "@/features/sync/offline";
import { enqueueSyncEntry } from "@/features/sync/queue";
import {
  isQueuedSubmission,
  type QueuedSubmission,
  type SyncEntryType,
} from "@/features/sync/types";
import type {
  LogUsageInput,
  LogWastageInput,
  ReceiveGoodsInput,
} from "@/schemas/stock";

/**
 * Receiving hooks (P2-02). Components never call the API module directly.
 *
 * `useReceivableItems` feeds the receipt line item picker: active items as
 * id + name + unit symbol via the `list_receivable_items` RPC — no cost
 * columns, so staff (who use this picker per the role matrix) never see
 * costs. Item management stays owner/manager-only.
 */

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/**
 * Offline queue wrapper (P6-02). When the device is offline the submission
 * is stored locally and a `QueuedSubmission` sentinel is returned instead
 * of the RPC result; when a live RPC call fails with a network error the
 * submission is queued the same way. Server-side rejections (validation,
 * archived item, RLS) are NOT network errors and propagate as before.
 */
async function submitWithOfflineQueue<TInput, TResult>(
  type: SyncEntryType,
  input: TInput,
  restaurantId: string | null,
  apiCall: (input: TInput) => Promise<TResult>,
): Promise<TResult | QueuedSubmission> {
  if (restaurantId === null) {
    throw new Error(
      "Couldn't determine your restaurant — please reload and try again.",
    );
  }
  if (!isOnline()) {
    const entry = enqueueSyncEntry({ type, restaurantId, payload: input });
    return { queued: true, entryId: entry.id };
  }
  try {
    return await apiCall(input);
  } catch (err) {
    if (isNetworkError(err)) {
      const entry = enqueueSyncEntry({ type, restaurantId, payload: input });
      return { queued: true, entryId: entry.id };
    }
    throw err;
  }
}

export interface ReceivableItems {
  items: ReceivableItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useReceivableItems(): ReceivableItems {
  const restaurantId = useRestaurantId();
  const query = useQuery({
    queryKey: [...stockQueryKey, "receivableItems"],
    queryFn: () => listReceivableItems(),
    enabled: restaurantId !== null,
  });
  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Post an ad hoc receipt. On success the items list and stock queries are
 * invalidated (fresh avg costs everywhere) and a toast confirms; the page
 * renders the detailed per-line report from the RPC result.
 *
 * Offline (P6-02): the receipt is queued locally and the page shows a
 * queued state instead of the report — the entry posts when connectivity
 * returns.
 */
export function useReceiveGoods() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const restaurantId = useRestaurantId();
  return useMutation<ReceiveGoodsResult | QueuedSubmission, Error, ReceiveGoodsInput>({
    // `networkMode: "always"`: TanStack Query pauses mutations while offline
    // by default, which would leave the form stuck in "pending" — the queue
    // wrapper above owns the offline decision instead.
    networkMode: "always",
    mutationFn: (input) =>
      submitWithOfflineQueue("receiving", input, restaurantId, receiveGoods),
    onSuccess: (result) => {
      if (isQueuedSubmission(result)) {
        success(
          "No connection — receipt queued. It will post when you're back online.",
        );
        return;
      }
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      // Receiving recalculates avg_unit_cost, which feeds recipe costing
      // (P4-02): refresh the recipes list/detail so costs update at once.
      void queryClient.invalidateQueries({ queryKey: recipesQueryKey });
      const lineWord = result.lines.length === 1 ? "line" : "lines";
      success(`Receipt posted: ${result.lines.length} ${lineWord}.`);
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}

/**
 * Log wastage. On success the stock queries are invalidated (fresh
 * current-stock everywhere) and a toast confirms; the page resets its form
 * for the next quick entry. Staff log wastage constantly, so this stays a
 * one-shot mutation with no report view.
 *
 * Offline (P6-02): the entry is queued locally and confirmed with a
 * "queued" toast — it posts when connectivity returns.
 */
export function useLogWastage() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const restaurantId = useRestaurantId();
  return useMutation<LogMovementResult | QueuedSubmission, Error, LogWastageInput>({
    // `networkMode: "always"`: see useReceiveGoods — the queue owns the
    // offline decision, so the mutation must run even when offline.
    networkMode: "always",
    mutationFn: (input) =>
      submitWithOfflineQueue("wastage", input, restaurantId, logWastage),
    onSuccess: (result) => {
      if (isQueuedSubmission(result)) {
        success(
          "No connection — wastage queued. It will post when you're back online.",
        );
        return;
      }
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      success("Wastage logged.");
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}

/**
 * Log usage (consumed in prep, staff meals, tastings). Same contract as
 * `useLogWastage`, including the offline queue behavior.
 */
export function useLogUsage() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const restaurantId = useRestaurantId();
  return useMutation<LogMovementResult | QueuedSubmission, Error, LogUsageInput>({
    // `networkMode: "always"`: see useReceiveGoods — the queue owns the
    // offline decision, so the mutation must run even when offline.
    networkMode: "always",
    mutationFn: (input) =>
      submitWithOfflineQueue("usage", input, restaurantId, logUsage),
    onSuccess: (result) => {
      if (isQueuedSubmission(result)) {
        success(
          "No connection — usage queued. It will post when you're back online.",
        );
        return;
      }
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      success("Usage logged.");
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}
