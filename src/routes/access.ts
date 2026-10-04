import type { UserRole } from "@/schemas/role";

/**
 * Route access map. Mirrors ROUTES.md (which is the source of truth) and the
 * role matrix in ARCHITECTURE.md §7. P0-05 (AppShell) uses this to render
 * navigation per role; RoleGuard receives the `roles` list directly.
 */
export type RouteAccess = { public: true } | { roles: UserRole[] };

export const routeAccess: Record<string, RouteAccess> = {
  "/login": { public: true },
  "/reset-password": { public: true },
  "/dashboard": { roles: ["owner", "manager"] },
  "/items": { roles: ["owner", "manager"] },
  "/suppliers": { roles: ["owner", "manager"] },
  "/purchase-orders": { roles: ["owner", "manager"] },
  "/receiving": { roles: ["owner", "manager", "staff"] },
  "/stock": { roles: ["owner", "manager"] },
  "/wastage": { roles: ["owner", "manager", "staff"] },
  "/recipes": { roles: ["owner", "manager"] },
  "/sales": { roles: ["owner", "manager"] },
  "/stock-counts": { roles: ["owner", "manager", "staff"] },
  "/reports": { roles: ["owner", "manager"] },
  "/audit-log": { roles: ["owner"] },
  "/users": { roles: ["owner"] },
  "/settings": { roles: ["owner", "manager"] },
};

/** True when `role` may visit `path`. Unknown paths are denied by default. */
export function canAccessPath(path: string, role: UserRole | null): boolean {
  if (!role) {
    return false;
  }
  const access = routeAccess[path];
  if (!access || "public" in access) {
    return false;
  }
  return access.roles.includes(role);
}
