import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import {
  getFoodCostTrend,
  getMenuEngineeringReport,
  getPriceChangeReport,
  getUsageReport,
  getWastageReport,
} from "@/api/reports";
import type { ReportRange } from "@/schemas/reports";

/**
 * Reports hooks (P5-04). Components never call the API module directly.
 *
 * All four reports are read-only aggregations over the ledger and price
 * history; they share the stock query key family so any stock-changing
 * mutation refreshes them alongside the dashboard and overview.
 */

export const reportsQueryKey = ["reports"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

function rangeKey(range: ReportRange): string {
  return `${range.from}..${range.to}`;
}

/** Usage (kitchen use + sale deductions) per item in the range. */
export function useUsageReport(range: ReportRange) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...reportsQueryKey, "usage", rangeKey(range), restaurantId],
    queryFn: () => getUsageReport(range),
    enabled: restaurantId !== null,
  });
}

/** Wastage grouped by reason code in the range. */
export function useWastageReport(range: ReportRange) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...reportsQueryKey, "wastage", rangeKey(range), restaurantId],
    queryFn: () => getWastageReport(range),
    enabled: restaurantId !== null,
  });
}

/** Daily food-cost (₹) trend in the range. */
export function useFoodCostTrend(range: ReportRange) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...reportsQueryKey, "food-cost", rangeKey(range), restaurantId],
    queryFn: () => getFoodCostTrend(range),
    enabled: restaurantId !== null,
  });
}

/** Supplier price changes (events + net-change summaries) in the range. */
export function usePriceChangeReport(range: ReportRange) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...reportsQueryKey, "price-changes", rangeKey(range), restaurantId],
    queryFn: () => getPriceChangeReport(range),
    enabled: restaurantId !== null,
  });
}

/**
 * Menu engineering (V2-02): dish popularity vs profitability quadrants in
 * the range. Shares the reports query key family so stock-changing
 * mutations refresh it alongside the other reports.
 */
export function useMenuEngineeringReport(range: ReportRange) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [
      ...reportsQueryKey,
      "menu-engineering",
      rangeKey(range),
      restaurantId,
    ],
    queryFn: () => getMenuEngineeringReport(range),
    enabled: restaurantId !== null,
  });
}
