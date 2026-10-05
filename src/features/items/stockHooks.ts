import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  createOpeningBalance,
  getCurrentStock,
  listBatches,
  listMovements,
  listStockOverview,
  subscribeToItemMovements,
  subscribeToStockMovements,
} from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import type { CreateOpeningBalanceInput } from "@/schemas/stock";

/**
 * Stock ledger data hooks (P2-01). Components never call the API module
 * directly; they use these hooks. Mutations invalidate the items list on
 * success (fresh stock figures everywhere) and surface toasts.
 *
 * There is deliberately no update/delete hook: the ledger is append-only.
 */

export const stockQueryKey = ["stock"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Derived stock for one item, from the `current_stock` view. */
export function useCurrentStock(itemId: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...stockQueryKey, "current", itemId],
    queryFn: () => getCurrentStock({ itemId: itemId as string }),
    enabled: restaurantId !== null && itemId !== null,
  });
}

/** Post the one-time opening balance for an item (owner/manager only). */
export function useCreateOpeningBalance() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation({
    mutationFn: (input: CreateOpeningBalanceInput) =>
      createOpeningBalance(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      // Opening balance seeds avg_unit_cost, which feeds recipe costing
      // (P4-02): refresh the recipes list/detail so costs update at once.
      void queryClient.invalidateQueries({ queryKey: recipesQueryKey });
      success("Opening balance posted.");
    },
    onError: (err: Error) => {
      toastError(err.message);
    },
  });
}

/** Ledger page size for the item detail history (P2-04). */
export const LEDGER_PAGE_SIZE = 20;

/**
 * Paginated ledger history for one item, newest first. Keeps the previous
 * page's rows while the next page loads (no layout flash on pagination).
 */
export function useItemMovements(itemId: string | null, page: number) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...stockQueryKey, "movements", itemId, page],
    queryFn: () =>
      listMovements({ itemId: itemId as string, page, pageSize: LEDGER_PAGE_SIZE }),
    enabled: restaurantId !== null && itemId !== null,
    placeholderData: (previous) => previous,
  });
}

/** Per-batch totals for one item (aggregated client-side in the API). */
export function useItemBatches(itemId: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...stockQueryKey, "batches", itemId],
    queryFn: () => listBatches({ itemId: itemId as string }),
    enabled: restaurantId !== null && itemId !== null,
  });
}

/**
 * Realtime ledger updates for one item: on every new movement, the
 * current-stock, ledger and batch queries for the item are invalidated so
 * the detail page updates without a refresh. Best-effort — without a
 * Supabase backend (or without realtime enabled on the table) the
 * subscription never fires and the page simply works through refetch.
 */
export function useStockRealtime(itemId: string | null) {
  const queryClient = useQueryClient();
  const restaurantId = useRestaurantId();
  useEffect(() => {
    if (itemId === null || restaurantId === null) {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToItemMovements(itemId, () => {
        void queryClient.invalidateQueries({
          queryKey: [...stockQueryKey, "current", itemId],
        });
        void queryClient.invalidateQueries({
          queryKey: [...stockQueryKey, "movements", itemId],
        });
        void queryClient.invalidateQueries({
          queryKey: [...stockQueryKey, "batches", itemId],
        });
      });
    } catch {
      // No Supabase config (audit crawl / backend-less dev): realtime is
      // unavailable; the page works without it.
    }
    return () => {
      unsubscribe?.();
    };
  }, [itemId, restaurantId, queryClient]);
}

/**
 * Stock overview rows for every active item (P2-05): derived quantity,
 * low-stock inputs (reorder point), and earliest batch expiry. One query —
 * the API joins items + current_stock + batch expiries client-side.
 */
export function useStockOverview() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...stockQueryKey, "overview"],
    queryFn: () => listStockOverview(),
    enabled: restaurantId !== null,
  });
}

/**
 * Realtime updates for the stock overview: on every new ledger movement
 * (any item), the overview query is invalidated so the screen refreshes
 * without a reload. Best-effort like `useStockRealtime` — silent without
 * a backend or without realtime enabled on the table.
 */
export function useStockOverviewRealtime() {
  const queryClient = useQueryClient();
  const restaurantId = useRestaurantId();
  useEffect(() => {
    if (restaurantId === null) {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToStockMovements(() => {
        void queryClient.invalidateQueries({
          queryKey: [...stockQueryKey, "overview"],
        });
      });
    } catch {
      // No Supabase config (audit crawl / backend-less dev): realtime is
      // unavailable; the page works without it.
    }
    return () => {
      unsubscribe?.();
    };
  }, [restaurantId, queryClient]);
}
