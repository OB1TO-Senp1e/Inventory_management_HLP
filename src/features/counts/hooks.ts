import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import {
  createStockCount,
  getStockCount,
  listStockCounts,
  saveCountLine,
  submitStockCount,
  updateStockCountStatus,
  type StockCount,
  type StockCountDetail,
  type StockCountLine,
} from "@/api/counts";
import { listProfiles, type AssigneeProfile } from "@/api/auth";
import type {
  CreateStockCountInput,
  SaveCountLineInput,
} from "@/schemas/count";

/**
 * Stock count hooks (P5-01). Components never call the API module directly.
 *
 * `useStockCounts` lists the sessions visible to the caller (owner/manager:
 * all; staff: assigned only — RLS is the authority). `useStockCount`
 * loads one session with its count sheet. Progress saves go through
 * `useSaveCountLine` (debounced at the component level); submission through
 * `useSubmitStockCount`.
 */

export const countsQueryKey = ["stock-counts"] as const;
export const countDetailKey = (id: string) =>
  [...countsQueryKey, id] as const;

/** List the count sessions visible to the caller, newest first. */
export function useStockCounts(): UseQueryResult<StockCount[], Error> {
  return useQuery({
    queryKey: countsQueryKey,
    queryFn: listStockCounts,
  });
}

/** Load one count session with its count sheet. */
export function useStockCount(
  id: string | null,
): UseQueryResult<StockCountDetail, Error> {
  return useQuery({
    queryKey: countDetailKey(id ?? ""),
    queryFn: () => getStockCount(id as string),
    enabled: id !== null,
  });
}

/** Users of the caller's restaurant, for the assignee picker (owner/manager only). */
export function useAssignees(options?: { enabled?: boolean }): UseQueryResult<AssigneeProfile[], Error> {
  return useQuery({
    queryKey: [...countsQueryKey, "assignees"] as const,
    queryFn: listProfiles,
    enabled: options?.enabled ?? true,
  });
}

/** Create a count session (+ snapshot lines). */
export function useCreateStockCount() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<StockCount, Error, CreateStockCountInput>({
    mutationFn: (input) => createStockCount(input),
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: countsQueryKey });
      success(`Stock count "${count.title}" created.`);
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}

export interface SaveCountLineVariables extends SaveCountLineInput {
  /** Id of the session, for query invalidation. */
  countIdForKey: string;
}

/**
 * Save one counted quantity. The component debounces rapid keystrokes; this
 * hook posts the settled value. The detail query is NOT invalidated on
 * success — the component owns the optimistic line state, and refetching
 * would clobber in-progress typing on other rows. Only the list (progress
 * %) refreshes.
 */
export function useSaveCountLine() {
  const queryClient = useQueryClient();
  const { error: toastError } = useToast();
  return useMutation<StockCountLine, Error, SaveCountLineVariables>({
    mutationFn: (vars) =>
      saveCountLine({
        countId: vars.countId,
        itemId: vars.itemId,
        countedQty: vars.countedQty,
      }),
    onSuccess: (_line, vars) => {
      // exact: true — the detail query (["stock-counts", id]) is patched
      // below instead of refetched; a fuzzy invalidation would refetch it
      // and clobber the optimistic line state.
      void queryClient.invalidateQueries({
        queryKey: countsQueryKey,
        exact: true,
      });
      // Keep the detail query's line state in sync for this line without a
      // full refetch (the component's optimistic state is authoritative).
      queryClient.setQueryData<StockCountDetail | undefined>(
        countDetailKey(vars.countIdForKey),
        (old) => {
          if (!old) {
            return old;
          }
          const lines = old.lines.map((line) =>
            line.itemId === vars.itemId
              ? { ...line, countedQty: vars.countedQty }
              : line,
          );
          return {
            ...old,
            lines,
            countedLines: lines.filter(
              (line) => line.countedQty !== null,
            ).length,
          };
        },
      );
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}

/** Submit a session for variance review (P5-02 picks it up from here). */
export function useSubmitStockCount() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  return useMutation<StockCount, Error, string>({
    mutationFn: (countId) => submitStockCount(countId),
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: countsQueryKey });
      void queryClient.invalidateQueries({
        queryKey: countDetailKey(count.id),
      });
      success(`Count "${count.title}" submitted for review.`);
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}

/** Move a session's status along the draft → in_progress → submitted machine. */
export function useUpdateStockCountStatus() {
  const queryClient = useQueryClient();
  const { error: toastError } = useToast();
  return useMutation<
    StockCount,
    Error,
    { countId: string; status: "draft" | "in_progress" | "submitted" }
  >({
    mutationFn: ({ countId, status }) =>
      updateStockCountStatus(countId, status),
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: countsQueryKey });
      void queryClient.invalidateQueries({
        queryKey: countDetailKey(count.id),
      });
    },
    onError: (err) => {
      toastError(err.message);
    },
  });
}
