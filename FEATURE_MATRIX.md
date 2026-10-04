# FEATURE_MATRIX.md — Screen → component → api fn → DB object → test

> Table: screen/action | component | api function | DB object (table/RPC/view) | RLS roles | test file
> No empty cells allowed once a row is DONE. The wiring audit (P0-06) parses this file.
> Run 0: structure only — rows are added as tasks complete their vertical slices.

| screen/action                    | component | api function | DB object | RLS roles | test file |
| -------------------------------- | --------- | ------------ | --------- | --------- | --------- |
| Sign in                          | `features/auth/LoginPage` | `signIn` | GoTrue `auth.users` | public | `src/api/auth.test.ts`, `src/features/auth/LoginPage.test.tsx` |
| Reset password                     | `features/auth/ResetPasswordPage` | `resetPassword` | GoTrue `auth.users` | public | `src/api/auth.test.ts` |
| Sign out                           | `features/auth/SignOutButton` | `signOut` | GoTrue `auth.users` | owner, manager, staff | `src/api/auth.test.ts` |
| Session restore + role load        | `features/auth/AuthProvider` | `getSession`, `getCurrentProfile`, `onAuthStateChange` | `profiles` | owner, manager, staff | `src/api/auth.test.ts` |
| Protected route redirect           | `routes/ProtectedRoute` | `getSession` (via AuthProvider) | `profiles` | owner, manager, staff | `src/routes/guards.test.tsx` |
| Role-based route guard             | `routes/RoleGuard` (+ `routes/access.ts` map) | `getCurrentProfile` (via AuthProvider) | `profiles` | owner, manager, staff | `src/routes/guards.test.tsx` |
| App shell layout + role navigation | `components/layout/AppShell` (+ `AppNav`, `routes/nav.ts`) | — (client only; role via AuthProvider) | `profiles` (role) | owner, manager, staff | `src/components/layout/AppShell.test.tsx`, `src/routes/nav.test.ts` |
| Toast notifications (success/error) | `components/toast/ToastProvider` (+ `useToast`) | — | — | owner, manager, staff | `src/components/toast/ToastProvider.test.tsx` |
| Route error boundary | `components/ErrorBoundary` | — | — | owner, manager, staff | `src/components/ErrorBoundary.test.tsx` |
| 404 page | `components/NotFoundPage` | — | — | public | `src/components/NotFoundPage.test.tsx` |
| Breadcrumbs + page header | `components/layout/Breadcrumbs`, `components/PageHeader` | — | — | owner, manager, staff | `src/components/layout/Breadcrumbs.test.tsx`, `src/components/PageHeader.test.tsx` |
| Role-aware landing | `features/home/HomePage` | — | `profiles` (role) | owner, manager, staff | `src/features/home/HomePage.test.tsx` |

## Planned coverage (checklist, not yet rows)

- [x] Auth: sign in/out/reset → `profiles` → unit tests done in P0-04a; live GoTrue e2e (`e2e/auth.spec.ts`) deferred to P0-04b
- [ ] Items CRUD → `items` → `supabase/tests/items_rls_test.sql`
- [ ] Suppliers + price list → `suppliers`, `supplier_prices` → e2e + db tests
- [ ] Receiving (`receive_goods`) → `stock_movements` → RPC tests
- [ ] Wastage/usage (`log_wastage`, `log_usage`) → `stock_movements` → RPC tests
- [ ] Stock overview + item detail → `current_stock` view → e2e
- [ ] Purchase orders lifecycle → `purchase_orders`, `purchase_order_lines` → e2e + db tests
- [ ] Recipes + costing → `menu_items`, `recipe_ingredients` → unit + e2e
- [ ] Sales entry (`record_sales`) → `stock_movements` → RPC + e2e
- [ ] Stock counts (`apply_stock_count`) → `stock_counts`, `stock_movements` → RPC + e2e
- [ ] Dashboard + reports → views → e2e
- [ ] Audit log + user management → `audit_log`, `profiles` → e2e + RLS tests
