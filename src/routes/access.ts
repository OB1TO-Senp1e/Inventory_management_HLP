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
  "/items/:id": { roles: ["owner", "manager"] },
  "/suppliers": { roles: ["owner", "manager"] },
  "/suppliers/:id/prices": { roles: ["owner", "manager"] },
  "/purchase-orders": { roles: ["owner", "manager"] },
  "/purchase-orders/:id": { roles: ["owner", "manager"] },
  "/purchase-orders/:id/print": { roles: ["owner", "manager"] },
  "/receiving": { roles: ["owner", "manager", "staff"] },
  "/stock": { roles: ["owner", "manager"] },
  "/wastage": { roles: ["owner", "manager", "staff"] },
  "/recipes": { roles: ["owner", "manager"] },
  "/sales": { roles: ["owner", "manager"] },
  "/stock-counts": { roles: ["owner", "manager", "staff"] },
  "/stock-counts/:id": { roles: ["owner", "manager", "staff"] },
  "/reports": { roles: ["owner", "manager"] },
  "/audit-log": { roles: ["owner"] },
  "/notifications": { roles: ["owner", "manager"] },
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

/**
 * True when `path` matches a registered route pattern. `:param` segments
 * match any single path segment ("/suppliers/:id" matches "/suppliers/abc").
 * Used by Breadcrumbs so trail segments only link to real routes — a crumb
 * for an unregistered path (e.g. "/suppliers/abc" — there is no supplier
 * detail page) renders as plain text instead of a link to a 404.
 */
export function isRegisteredPath(path: string): boolean {
  return Object.keys(routeAccess).some((pattern) => {
    const regex = new RegExp(
      "^" +
        pattern
          .split("/")
          .map((seg) =>
            seg.startsWith(":")
              ? "[^/]+"
              : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/") +
        "$",
    );
    return regex.test(path);
  });
}
