import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { recordSales, type RecordSalesResult } from "@/api/sales";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import type { RecordSalesInput } from "@/schemas/sales";

/**
 * Sales hooks (P4-03). Components never call the API module directly.
 *
 * `useRecordSales` posts one day's sales through the `record_sales` RPC.
 * On success the stock queries are invalidated (fresh current-stock
 * everywhere) and a toast summarizes the posted entry. Menu items are read
 * through the existing recipes hooks — this feature owns no menu-item
 * queries of its own.
 */

export const salesQueryKey = ["sales"] as const;

/**
 * Record a day's sales. On success stock + item queries are invalidated
 * (deductions change current stock) and a toast confirms the totals.
 */
export function useRecordSales() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<RecordSalesResult, Error, RecordSalesInput>({
    mutationFn: (input) => recordSales(input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      // Sales deduct stock, which can move items in/out of low-stock —
      // refresh the recipes list too (its costs are live anyway).
      void queryClient.invalidateQueries({ queryKey: recipesQueryKey });
      const totalDishes = result.lines.reduce(
        (sum, line) => sum + line.dishes,
        0,
      );
      const dishWord = totalDishes === 1 ? "dish" : "dishes";
      const ingWord =
        result.ingredients.length === 1 ? "ingredient" : "ingredients";
      success(
        `Sales recorded for ${result.saleDate}: ${totalDishes} ${dishWord}, ` +
          `${result.ingredients.length} ${ingWord} deducted.`,
      );
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}
