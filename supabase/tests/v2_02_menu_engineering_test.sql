-- ============================================================================
-- V2-02 tests: menu engineering report — staff cost lockout on the new
-- query path + tenant isolation.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one
-- transaction that is ROLLED BACK at the end, so the database is left
-- clean and this file is re-runnable.
--
-- The V2-02 query path (`getMenuEngineeringReport`) reads two halves:
--   (a) `sale_deduction` movement NOTES (dish names per sale) — staff CAN
--       read `stock_movements` (they log usage/wastage against the same
--       ledger), so notes alone are not the enforcement;
--   (b) `menu_items` + the `menu_item_costs` view (selling prices and
--       live recipe costs) — staff have NO RLS policies here.
-- Without (b) the report cannot compute a single margin, so the menu
-- engineering data is unreachable for staff even though the notes are
-- readable. These tests pin that split down, plus tenant isolation.
--
-- Covers:
--   * staff: zero rows on `menu_items`, zero rows on `menu_item_costs`
--     (the cost-bearing half of the report is denied at the database);
--   * staff CAN read sale_deduction notes (documents the split above —
--     the lockout lives on the cost tables, not the ledger);
--   * manager of A sees only A's menu items; owner of B sees only B's;
--   * a recipe-less menu item reads ₹0 from `menu_item_costs` (LEFT JOIN)
--     — documenting why the API marks cost-unknown via `ingredientCount`,
--     never via the view.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Restaurant A'),
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B');

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), -- manager of A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), -- owner of B
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'); -- staff of A

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff');

insert into public.units (id, restaurant_id, name, symbol) values
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('60000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('62000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Flour', '60000000-0000-0000-0000-000000000002', 10, 5);

update public.items set avg_unit_cost = 32.50
  where id = '61000000-0000-0000-0000-000000000001';
update public.items set avg_unit_cost = 45.00
  where id = '62000000-0000-0000-0000-000000000001';

insert into public.menu_items (id, restaurant_id, name, yield_quantity, yield_unit, selling_price) values
  ('63000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Butter Chicken', 4, 'servings', 199),
  ('63000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Mystery Thali', 2, 'servings', 299),
  ('64000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'B Dish', 2, 'servings', 99);

-- Butter Chicken has a recipe; Mystery Thali deliberately has none.
insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id) values
  ('11111111-1111-1111-1111-111111111111', '63000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001', 2, '60000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', '64000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000002');

-- A sale_deduction movement whose notes carry the dish breakdown
-- (the exact format `record_sales` writes).
insert into public.stock_movements
  (restaurant_id, item_id, movement_type, quantity, notes, created_by)
values
  ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000001',
   'sale_deduction', -2, 'Sale 2026-10-05: Butter Chicken x4',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- Assertion helper (session-temporary)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.assert_true(p_name text, p_ok boolean)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'ASSERT FAILED: %', p_name;
  end if;
  raise notice 'ok: %', p_name;
end;
$$;

-- All access checks below run as a non-superuser so RLS is enforced.
-- (P5-05 lesson: no `reset role` mid-file — it would silently revert to
-- superuser and make every RLS assertion vacuous.)
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: staff lockout — the cost-bearing half of the report is unreachable
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible int;
  v_notes text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  -- No policies on menu_items for staff: every staff query is denied.
  select count(*) into v_visible from public.menu_items;
  perform pg_temp.assert_true('staff sees zero menu_items rows', v_visible = 0);

  -- The live-cost view is security_invoker: staff see zero rows, not an error.
  select count(*) into v_visible from public.menu_item_costs;
  perform pg_temp.assert_true('staff sees zero menu_item_costs rows', v_visible = 0);

  -- The ledger itself IS readable by staff (they log usage/wastage) — the
  -- notes alone reveal dish names but no cost, so no margin is computable.
  select notes into v_notes from public.stock_movements
   where movement_type = 'sale_deduction' limit 1;
  perform pg_temp.assert_true('staff can read sale_deduction notes',
    v_notes = 'Sale 2026-10-05: Butter Chicken x4');
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: tenant isolation — manager of A / owner of B see only their own rows
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select count(*) into v_visible from public.menu_items;
  perform pg_temp.assert_true('manager of A sees only A menu items', v_visible = 2);
  -- The view has one row per menu item (LEFT JOIN): Butter Chicken plus
  -- the recipe-less Mystery Thali (₹0 row — the API maps cost-unknown via
  -- ingredientCount, not via this view).
  select count(*) into v_visible from public.menu_item_costs;
  perform pg_temp.assert_true('manager of A sees only A cost rows', v_visible = 2);

  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  select count(*) into v_visible from public.menu_items;
  perform pg_temp.assert_true('owner of B sees only B menu items', v_visible = 1);
  select count(*) into v_visible from public.menu_item_costs
   where menu_item_id = '63000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('owner of B cannot see A cost rows', v_visible = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: recipe-less dishes read ₹0 from the view — the API must use
-- ingredientCount (not the view) to mark their cost as unknown
-- ---------------------------------------------------------------------------

do $$
declare
  v_cost numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select ingredient_cost into v_cost from public.menu_item_costs
   where menu_item_id = '63000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('recipe-less dish reads ₹0 from the view', v_cost = 0);
  perform pg_temp.assert_true('Butter Chicken costs 2kg Tomatoes @ 32.50',
    (select ingredient_cost from public.menu_item_costs
      where menu_item_id = '63000000-0000-0000-0000-000000000001') = 65);
end;
$$;

rollback;
