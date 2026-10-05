import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import {
  createOutlet,
  deactivateOutlet,
  listAllOutlets,
  listOutlets,
  reactivateOutlet,
  switchOutlet as apiSwitchOutlet,
  updateOutlet,
} from "@/api/outlets";
import type { Outlet } from "@/schemas/outlet";

/**
 * Outlet hooks (V2-07). The outlet list is restaurant-scoped and changes
 * rarely; the current outlet lives in the auth profile. Switching outlets
 * invalidates every stock query so all views re-scope to the new outlet.
 */

export const outletsQueryKey = ["outlets"];
export const allOutletsQueryKey = ["outlets", "all"];

/** Active outlets of the caller's restaurant (for the switcher). */
export function useOutlets() {
  return useQuery({
    queryKey: outletsQueryKey,
    queryFn: listOutlets,
    staleTime: 60_000,
  });
}

/** All outlets incl. deactivated (owner management). */
export function useAllOutlets(enabled: boolean) {
  return useQuery({
    queryKey: allOutletsQueryKey,
    queryFn: listAllOutlets,
    enabled,
    staleTime: 60_000,
  });
}

/** The caller's current outlet (from the profile + the outlet list). */
export function useCurrentOutlet(): Outlet | null | undefined {
  const { profile } = useAuth();
  const { data: outlets } = useOutlets();
  if (!profile?.currentOutletId || !outlets) {
    return profile?.currentOutletId === null ? null : undefined;
  }
  return outlets.find((o) => o.id === profile.currentOutletId) ?? null;
}

/**
 * Switch the caller's outlet context. On success the profile is refreshed
 * and every query is invalidated — stock, counts, dashboard and reports
 * all re-scope to the new outlet via RLS.
 */
export function useSwitchOutlet() {
  const queryClient = useQueryClient();
  const { refreshProfile } = useAuth();
  const { error: showError, success } = useToast();
  return useMutation({
    mutationFn: (outletId: string) => apiSwitchOutlet({ outletId }),
    onSuccess: async (outlet) => {
      success(`Switched to ${outlet.name}.`);
      // TEST-ONLY: keep the ri.mockOutlet hook in sync so the mocked
      // profile reflects the switch after refreshProfile().
      try {
        if (window.localStorage.getItem("ri.mockRole")) {
          window.localStorage.setItem("ri.mockOutlet", outlet.id);
        }
      } catch {
        // Storage unavailable — the real backend path doesn't need this.
      }
      await refreshProfile();
      await queryClient.invalidateQueries();
    },
    onError: (err) => {
      showError(err instanceof Error ? err.message : "Could not switch outlet.");
    },
  });
}

function useInvalidateOutlets() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: outletsQueryKey });
    void queryClient.invalidateQueries({ queryKey: allOutletsQueryKey });
  };
}

/** Create an outlet (owner only). */
export function useCreateOutlet() {
  const invalidate = useInvalidateOutlets();
  const { error: showError, success } = useToast();
  return useMutation({
    mutationFn: createOutlet,
    onSuccess: (outlet) => {
      invalidate();
      success(`Outlet "${outlet.name}" created.`);
    },
    onError: (err) => {
      showError(err instanceof Error ? err.message : "Could not create outlet.");
    },
  });
}

/** Rename / re-address an outlet (owner only). */
export function useUpdateOutlet() {
  const invalidate = useInvalidateOutlets();
  const { error: showError, success } = useToast();
  return useMutation({
    mutationFn: updateOutlet,
    onSuccess: (outlet) => {
      invalidate();
      success(`Outlet "${outlet.name}" updated.`);
    },
    onError: (err) => {
      showError(err instanceof Error ? err.message : "Could not update outlet.");
    },
  });
}

/** Deactivate an outlet (owner only). Surfaces the DB guard's message. */
export function useDeactivateOutlet() {
  const invalidate = useInvalidateOutlets();
  const { error: showError, success } = useToast();
  return useMutation({
    mutationFn: deactivateOutlet,
    onSuccess: (outlet) => {
      invalidate();
      success(`Outlet "${outlet.name}" deactivated.`);
    },
    onError: (err) => {
      showError(err instanceof Error ? err.message : "Could not deactivate outlet.");
    },
  });
}

/** Reactivate an outlet (owner only). */
export function useReactivateOutlet() {
  const invalidate = useInvalidateOutlets();
  const { error: showError, success } = useToast();
  return useMutation({
    mutationFn: reactivateOutlet,
    onSuccess: (outlet) => {
      invalidate();
      success(`Outlet "${outlet.name}" reactivated.`);
    },
    onError: (err) => {
      showError(err instanceof Error ? err.message : "Could not reactivate outlet.");
    },
  });
}
