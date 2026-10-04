import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  listReceivableItems,
  logUsage,
  logWastage,
  receiveGoods,
  type LogMovementResult,
  type ReceivableItem,
  type ReceiveGoodsResult,
} from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import type {
  LogUsageInput,
  LogWastageInput,
  ReceiveGoodsInput,
} from "@/schemas/stock";

/**
 * Receiving hooks (P2-02). Components never call the API module directly.
 *
 * `useReceivableItems` feeds the receipt line item picker: active items as
 * id + name + unit symbol via the `list_receivable_items` RPC — no cost
 * columns, so staff (who use this picker per the role matrix) never see
 * costs. Item management stays owner/manager-only.
 */

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

export interface ReceivableItems {
  items: ReceivableItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useReceivableItems(): ReceivableItems {
  const restaurantId = useRestaurantId();
  const query = useQuery({
    queryKey: [...stockQueryKey, "receivableItems"],
    queryFn: () => listReceivableItems(),
    enabled: restaurantId !== null,
  });
  return {
    items: query.data ?? [],
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

/**
 * Log wastage. On success the stock queries are invalidated (fresh
 * current-stock everywhere) and a toast confirms; the page resets its form
 * for the next quick entry. Staff log wastage constantly, so this stays a
 * one-shot mutation with no report view.
 */
export function useLogWastage() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<LogMovementResult, Error, LogWastageInput>({
    mutationFn: (input) => logWastage(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      success("Wastage logged.");
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}

/**
 * Log usage (consumed in prep, staff meals, tastings). Same contract as
 * `useLogWastage`.
 */
export function useLogUsage() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<LogMovementResult, Error, LogUsageInput>({
    mutationFn: (input) => logUsage(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stockQueryKey });
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      success("Usage logged.");
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}
