import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { createOpeningBalance, getCurrentStock } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
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
      success("Opening balance posted.");
    },
    onError: (err: Error) => {
      toastError(err.message);
    },
  });
}
