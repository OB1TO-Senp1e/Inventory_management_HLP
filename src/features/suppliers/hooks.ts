import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  archiveSupplier,
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "@/api/suppliers";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "@/schemas/supplier";

/**
 * Suppliers data hooks (P1-03). Components never call the API module
 * directly; they use these hooks. All mutations invalidate the suppliers
 * list on success and surface toasts; RLS stays the real authorization.
 */

export const suppliersQueryKey = ["suppliers"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Paginated, filtered, sorted supplier list. Disabled until the profile loads. */
export function useSuppliers(input: ListSuppliersQuery) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...suppliersQueryKey, "list", input],
    queryFn: () => listSuppliers(input),
    enabled: restaurantId !== null,
  });
}

/** Single supplier (edit dialog). */
export function useSupplier(id: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...suppliersQueryKey, "detail", id],
    queryFn: () => getSupplier(id as string),
    enabled: restaurantId !== null && id !== null,
  });
}

function useInvalidateSuppliers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: suppliersQueryKey });
  };
}

/** Create a supplier; `restaurantId` is injected from the auth profile. */
export function useCreateSupplier() {
  const invalidate = useInvalidateSuppliers();
  const { success, error } = useToast();
  const restaurantId = useRestaurantId();
  return useMutation({
    mutationFn: (input: Omit<CreateSupplierInput, "restaurantId">) => {
      if (!restaurantId) {
        throw new Error("Your profile is still loading. Please try again.");
      }
      return createSupplier({ ...input, restaurantId });
    },
    onSuccess: () => {
      invalidate();
      success("Supplier created.");
    },
    onError: (err: unknown) => {
      error(
        err instanceof Error ? err.message : "Could not create the supplier.",
      );
    },
  });
}

/** Update a supplier's editable fields. */
export function useUpdateSupplier() {
  const invalidate = useInvalidateSuppliers();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSupplierInput }) =>
      updateSupplier(id, input),
    onSuccess: () => {
      invalidate();
      success("Supplier updated.");
    },
    onError: (err: unknown) => {
      error(
        err instanceof Error ? err.message : "Could not update the supplier.",
      );
    },
  });
}

/** Archive a supplier (soft delete). */
export function useArchiveSupplier() {
  const invalidate = useInvalidateSuppliers();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (id: string) => archiveSupplier(id),
    onSuccess: () => {
      invalidate();
      success("Supplier archived.");
    },
    onError: (err: unknown) => {
      error(
        err instanceof Error ? err.message : "Could not archive the supplier.",
      );
    },
  });
}
