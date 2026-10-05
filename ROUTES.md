# ROUTES.md — Every route, component, role access, status

> Table: path | component | roles | linked from | status | e2e spec
> Status: TODO / IN_PROGRESS / DONE. Updated every task. The route audit (P0-06) crawls this file.

| path                   | component                                     | roles                 | linked from  | status | e2e spec                 |
| ---------------------- | --------------------------------------------- | --------------------- | ------------ | ------ | ------------------------ |
| `/login`               | `features/auth/LoginPage`                     | public                | redirect     | DONE   | `e2e/auth.spec.ts` (deferred: P0-04b) |
| `/reset-password`      | `features/auth/ResetPasswordPage`             | public                | login        | DONE   | `e2e/auth.spec.ts` (deferred: P0-04b) |
| `/`                    | `features/home/HomePage`                      | owner, manager, staff | AppShell nav | DONE   | `e2e/smoke.spec.ts` |
| `/dashboard`           | `features/dashboard/DashboardPage`            | owner, manager        | AppShell nav | TODO   | `e2e/dashboard.spec.ts`  |
| `/items`               | `features/items/ItemsPage`                    | owner, manager        | AppShell nav | DONE   | `e2e/items.spec.ts`      |
| `/items/:id`           | `features/items/ItemDetailPage`               | owner, manager        | items list   | DONE   | `e2e/stock.spec.ts`      |
| `/suppliers`           | `features/suppliers/SuppliersPage`            | owner, manager        | AppShell nav | DONE   | `e2e/suppliers.spec.ts`  |
| `/suppliers/:id/prices` | `features/suppliers/SupplierPricesPage`       | owner, manager        | suppliers list | DONE | `e2e/prices.spec.ts`     |
| `/purchase-orders`     | `features/purchasing/PurchaseOrdersPage`      | owner, manager        | AppShell nav | DONE   | `e2e/purchasing.spec.ts` |
| `/purchase-orders/:id` | `features/purchasing/PurchaseOrderDetailPage` | owner, manager        | PO list      | DONE   | `e2e/purchasing.spec.ts` |
| `/purchase-orders/:id/print` | `features/purchasing/PurchaseOrderPrintPage` | owner, manager        | PO detail    | DONE   | `e2e/purchasing.spec.ts` |
| `/receiving`           | `features/stock/ReceivingPage`                | owner, manager, staff | AppShell nav | DONE   | `e2e/stock.spec.ts`      |
| `/stock`               | `features/stock/StockOverviewPage`            | owner, manager        | AppShell nav | DONE   | `e2e/stock.spec.ts`      |
| `/wastage`             | `features/stock/WastagePage`                  | owner, manager, staff | AppShell nav | DONE   | `e2e/stock.spec.ts`      |
| `/recipes`             | `features/recipes/RecipesPage`                | owner, manager        | AppShell nav | DONE   | `e2e/recipes.spec.ts`    |
| `/sales`               | `features/sales/SalesEntryPage`               | owner, manager        | AppShell nav | DONE   | `e2e/sales.spec.ts`      |
| `/stock-counts`        | `features/counts/StockCountsPage`             | owner, manager, staff | AppShell nav | DONE   | `e2e/counts.spec.ts`     |
| `/stock-counts/:id`    | `features/counts/CountSheetPage`              | owner, manager, staff | counts list  | DONE   | `e2e/counts.spec.ts`     |
| `/reports`             | `features/reports/ReportsPage`                | owner, manager        | AppShell nav | TODO   | `e2e/reports.spec.ts`    |
| `/audit-log`           | `features/admin/AuditLogPage`                 | owner                 | AppShell nav | TODO   | `e2e/admin.spec.ts`      |
| `/users`               | `features/admin/UsersPage`                    | owner                 | AppShell nav | TODO   | `e2e/admin.spec.ts`      |
| `/settings`            | `features/settings/SettingsPage`              | owner, manager        | AppShell nav | DONE   | `e2e/settings.spec.ts`   |
| `*`                    | `components/NotFoundPage`                     | public                | —            | DONE   | `e2e/smoke.spec.ts` |

_Run 0: planned routes only. Components and specs are created by their tasks (P0-04 auth, P0-05 shell, then feature phases)._
