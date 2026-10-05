import { Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { LoginPage } from "@/features/auth/LoginPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SectionFallback } from "./SectionFallback";

/**
 * The authenticated app (shell + all sections) is a separate chunk (P6-03).
 * The initial entry bundle is just the public auth pages, so first paint
 * for a logged-out user parses far less JavaScript. Logged-in users fetch
 * the shell chunk once, after the session check starts.
 */
const AuthenticatedApp = lazy(() =>
  import("./AuthenticatedApp").then((m) => ({ default: m.AuthenticatedApp })),
);

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <ErrorBoundary key="login">
              <LoginPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/reset-password"
          element={
            <ErrorBoundary key="reset-password">
              <ResetPasswordPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/*"
          element={
            <Suspense fallback={<SectionFallback />}>
              <AuthenticatedApp />
            </Suspense>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
