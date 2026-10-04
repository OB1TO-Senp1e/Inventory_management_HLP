import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  archiveItem,
  createItem,
  getItem,
  listItemCategories,
  listItems,
  listStorageLocations,
  listUnits,
  updateItem,
  type LookupOption,
} from "@/api/items";
import type {
  CreateItemInput,
  ListItemsQuery,
  UpdateItemInput,
} from "@/schemas/item";

/**
 * Items data hooks (P1-01). Components never call the API module directly;
 * they use these hooks. All mutations invalidate the items list on success
 * and surface toasts; RLS stays the real authorization.
 */

export const itemsQueryKey = ["items"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Paginated, filtered, sorted item list. Disabled until the profile loads. */
export function useItems(input: ListItemsQuery) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...itemsQueryKey, "list", input],
    queryFn: () => listItems(input),
    enabled: restaurantId !== null,
  });
}

/** Single item (edit dialog). */
export function useItem(id: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...itemsQueryKey, "detail", id],
    queryFn: () => getItem(id as string),
    enabled: restaurantId !== null && id !== null,
  });
}

export interface ItemLookups {
  categories: LookupOption[];
  locations: LookupOption[];
  units: LookupOption[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Dropdown options for the item form (categories, locations, units). */
export function useItemLookups(): ItemLookups {
  const restaurantId = useRestaurantId();
  const enabled = restaurantId !== null;
  const categories = useQuery({
    queryKey: ["item-categories"],
    queryFn: listItemCategories,
    enabled,
  });
  const locations = useQuery({
    queryKey: ["storage-locations"],
    queryFn: listStorageLocations,
    enabled,
  });
  const units = useQuery({
    queryKey: ["units"],
    queryFn: listUnits,
    enabled,
  });
  return {
    categories: categories.data ?? [],
    locations: locations.data ?? [],
    units: units.data ?? [],
    isLoading:
      categories.isLoading || locations.isLoading || units.isLoading,
    isError: categories.isError || locations.isError || units.isError,
    refetch: () => {
      void categories.refetch();
      void locations.refetch();
      void units.refetch();
    },
  };
}

function useInvalidateItems() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
  };
}

/** Create an item; `restaurantId` is injected from the auth profile. */
export function useCreateItem() {
  const invalidate = useInvalidateItems();
  const { success, error } = useToast();
  const restaurantId = useRestaurantId();
  return useMutation({
    mutationFn: (input: Omit<CreateItemInput, "restaurantId">) => {
      if (!restaurantId) {
        throw new Error("Your profile is still loading. Please try again.");
      }
      return createItem({ ...input, restaurantId });
    },
    onSuccess: () => {
      invalidate();
      success("Item created.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not create the item.");
    },
  });
}

/** Update an item's editable fields. */
export function useUpdateItem() {
  const invalidate = useInvalidateItems();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateItemInput }) =>
      updateItem(id, input),
    onSuccess: () => {
      invalidate();
      success("Item updated.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not update the item.");
    },
  });
}

/** Archive an item (soft delete). */
export function useArchiveItem() {
  const invalidate = useInvalidateItems();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (id: string) => archiveItem(id),
    onSuccess: () => {
      invalidate();
      success("Item archived.");
    },
    onError: (err: unknown) => {
      error(
        err instanceof Error ? err.message : "Could not archive the item.",
      );
    },
  });
}
