import { Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { LoginPage } from "@/features/auth/LoginPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { RoleGuard } from "./RoleGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NotFoundPage } from "@/components/NotFoundPage";
import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/features/home/HomePage";
import { ItemsPage } from "@/features/items/ItemsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { SuppliersPage } from "@/features/suppliers/SuppliersPage";
import { SupplierPricesPage } from "@/features/suppliers/SupplierPricesPage";
import { routeAccess } from "./access";
import type { UserRole } from "@/schemas/role";

type RoleEntry = [string, { roles: UserRole[] }];

function isRoleEntry(entry: [string, { public: true } | { roles: UserRole[] }]): entry is RoleEntry {
  return "roles" in entry[1];
}

/**
 * Sections whose pages have shipped. Each feature task adds its page here;
 * unbuilt sections keep rendering the designed 404 until their task lands.
 * (Detail routes like /items/:id stay 404 until their own task — never link
 * to them from list screens.)
 */
const builtSections: Record<string, ReactNode> = {
  "/items": <ItemsPage />,
  "/settings": <SettingsPage />,
  "/suppliers": <SuppliersPage />,
  "/suppliers/:id/prices": <SupplierPricesPage />,
};

/**
 * One guarded route per planned section. Sections whose pages land in their
 * feature tasks render the 404 until then — each task swaps its real page in
 * here. Nav links stay live and the role guards keep enforcing the matrix.
 */
function sectionRoutes() {
  return Object.entries(routeAccess)
    .filter(isRoleEntry)
    .map(([path, access]) => (
      <Route
        key={path}
        path={path}
        element={
          <RoleGuard allowedRoles={access.roles}>
            <ErrorBoundary key={path}>
              {builtSections[path] ?? <NotFoundPage />}
            </ErrorBoundary>
          </RoleGuard>
        }
      />
    ));
}

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
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route
            path="/"
            element={
              <ErrorBoundary key="home">
                <HomePage />
              </ErrorBoundary>
            }
          />
          {sectionRoutes()}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
