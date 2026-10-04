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
| Items list (search, filter, sort, paginate) | `features/items/ItemsPage` | `listItems` | `items`, `item_categories`, `units`, `storage_locations` | owner, manager | `src/api/items.test.ts`, `src/features/items/hooks.test.tsx`, `src/features/items/ItemsPage.test.tsx` |
| Create item | `features/items/ItemDialog` | `createItem` | `items` | owner, manager | `src/api/items.test.ts` |
| Edit item | `features/items/ItemDialog` | `getItem`, `updateItem` | `items` | owner, manager | `src/api/items.test.ts` |
| Archive item (soft delete) | `features/items/ItemsPage` + `components/ConfirmDialog` | `archiveItem` | `items` | owner, manager | `src/api/items.test.ts` |
| Item form lookups (categories, units, locations) | `features/items/ItemDialog` | `listItemCategories`, `listStorageLocations`, `listUnits` | `item_categories`, `storage_locations`, `units` | owner, manager | `src/api/items.test.ts` |
| Settings: categories list (tabs, states) | `features/settings/SettingsPage`, `features/settings/TaxonomySection` | `listCategories` | `item_categories` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx`, `src/features/settings/SettingsPage.test.tsx` |
| Create category | `features/settings/TaxonomyDialog` | `createCategory` | `item_categories` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx` |
| Rename category | `features/settings/TaxonomyDialog` | `updateCategory` | `item_categories` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx` |
| Archive category (soft delete) | `features/settings/TaxonomySection` + `components/ConfirmDialog` | `archiveCategory` | `item_categories` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx` |
| Delete category (blocked when in use) | `features/settings/DeleteTaxonomyDialog` | `deleteCategory`, `countCategoryItems` | `item_categories`, `items` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx`, `supabase/tests/p1_02_taxonomy_test.sql` |
| Settings: storage locations list (tabs, states) | `features/settings/SettingsPage`, `features/settings/TaxonomySection` | `listLocations` | `storage_locations` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx`, `src/features/settings/SettingsPage.test.tsx` |
| Create storage location | `features/settings/TaxonomyDialog` | `createLocation` | `storage_locations` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx` |
| Rename storage location | `features/settings/TaxonomyDialog` | `updateLocation` | `storage_locations` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx` |
| Archive storage location (soft delete) | `features/settings/TaxonomySection` + `components/ConfirmDialog` | `archiveLocation` | `storage_locations` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx` |
| Delete storage location (blocked when in use) | `features/settings/DeleteTaxonomyDialog` | `deleteLocation`, `countLocationItems` | `storage_locations`, `items` | owner, manager | `src/api/taxonomy.test.ts`, `src/features/settings/hooks.test.tsx`, `supabase/tests/p1_02_taxonomy_test.sql` |
| Suppliers list (search, filter, sort, paginate) | `features/suppliers/SuppliersPage` | `listSuppliers` | `suppliers` | owner, manager | `src/api/suppliers.test.ts`, `src/features/suppliers/hooks.test.tsx`, `src/features/suppliers/SuppliersPage.test.tsx` |
| Create supplier | `features/suppliers/SupplierDialog` | `createSupplier` | `suppliers` | owner, manager | `src/api/suppliers.test.ts` |
| Edit supplier | `features/suppliers/SupplierDialog` | `getSupplier`, `updateSupplier` | `suppliers` | owner, manager | `src/api/suppliers.test.ts` |
| Archive supplier (soft delete) | `features/suppliers/SuppliersPage` + `components/ConfirmDialog` | `archiveSupplier` | `suppliers` | owner, manager | `src/api/suppliers.test.ts`, `supabase/tests/p1_03_suppliers_test.sql` |
| Supplier price list (per-item prices, ₹ en-IN) | `features/suppliers/SupplierPricesPage` | `listPricesBySupplier` | `supplier_prices`, `items`, `units` | owner, manager | `src/api/prices.test.ts`, `src/features/suppliers/priceHooks.test.tsx`, `src/features/suppliers/SupplierPricesPage.test.tsx`, `supabase/tests/p1_04_supplier_prices_test.sql` |
| Add / edit supplier price | `features/suppliers/PriceDialog` | `upsertPrice` | `supplier_prices`, `supplier_price_history` (trigger) | owner, manager | `src/api/prices.test.ts`, `supabase/tests/p1_04_supplier_prices_test.sql` |
| Set preferred supplier (atomic) | `features/suppliers/SupplierPricesPage` | `setPreferredSupplier` | RPC `set_preferred_supplier`, `supplier_prices` | owner, manager | `src/api/prices.test.ts`, `supabase/tests/p1_04_supplier_prices_test.sql` |
| Price history (date-stamped changes) | `features/suppliers/SupplierPricesPage` | `listPriceHistory` | `supplier_price_history` | owner, manager | `src/api/prices.test.ts`, `supabase/tests/p1_04_supplier_prices_test.sql` |
| Export items to CSV | `features/items/ItemsPage` + `lib/csv` | `listItems` | `items` | owner, manager | `src/lib/csv.test.ts`, `src/features/importExport/hooks.test.tsx` |
| Import items from CSV (validation preview + error report) | `components/CsvImportDialog` + `features/importExport/itemCsv` | `createItem` | `items`, `item_categories`, `units`, `storage_locations` | owner, manager | `src/components/CsvImportDialog.test.tsx`, `src/features/importExport/itemCsv.test.ts`, `src/features/importExport/hooks.test.tsx` |
| Export suppliers to CSV | `features/suppliers/SuppliersPage` + `lib/csv` | `listSuppliers` | `suppliers` | owner, manager | `src/lib/csv.test.ts`, `src/features/importExport/hooks.test.tsx` |
| Import suppliers from CSV (validation preview + error report) | `components/CsvImportDialog` + `features/importExport/supplierCsv` | `createSupplier` | `suppliers` | owner, manager | `src/components/CsvImportDialog.test.tsx`, `src/features/importExport/supplierCsv.test.ts`, `src/features/importExport/hooks.test.tsx` |
| CSV template download | `components/CsvImportDialog` | — (client only) | — | owner, manager | `src/components/CsvImportDialog.test.tsx` |
| Set opening balance for an item | `features/items/OpeningBalanceDialog` (+ `ItemsPage` action) | `createOpeningBalance` | RPC `create_opening_balance` → `stock_movements` | owner, manager | `src/api/stock.test.ts`, `src/features/items/stockHooks.test.tsx`, `supabase/tests/p2_01_stock_ledger_test.sql` |
| View current stock for an item | `features/items/OpeningBalanceDialog` (header) | `getCurrentStock` | view `current_stock` | owner, manager | `src/api/stock.test.ts`, `src/features/items/stockHooks.test.tsx` |
| Receive stock (ad hoc multi-line receipt, batch/expiry, avg-cost report) | `features/stock/ReceivingPage` | `receiveGoods` | RPC `receive_goods` → `stock_movements`, `items` (avg_unit_cost) | owner, manager, staff | `src/api/stock.test.ts`, `src/features/stock/hooks.test.tsx`, `src/features/stock/ReceivingPage.test.tsx`, `supabase/tests/p2_02_receive_goods_test.sql`, `e2e/stock.spec.ts` |
| Receiving item picker (active items, avg cost) | `features/stock/ReceivingPage` | `listItems` | `items` (staff read-only via policy) | owner, manager, staff | `src/features/stock/hooks.test.tsx`, `src/features/stock/ReceivingPage.test.tsx` |

## Planned coverage (checklist, not yet rows)

- [x] Auth: sign in/out/reset → `profiles` → unit tests done in P0-04a; live GoTrue e2e (`e2e/auth.spec.ts`) deferred to P0-04b
- [x] Items CRUD → `items` → `supabase/tests/p1_01_items_rls_test.sql` (P1-01); e2e `e2e/items.spec.ts` (deterministic specs run everywhere, live CRUD in CI)
- [x] Categories + storage locations management → `item_categories`, `storage_locations` → `supabase/tests/p1_02_taxonomy_test.sql` (P1-02: active flag, RESTRICT deletes, RLS); e2e `e2e/settings.spec.ts` (deterministic specs run everywhere, live CRUD in CI)
- [x] Suppliers → `suppliers` → `supabase/tests/p1_03_suppliers_test.sql` (P1-03: CRUD, active-filter PO-prefill contract, RLS); e2e `e2e/suppliers.spec.ts` (deterministic specs run everywhere, live CRUD in CI). Supplier price list → `supplier_prices` + `supplier_price_history` → `supabase/tests/p1_04_supplier_prices_test.sql` (P1-04: RLS, preferred uniqueness, history trigger); e2e `e2e/prices.spec.ts` (deterministic specs run everywhere, live CRUD in CI).
- [x] CSV import/export (items + suppliers) → validation preview + error report → `src/lib/csv.ts`, `src/features/importExport/` (P1-05); e2e `e2e/import-export.spec.ts` (deterministic specs run everywhere, live import in CI)
- [x] Stock ledger foundation → `stock_movements` (append-only: trigger + RLS + ACL) → `supabase/tests/p2_01_stock_ledger_test.sql` (P2-01: 32 assertions — trigger/ACL/policy layers, current_stock sums + isolation, create_opening_balance RPC); e2e `e2e/stock.spec.ts` (deterministic specs run everywhere, live flow in CI)
- [x] Receiving (`receive_goods`) → `stock_movements` + `items.avg_unit_cost` → `supabase/tests/p2_02_receive_goods_test.sql` (P2-02: weighted avg incl. same-receipt lines, atomic abort, expiry, tenant/role, append-only); e2e `e2e/stock.spec.ts` (deterministic specs run everywhere, live receipt flow in CI)
- [ ] Wastage/usage (`log_wastage`, `log_usage`) → `stock_movements` → RPC tests
- [ ] Stock overview + item detail → `current_stock` view → e2e
- [ ] Purchase orders lifecycle → `purchase_orders`, `purchase_order_lines` → e2e + db tests
- [ ] Recipes + costing → `menu_items`, `recipe_ingredients` → unit + e2e
- [ ] Sales entry (`record_sales`) → `stock_movements` → RPC + e2e
- [ ] Stock counts (`apply_stock_count`) → `stock_counts`, `stock_movements` → RPC + e2e
- [ ] Dashboard + reports → views → e2e
- [ ] Audit log + user management → `audit_log`, `profiles` → e2e + RLS tests
