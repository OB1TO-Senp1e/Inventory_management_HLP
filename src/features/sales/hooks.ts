import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import {
  previewSalesDeductions,
  recordSales,
  type RecordSalesResult,
  type SalesPreviewItem,
} from "@/api/sales";
import {
  importPosSales,
  listImportedExternalIds,
  type PosImportResult,
} from "@/api/pos";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import type { RecordSalesInput } from "@/schemas/sales";
import type { ImportPosSalesInput } from "@/schemas/pos";

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
export const posImportsQueryKey = ["sales", "pos-imports"] as const;

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

/**
 * Preview the deductions for a sales entry BEFORE posting (P4-04). The
 * entry form calls `mutateAsync` on submit; rows with `wouldGoNegative`
 * drive the explicit-confirm dialog. Errors toast — the entry simply does
 * not proceed. No success toast: a preview is not an action.
 */
export function usePreviewSalesDeductions() {
  const { error: toastError } = useToast();
  return useMutation<SalesPreviewItem[], Error, RecordSalesInput>({
    mutationFn: (input) => previewSalesDeductions(input),
    onError: (err) => {
      toastError(err.message);
    },
  });
}

/**
 * External sale ids already imported for a provider (V2-06). Disabled
 * until a provider is chosen; the import preview uses this to mark
 * "already imported" lines so they can never be posted twice.
 */
export function useImportedExternalIds(providerId: string | null) {
  return useQuery({
    queryKey: [...posImportsQueryKey, providerId],
    queryFn: () => listImportedExternalIds(providerId ?? ""),
    enabled: providerId !== null,
  });
}

/**
 * Import POS sales through the `import_pos_sales` RPC (V2-06). The RPC
 * posts atomically via `record_sales`, so the same invalidation + toast
 * treatment as `useRecordSales` applies; the toast additionally reports
 * the import count.
 */
export function useImportPosSales() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<PosImportResult, Error, ImportPosSalesInput>({
    mutationFn: (input) => importPosSales(input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      void queryClient.invalidateQueries({ queryKey: recipesQueryKey });
      void queryClient.invalidateQueries({ queryKey: posImportsQueryKey });
      const totalDishes = result.sales.lines.reduce(
        (sum, line) => sum + line.dishes,
        0,
      );
      success(
        `Imported ${result.imported} POS ${result.imported === 1 ? "sale" : "sales"} ` +
          `for ${result.saleDate}: ${totalDishes} ${totalDishes === 1 ? "dish" : "dishes"}, ` +
          `${result.sales.ingredients.length} ${result.sales.ingredients.length === 1 ? "ingredient" : "ingredients"} deducted.`,
      );
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}
