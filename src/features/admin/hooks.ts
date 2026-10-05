import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { listAuditLogEntries } from "@/api/admin";
import type { ListAuditLogInput } from "@/schemas/auditLog";

/**
 * Admin hooks (P5-05). Components never call the API module directly.
 *
 * The audit log is read-only and owner-only; there are no mutations here.
 * The query is enabled once the profile (and therefore the restaurant) is
 * known — a non-owner never reaches this page (RoleGuard), and RLS would
 * return zero rows for them anyway.
 */

export const auditLogQueryKey = ["admin", "audit-log"] as const;

function useRestaurantId(): string | null {
  const { profile } = useAuth();
  return profile?.restaurantId ?? null;
}

/** Paginated, filtered audit entries, newest first. */
export function useAuditLog(input: ListAuditLogInput) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: [...auditLogQueryKey, input],
    queryFn: () => listAuditLogEntries(input),
    enabled: restaurantId !== null,
  });
}
