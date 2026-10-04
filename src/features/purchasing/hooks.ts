import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  removePurchaseOrderLine,
  sendPurchaseOrder,
  updatePurchaseOrder,
  type ListPurchaseOrdersInput,
  type ReceivePurchaseOrderInput,
} from "@/api/purchasing";
import type {
  CreatePurchaseOrderInput,
  PurchaseOrderStatus,
  UpdatePurchaseOrderInput,
} from "@/schemas/purchaseOrder";
import { listPricesBySupplier } from "@/api/prices";

/**
 * Purchasing data hooks (P3-01). Components never call the API module
 * directly; they use these hooks. All mutations invalidate the PO list and
 * detail on success and surface toasts; RLS stays the real authorization.
 */

export const purchaseOrdersQueryKey = ["purchase-orders"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Paginated PO list. Disabled until the profile loads. */
export function usePurchaseOrders(input: ListPurchaseOrdersInput) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...purchaseOrdersQueryKey, "list", input],
    queryFn: () => listPurchaseOrders(input),
    enabled: restaurantId !== null,
  });
}

/** Single PO with lines. Disabled until the profile loads. */
export function usePurchaseOrder(id: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...purchaseOrdersQueryKey, "detail", id],
    queryFn: () => getPurchaseOrder(id as string),
    enabled: restaurantId !== null && id !== null,
  });
}

/**
 * The supplier's current price list, for PO line prefill. Each line's
 * unit price is snapshotted from here at PO creation.
 */
export function useSupplierPricesForPrefill(supplierId: string | null) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...purchaseOrdersQueryKey, "prefill", supplierId],
    queryFn: () => listPricesBySupplier({ supplierId: supplierId as string }),
    enabled: restaurantId !== null && supplierId !== null,
  });
}

function useInvalidatePOs() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: [...purchaseOrdersQueryKey, "list"] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: [...purchaseOrdersQueryKey, "detail", id] });
    }
  };
}

/** Create a draft PO (atomic via RPC). Returns the new PO id. */
export function useCreatePurchaseOrder() {
  const { success, error } = useToast();
  const invalidate = useInvalidatePOs();
  return useMutation({
    mutationFn: (input: CreatePurchaseOrderInput) => createPurchaseOrder(input),
    onSuccess: () => {
      invalidate();
      success("Purchase order created as draft.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not create the purchase order.");
    },
  });
}

/** Edit a draft PO's header. */
export function useUpdatePurchaseOrder() {
  const { success, error } = useToast();
  const invalidate = useInvalidatePOs();
  return useMutation({
    mutationFn: (input: UpdatePurchaseOrderInput) => updatePurchaseOrder(input),
    onSuccess: (_, input) => {
      invalidate(input.id);
      success("Purchase order updated.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not update the purchase order.");
    },
  });
}

export interface AddLineInput {
  poId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

/** Add a line to a draft PO. */
export function useAddPurchaseOrderLine() {
  const { success, error } = useToast();
  const invalidate = useInvalidatePOs();
  const restaurantId = useRestaurantId();
  return useMutation({
    mutationFn: (input: AddLineInput) => {
      if (!restaurantId) {
        throw new Error("Sign in again — your restaurant could not be determined.");
      }
      return addPurchaseOrderLine({ ...input, restaurantId });
    },
    onSuccess: (_, input) => {
      invalidate(input.poId);
      success("Line added.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not add the line.");
    },
  });
}

/** Remove a line from a draft PO. */
export function useRemovePurchaseOrderLine() {
  const { success, error } = useToast();
  const invalidate = useInvalidatePOs();
  return useMutation({
    mutationFn: (input: { lineId: string; poId: string }) => removePurchaseOrderLine(input.lineId),
    onSuccess: (_, input) => {
      invalidate(input.poId);
      success("Line removed.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not remove the line.");
    },
  });
}

export type { PurchaseOrderStatus };

/** Send a draft PO (draft → sent). */
export function useSendPurchaseOrder() {
  const { success, error } = useToast();
  const invalidate = useInvalidatePOs();
  return useMutation({
    mutationFn: (id: string) => sendPurchaseOrder(id),
    onSuccess: (_, id) => {
      invalidate(id);
      success("Purchase order sent to the supplier.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not send the purchase order.");
    },
  });
}

/** Cancel a draft or sent PO. */
export function useCancelPurchaseOrder() {
  const { success, error } = useToast();
  const invalidate = useInvalidatePOs();
  return useMutation({
    mutationFn: (id: string) => cancelPurchaseOrder(id),
    onSuccess: (_, id) => {
      invalidate(id);
      success("Purchase order cancelled.");
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not cancel the purchase order.");
    },
  });
}

/**
 * Receive against a sent/partially_received PO. Posts receipt movements
 * (cost = the PO's snapshotted unit prices), so the stock overview and
 * item queries are invalidated alongside the PO queries.
 */
export function useReceivePurchaseOrder() {
  const { success, error } = useToast();
  const queryClient = useQueryClient();
  const invalidate = useInvalidatePOs();
  return useMutation({
    mutationFn: (input: ReceivePurchaseOrderInput) => receivePurchaseOrder(input),
    onSuccess: (result, input) => {
      invalidate(input.id);
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      success(
        result.status === "received"
          ? "All lines received — purchase order closed."
          : "Receipt posted — purchase order partially received.",
      );
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not post the receipt.");
    },
  });
}
