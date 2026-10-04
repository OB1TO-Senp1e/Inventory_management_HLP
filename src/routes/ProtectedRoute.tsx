import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/useAuth";
import { AuthLoading } from "./AuthLoading";

/**
 * Renders children only when a session exists. Otherwise redirects to
 * /login, preserving the originally requested path so the login page can
 * send the user back after a successful sign in.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <AuthLoading />;
  }
  if (status !== "signed-in") {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
    );
  }
  return <>{children}</>;
}
