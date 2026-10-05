import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  addIngredient,
  archiveMenuItem,
  createMenuItem,
  getMenuItem,
  listMenuItems,
  listUnitConversions,
  removeIngredient,
  updateIngredient,
  updateMenuItem,
} from "@/api/recipes";
import { listUnits } from "@/api/items";
import { subscribeToStockMovements } from "@/api/stock";
import type {
  CreateMenuItemInput,
  ListMenuItemsInput,
  RecipeIngredientInput,
  UpdateMenuItemInput,
} from "@/schemas/recipe";

/**
 * Recipes data hooks (P4-01). Components never call the API module
 * directly; they use these hooks. All mutations invalidate the menu-item
 * list and detail on success and surface toasts; RLS stays the real
 * authorization.
 */

export const recipesQueryKey = ["recipes"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Menu item list. Disabled until the profile loads. */
export function useMenuItems(input: ListMenuItemsInput) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...recipesQueryKey, "list", input],
    queryFn: () => listMenuItems(input),
    enabled: restaurantId !== null,
  });
}

/** Single menu item with ingredient lines. Disabled until the profile loads. */
export function useMenuItem(id: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...recipesQueryKey, "detail", id],
    queryFn: () => getMenuItem(id as string),
    enabled: restaurantId !== null && id !== null,
  });
}

/** All units (for the ingredient unit picker). */
export function useUnits() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...recipesQueryKey, "units"],
    queryFn: listUnits,
    enabled: restaurantId !== null,
  });
}

/** Explicit unit conversions for the restaurant. */
export function useUnitConversions() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...recipesQueryKey, "conversions"],
    queryFn: listUnitConversions,
    enabled: restaurantId !== null,
  });
}

function useInvalidateRecipes() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: recipesQueryKey });
}

/** Create a menu item, then navigate to it. */
export function useCreateMenuItem() {
  const { profile } = useAuth();
  const { success, error: notifyError } = useToast();
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: (input: CreateMenuItemInput) =>
      createMenuItem(input, profile?.restaurantId as string),
    onSuccess: (item) => {
      invalidate();
      success(`Recipe "${item.name}" created.`);
    },
    onError: (error) =>
      notifyError(
        error instanceof Error ? error.message : "Could not create the recipe.",
        ),
  });
}

/** Edit a menu item's header fields. */
export function useUpdateMenuItem() {
  const { success, error: notifyError } = useToast();
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMenuItemInput }) =>
      updateMenuItem(id, input),
    onSuccess: () => {
      invalidate();
      success("Recipe updated.");
    },
    onError: (error) =>
      notifyError(
        error instanceof Error ? error.message : "Could not update the recipe.",
        ),
  });
}

/** Archive a menu item. */
export function useArchiveMenuItem() {
  const { success, error: notifyError } = useToast();
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: (id: string) => archiveMenuItem(id),
    onSuccess: () => {
      invalidate();
      success("Recipe archived.");
    },
    onError: (error) =>
      notifyError(
        error instanceof Error ? error.message : "Could not archive the recipe.",
        ),
  });
}

/** Add an ingredient line. */
export function useAddIngredient() {
  const { profile } = useAuth();
  const { success, error: notifyError } = useToast();
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: ({
      menuItemId,
      input,
    }: {
      menuItemId: string;
      input: RecipeIngredientInput;
    }) => addIngredient(menuItemId, input, profile?.restaurantId as string),
    onSuccess: () => {
      invalidate();
      success("Ingredient added.");
    },
    onError: (error) =>
      notifyError(
        error instanceof Error ? error.message : "Could not add the ingredient.",
        ),
  });
}

/** Edit an ingredient line. */
export function useUpdateIngredient() {
  const { success, error: notifyError } = useToast();
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecipeIngredientInput }) =>
      updateIngredient(id, input),
    onSuccess: () => {
      invalidate();
      success("Ingredient updated.");
    },
    onError: (error) =>
      notifyError(
        error instanceof Error
          ? error.message
          : "Could not update the ingredient.",
      ),
  });
}

/** Remove an ingredient line. */
export function useRemoveIngredient() {
  const { success, error: notifyError } = useToast();
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: (id: string) => removeIngredient(id),
    onSuccess: () => {
      invalidate();
      success("Ingredient removed.");
    },
    onError: (error) =>
      notifyError(
        error instanceof Error
          ? error.message
          : "Could not remove the ingredient.",
      ),
  });
}

/**
 * Realtime cost updates (P4-02). Any new ledger movement can change an
 * item's `avg_unit_cost` (receiving recalculates the weighted average),
 * which changes recipe costs — the cost is derived live, never stored. On
 * every INSERT the recipe queries are invalidated so the list refreshes
 * without a reload. Best-effort like the stock hooks: silent without a
 * backend or without realtime enabled on the table.
 */
export function useRecipeCostRealtime() {
  const queryClient = useQueryClient();
  const restaurantId = useRestaurantId();
  useEffect(() => {
    if (restaurantId === null) {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToStockMovements(() => {
        void queryClient.invalidateQueries({ queryKey: recipesQueryKey });
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
