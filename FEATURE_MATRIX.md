# FEATURE_MATRIX.md — Screen → component → api fn → DB object → test

> Table: screen/action | component | api function | DB object (table/RPC/view) | RLS roles | test file
> No empty cells allowed once a row is DONE. The wiring audit (P0-06) parses this file.
> Run 0: structure only — rows are added as tasks complete their vertical slices.

| screen/action                    | component | api function | DB object | RLS roles | test file |
| -------------------------------- | --------- | ------------ | --------- | --------- | --------- |
| _(rows added from P0-01 onward)_ | —         | —            | —         | —         | —         |

## Planned coverage (checklist, not yet rows)

- [ ] Auth: sign in/out/reset → `profiles` → `e2e/auth.spec.ts`
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
