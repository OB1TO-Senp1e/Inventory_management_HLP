import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/useAuth";
import type { UserRole } from "@/schemas/role";
import { AuthLoading } from "./AuthLoading";

/**
 * Renders children only when the signed-in user's role is in `allowedRoles`.
 * Nest inside <ProtectedRoute>. Anyone else is sent to "/", which P0-05
 * (AppShell) turns into a role-aware landing page.
 */
export function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: UserRole[];
  children: ReactNode;
}) {
  const { status, profile } = useAuth();

  if (status === "loading") {
    return <AuthLoading />;
  }
  if (status !== "signed-in" || !profile || !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
