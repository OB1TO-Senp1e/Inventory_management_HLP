import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { listItems, type Item } from "@/api/items";
import { receiveGoods, type ReceiveGoodsResult } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import type { ReceiveGoodsInput } from "@/schemas/stock";

/**
 * Receiving hooks (P2-02). Components never call the API module directly.
 *
 * `useReceivableItems` feeds the receipt line item picker: all active
 * items, name-sorted, one page of up to 100 (plenty for a single
 * restaurant's catalogue in v1). Staff see rows here thanks to the
 * `items_select_staff` policy (P2-02); the picker is their only item
 * surface — item management stays owner/manager-only.
 */

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

export interface ReceivableItems {
  items: Item[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useReceivableItems(): ReceivableItems {
  const restaurantId = useRestaurantId();
  const query = useQuery({
    queryKey: [...itemsQueryKey, "receivable"],
    queryFn: () =>
      listItems({
        page: 1,
        pageSize: 100,
        active: true,
        sortColumn: "name",
        sortDirection: "asc",
      }),
    enabled: restaurantId !== null,
  });
  return {
    items: query.data?.items ?? [],
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
 */
export function useReceiveGoods() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<ReceiveGoodsResult, Error, ReceiveGoodsInput>({
    mutationFn: (input) => receiveGoods(input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      const lineWord = result.lines.length === 1 ? "line" : "lines";
      success(`Receipt posted: ${result.lines.length} ${lineWord}.`);
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}
