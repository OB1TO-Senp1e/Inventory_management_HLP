import { Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ProtectedRoute } from "./ProtectedRoute";
import { RoleGuard } from "./RoleGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NotFoundPage } from "@/components/NotFoundPage";
import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/features/home/HomePage";
import { SectionFallback } from "./SectionFallback";
import { routeAccess } from "./access";
import type { UserRole } from "@/schemas/role";

/**
 * The authenticated half of the app, loaded as one chunk (P6-03).
 * Section pages are themselves React.lazy, so they become child chunks
 * of this one and download only when their route is visited.
 */
const ItemsPage = lazy(() =>
  import("@/features/items/ItemsPage").then((m) => ({ default: m.ItemsPage })),
);
const ItemDetailPage = lazy(() =>
  import("@/features/items/ItemDetailPage").then((m) => ({ default: m.ItemDetailPage })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const SuppliersPage = lazy(() =>
  import("@/features/suppliers/SuppliersPage").then((m) => ({ default: m.SuppliersPage })),
);
const SupplierPricesPage = lazy(() =>
  import("@/features/suppliers/SupplierPricesPage").then((m) => ({
    default: m.SupplierPricesPage,
  })),
);
const ReceivingPage = lazy(() =>
  import("@/features/stock/ReceivingPage").then((m) => ({ default: m.ReceivingPage })),
);
const InvoiceScanPage = lazy(() =>
  import("@/features/invoice/InvoiceScanPage").then((m) => ({
    default: m.InvoiceScanPage,
  })),
);
const PurchaseOrdersPage = lazy(() =>
  import("@/features/purchasing/PurchaseOrdersPage").then((m) => ({
    default: m.PurchaseOrdersPage,
  })),
);
const PurchaseOrderDetailPage = lazy(() =>
  import("@/features/purchasing/PurchaseOrderDetailPage").then((m) => ({
    default: m.PurchaseOrderDetailPage,
  })),
);
const PurchaseOrderPrintPage = lazy(() =>
  import("@/features/purchasing/PurchaseOrderPrintPage").then((m) => ({
    default: m.PurchaseOrderPrintPage,
  })),
);
const StockOverviewPage = lazy(() =>
  import("@/features/stock/StockOverviewPage").then((m) => ({ default: m.StockOverviewPage })),
);
const WastagePage = lazy(() =>
  import("@/features/stock/WastagePage").then((m) => ({ default: m.WastagePage })),
);
const TransfersPage = lazy(() =>
  import("@/features/transfers/TransfersPage").then((m) => ({
    default: m.TransfersPage,
  })),
);
const RecipesPage = lazy(() =>
  import("@/features/recipes/RecipesPage").then((m) => ({ default: m.RecipesPage })),
);
const SalesEntryPage = lazy(() =>
  import("@/features/sales/SalesEntryPage").then((m) => ({ default: m.SalesEntryPage })),
);
const StockCountsPage = lazy(() =>
  import("@/features/counts/StockCountsPage").then((m) => ({ default: m.StockCountsPage })),
);
const CountSheetPage = lazy(() =>
  import("@/features/counts/CountSheetPage").then((m) => ({ default: m.CountSheetPage })),
);
const DashboardPage = lazy(() =>
  import("@/features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ReportsPage = lazy(() =>
  import("@/features/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const AuditLogPage = lazy(() =>
  import("@/features/admin/AuditLogPage").then((m) => ({ default: m.AuditLogPage })),
);
const NotificationsPage = lazy(() =>
  import("@/features/alerts/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);

type RoleEntry = [string, { roles: UserRole[] }];

function isRoleEntry(entry: [string, { public: true } | { roles: UserRole[] }]): entry is RoleEntry {
  return "roles" in entry[1];
}

/** Wrap a lazy section page with the chunk-loading fallback. */
function lazySection(element: ReactNode): ReactNode {
  return <Suspense fallback={<SectionFallback />}>{element}</Suspense>;
}

/**
 * Sections whose pages have shipped. Each feature task adds its page here;
 * unbuilt sections keep rendering the designed 404 until their feature task
 * swaps in a real page.
 */
const builtSections: Record<string, ReactNode> = {
  "/items": lazySection(<ItemsPage />),
  "/items/:id": lazySection(<ItemDetailPage />),
  "/settings": lazySection(<SettingsPage />),
  "/suppliers": lazySection(<SuppliersPage />),
  "/suppliers/:id/prices": lazySection(<SupplierPricesPage />),
  "/receiving": lazySection(<ReceivingPage />),
  "/receiving/invoice": lazySection(<InvoiceScanPage />),
  "/stock": lazySection(<StockOverviewPage />),
  "/wastage": lazySection(<WastagePage />),
  "/transfers": lazySection(<TransfersPage />),
  "/purchase-orders": lazySection(<PurchaseOrdersPage />),
  "/purchase-orders/:id": lazySection(<PurchaseOrderDetailPage />),
  "/purchase-orders/:id/print": lazySection(<PurchaseOrderPrintPage />),
  "/recipes": lazySection(<RecipesPage />),
  "/sales": lazySection(<SalesEntryPage />),
  "/stock-counts": lazySection(<StockCountsPage />),
  "/stock-counts/:id": lazySection(<CountSheetPage />),
  "/dashboard": lazySection(<DashboardPage />),
  "/reports": lazySection(<ReportsPage />),
  "/audit-log": lazySection(<AuditLogPage />),
  "/notifications": lazySection(<NotificationsPage />),
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

export function AuthenticatedApp() {
  return (
    <Routes>
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
  );
}
