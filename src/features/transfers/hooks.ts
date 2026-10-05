import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { transferStock } from "@/api/transfers";
import { outletsQueryKey } from "@/features/outlets/hooks";

/**
 * Transfer hooks (V2-07). A successful transfer invalidates stock queries
 * (both outlets' views re-scope via RLS) and the outlet list.
 */
export function useTransferStock() {
  const queryClient = useQueryClient();
  const { error: showError, success } = useToast();
  return useMutation({
    mutationFn: transferStock,
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      void queryClient.invalidateQueries({ queryKey: outletsQueryKey });
      const batch = result.batchNo ? ` (batch ${result.batchNo})` : "";
      success(
        `Transferred ${result.quantity} ${result.unitSymbol} ${result.itemName}${batch} ` +
          `from ${result.fromOutletName} to ${result.toOutletName}.`,
      );
    },
    onError: (err) => {
      showError(
        err instanceof Error ? err.message : "Could not complete the transfer.",
      );
    },
  });
}
