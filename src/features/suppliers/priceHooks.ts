import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  listPriceHistory,
  listPricesByItem,
  listPricesBySupplier,
  setPreferredSupplier,
  upsertPrice,
} from "@/api/prices";
import type {
  ListPriceHistoryInput,
  SetPreferredSupplierInput,
  UpsertPriceInput,
} from "@/schemas/price";

/**
 * Supplier price-list data hooks (P1-04). Components never call the API
 * module directly; they use these hooks. All mutations invalidate the
 * price-list queries on success and surface toasts; RLS stays the real
 * authorization. Price changes are audited server-side by the
 * `record_supplier_price_history()` trigger.
 */

export const pricesQueryKey = ["supplier-prices"] as const;
export const priceHistoryQueryKey = ["supplier-price-history"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** All price rows for one supplier, ordered by item name. */
export function useSupplierPrices(supplierId: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...pricesQueryKey, "by-supplier", supplierId],
    queryFn: () => listPricesBySupplier({ supplierId: supplierId as string }),
    enabled: restaurantId !== null && supplierId !== null,
  });
}

/** All price rows for one item across suppliers, cheapest first. */
export function useItemPrices(itemId: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...pricesQueryKey, "by-item", itemId],
    queryFn: () => listPricesByItem({ itemId: itemId as string }),
    enabled: restaurantId !== null && itemId !== null,
  });
}

/** Price-change history, newest first. Disabled until at least one filter. */
export function usePriceHistory(input: ListPriceHistoryInput) {
  const restaurantId = useRestaurantId();
  const enabled =
    restaurantId !== null &&
    (input.supplierId !== undefined || input.itemId !== undefined);
  return useQuery({
    queryKey: [...priceHistoryQueryKey, input],
    queryFn: () => listPriceHistory(input),
    enabled,
  });
}

function useInvalidatePrices() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    void queryClient.invalidateQueries({ queryKey: priceHistoryQueryKey });
  };
}

/** Insert or update a price; `restaurantId` is injected from the profile. */
export function useUpsertPrice() {
  const invalidate = useInvalidatePrices();
  const { success, error } = useToast();
  const restaurantId = useRestaurantId();
  return useMutation({
    mutationFn: (
      input: Omit<UpsertPriceInput, "restaurantId">,
    ) => {
      if (!restaurantId) {
        throw new Error("Your profile is still loading. Please try again.");
      }
      return upsertPrice({ ...input, restaurantId });
    },
    onSuccess: () => {
      invalidate();
      success("Price saved.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not save the price.");
    },
  });
}

/** Atomically switch the preferred supplier for an item. */
export function useSetPreferredSupplier() {
  const invalidate = useInvalidatePrices();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (input: SetPreferredSupplierInput) =>
      setPreferredSupplier(input),
    onSuccess: () => {
      invalidate();
      success("Preferred supplier updated.");
    },
    onError: (err: unknown) => {
      error(
        err instanceof Error
          ? err.message
          : "Could not update the preferred supplier.",
      );
    },
  });
}
