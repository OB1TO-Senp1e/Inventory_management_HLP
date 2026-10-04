import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  archiveCategory,
  archiveLocation,
  countCategoryItems,
  countLocationItems,
  createCategory,
  createLocation,
  deleteCategory,
  deleteLocation,
  listCategories,
  listLocations,
  updateCategory,
  updateLocation,
  type TaxonomyItem,
} from "@/api/taxonomy";
import {
  itemCategoriesQueryKey,
  itemsQueryKey,
  storageLocationsQueryKey,
} from "@/features/items/hooks";
import type {
  CreateTaxonomyInput,
  UpdateTaxonomyInput,
} from "@/schemas/taxonomy";

/**
 * Settings/taxonomy data hooks (P1-02). Components never call the API
 * module directly; they use these hooks.
 *
 * Invalidation is load-bearing here: every mutation invalidates
 * - the taxonomy lists themselves,
 * - the item-form dropdown queries (`itemCategoriesQueryKey` /
 *   `storageLocationsQueryKey`, owned by the items feature), so the item
 *   form reflects creates, renames and archives immediately,
 * - the items list (a renamed category/location changes displayed names).
 *
 * RLS stays the real authorization; the route guard keeps staff out of
 * /settings entirely.
 */

export const taxonomyQueryKey = ["taxonomy"] as const;
const categoriesKey = [...taxonomyQueryKey, "categories"] as const;
const locationsKey = [...taxonomyQueryKey, "locations"] as const;

/** The two taxonomy kinds managed on the settings screen. */
export type TaxonomyKind = "category" | "location";

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Invalidate everything a taxonomy change can affect. */
function useInvalidateTaxonomy() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: taxonomyQueryKey });
    void queryClient.invalidateQueries({ queryKey: itemCategoriesQueryKey });
    void queryClient.invalidateQueries({ queryKey: storageLocationsQueryKey });
    void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
  };
}

/** Active categories for the settings screen. Disabled until profile loads. */
export function useCategories() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: categoriesKey,
    queryFn: () => listCategories(true),
    enabled: restaurantId !== null,
  });
}

/** Active storage locations for the settings screen. */
export function useLocations() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: locationsKey,
    queryFn: () => listLocations(true),
    enabled: restaurantId !== null,
  });
}

/**
 * How many items reference a category. Fetched lazily — the settings UI
 * only needs it when the delete dialog for that row opens.
 */
export function useCategoryUsage(id: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...taxonomyQueryKey, "category-usage", id],
    queryFn: () => countCategoryItems(id as string),
    enabled: restaurantId !== null && id !== null,
  });
}

/** How many items reference a storage location (lazy, same as above). */
export function useLocationUsage(id: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...taxonomyQueryKey, "location-usage", id],
    queryFn: () => countLocationItems(id as string),
    enabled: restaurantId !== null && id !== null,
  });
}

/**
 * Kind-dispatched usage count for the delete dialog. Both underlying hooks
 * run unconditionally (rules-of-hooks safe); the inactive one stays disabled
 * via its null id and performs no fetch.
 */
export function useTaxonomyUsage(kind: TaxonomyKind, id: string | null) {
  const categoryUsage = useCategoryUsage(kind === "category" ? id : null);
  const locationUsage = useLocationUsage(kind === "location" ? id : null);
  return kind === "category" ? categoryUsage : locationUsage;
}

function useTaxonomyMutation<TInput, TResult>(opts: {
  mutationFn: (input: TInput) => Promise<TResult>;
  successMessage: string;
  errorMessage: string;
}) {
  const invalidate = useInvalidateTaxonomy();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: opts.mutationFn,
    onSuccess: () => {
      invalidate();
      success(opts.successMessage);
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : opts.errorMessage);
    },
  });
}

/** Create a category; `restaurantId` is injected from the auth profile. */
export function useCreateCategory() {
  const restaurantId = useRestaurantId();
  return useTaxonomyMutation({
    mutationFn: (input: Omit<CreateTaxonomyInput, "restaurantId">) => {
      if (!restaurantId) {
        throw new Error("Your profile is still loading. Please try again.");
      }
      return createCategory({ ...input, restaurantId });
    },
    successMessage: "Category created.",
    errorMessage: "Could not create the category.",
  });
}

/** Rename a category. */
export function useUpdateCategory() {
  return useTaxonomyMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaxonomyInput }) =>
      updateCategory(id, input),
    successMessage: "Category updated.",
    errorMessage: "Could not update the category.",
  });
}

/** Archive a category (soft delete). */
export function useArchiveCategory() {
  return useTaxonomyMutation({
    mutationFn: (id: string) => archiveCategory(id),
    successMessage: "Category archived.",
    errorMessage: "Could not archive the category.",
  });
}

/** Hard-delete a category; the API refuses when items still reference it. */
export function useDeleteCategory() {
  return useTaxonomyMutation({
    mutationFn: (id: string) => deleteCategory(id),
    successMessage: "Category deleted.",
    errorMessage: "Could not delete the category.",
  });
}

/** Create a storage location; `restaurantId` is injected from the profile. */
export function useCreateLocation() {
  const restaurantId = useRestaurantId();
  return useTaxonomyMutation({
    mutationFn: (input: Omit<CreateTaxonomyInput, "restaurantId">) => {
      if (!restaurantId) {
        throw new Error("Your profile is still loading. Please try again.");
      }
      return createLocation({ ...input, restaurantId });
    },
    successMessage: "Location created.",
    errorMessage: "Could not create the location.",
  });
}

/** Rename a storage location. */
export function useUpdateLocation() {
  return useTaxonomyMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaxonomyInput }) =>
      updateLocation(id, input),
    successMessage: "Location updated.",
    errorMessage: "Could not update the location.",
  });
}

/** Archive a storage location (soft delete). */
export function useArchiveLocation() {
  return useTaxonomyMutation({
    mutationFn: (id: string) => archiveLocation(id),
    successMessage: "Location archived.",
    errorMessage: "Could not archive the location.",
  });
}

/** Hard-delete a location; the API refuses when items still reference it. */
export function useDeleteLocation() {
  return useTaxonomyMutation({
    mutationFn: (id: string) => deleteLocation(id),
    successMessage: "Location deleted.",
    errorMessage: "Could not delete the location.",
  });
}

export type { TaxonomyItem };
