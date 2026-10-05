import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { getDashboardSummary } from "@/api/dashboard";
import { stockQueryKey } from "@/features/items/stockHooks";
import { subscribeToStockMovements } from "@/api/stock";

/**
 * Dashboard hooks (P5-03). Components never call the API module directly.
 *
 * The summary query (today's usage/wastage + stock value) lives under the
 * stock query key, so every stock-changing mutation (receiving, usage,
 * wastage, sales, count adjustments) invalidates it alongside the rest of
 * the stock queries. Low-stock and expiring-soon counts come from the
 * existing `useStockOverview` query — the same data the /stock page
 * renders, so the cards always match.
 */

export const dashboardQueryKey = [...stockQueryKey, "dashboard"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Today's usage/wastage totals and total stock value. */
export function useDashboardSummary() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => getDashboardSummary(),
    enabled: restaurantId !== null,
  });
}

/**
 * Realtime updates for the dashboard: on every new ledger movement the
 * summary query is invalidated. Best-effort like the overview realtime —
 * silent without a backend or without realtime enabled on the table.
 */
export function useDashboardRealtime() {
  const queryClient = useQueryClient();
  const restaurantId = useRestaurantId();
  useEffect(() => {
    if (restaurantId === null) {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToStockMovements(() => {
        void queryClient.invalidateQueries({ queryKey: dashboardQueryKey });
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
