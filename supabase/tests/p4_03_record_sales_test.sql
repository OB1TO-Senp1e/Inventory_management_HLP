-- ============================================================================
-- P4-03 tests: record_sales RPC — sales deduction through recipes.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P4-03 migration (supabase/migrations/20261005070000_record_sales.sql):
--   * per-ingredient deduction math: dishes x qty / yield, in the item's
--     base unit (same-unit factor 1, converted via the one-hop factor);
--   * daily-entry aggregation: one movement per inventory item per call,
--     even when two dishes share an ingredient;
--   * notes carry the sale date + contributing dishes; summary jsonb shape;
--   * guard rails: archived dish, dish without recipe, empty lines,
--     non-positive dishes, duplicate dish lines, cross-restaurant dish;
--   * roles: owner/manager allowed, staff denied;
--   * insufficient-stock policy: over-deduction posts (warn + allow —
--     P4-04 adds the flag + audit);
--   * append-only: sale_deduction rows cannot be updated or deleted.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Assertion helper (session-temporary; every test file defines its own)
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

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Restaurant A'),
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B');

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), -- manager of A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), -- owner of B
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'), -- staff of A
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'); -- owner of A

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'owner');

insert into public.units (id, restaurant_id, name, symbol) values
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'gram', 'g'),
  ('60000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'litre', 'L'),
  ('60000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'millilitre', 'ml'),
  ('60000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Milk', '60000000-0000-0000-0000-000000000003', 10, 5),
  ('62000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Flour', '60000000-0000-0000-0000-000000000004', 10, 5);

insert into public.unit_conversions (restaurant_id, from_unit_id, to_unit_id, factor) values
  ('11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000001', 0.001),
  ('11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000005',
   '60000000-0000-0000-0000-000000000003', 0.001);

-- Dishes (A): Butter Chicken (yield 4) + Naan (yield 2), sharing Tomatoes.
insert into public.menu_items (id, restaurant_id, name, yield_quantity, yield_unit) values
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Butter Chicken', 4, 'servings'),
  ('71000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Naan', 2, 'servings'),
  ('71000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Old Dish', 4, 'servings'),
  ('71000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Empty Dish', 4, 'servings'),
  ('72000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Other Dish', 4, 'servings');

update public.menu_items set active = false
 where id = '71000000-0000-0000-0000-000000000003';

insert into public.recipe_ingredients (menu_item_id, restaurant_id, item_id, quantity, unit_id) values
  -- Butter Chicken: 2 kg tomatoes (same unit), 500 ml milk (one-hop to L).
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000001', 2, '60000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000002', 500, '60000000-0000-0000-0000-000000000005'),
  -- Naan: 0.5 kg tomatoes (same unit).
  ('71000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000001', 0.5, '60000000-0000-0000-0000-000000000001'),
  -- Old Dish (archived): 1 kg tomatoes.
  ('71000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000001'),
  -- Other Dish (restaurant B): 1 kg flour.
  ('72000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '62000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000004');

-- Opening balances so current_stock is readable in assertions.
insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity) values
  ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000001',
   'opening_balance', 100),
  ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000002',
   'opening_balance', 10);

-- All access checks below run as a non-superuser so RLS is enforced.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: deduction math — same unit (factor 1) + one-hop conversion + yield
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_tomato_qty numeric;
  v_milk_qty numeric;
  v_stock numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- 8 dishes of Butter Chicken (yield 4):
  --   Tomatoes: 8 x 2 / 4 = 4 kg
  --   Milk:     8 x 500 ml / 4 = 1000 ml = 1 L
  select public.record_sales(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":8}]'::jsonb,
    '2026-10-05'::date) into v_result;

  perform pg_temp.assert_true('summary sale_date echoes back',
    v_result ->> 'sale_date' = '2026-10-05');
  perform pg_temp.assert_true('summary has one line',
    jsonb_array_length(v_result -> 'lines') = 1);
  perform pg_temp.assert_true('summary has two ingredients',
    jsonb_array_length(v_result -> 'ingredients') = 2);

  select quantity into v_tomato_qty
    from public.stock_movements
   where movement_type = 'sale_deduction'
     and item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('tomato deduction = 8 x 2 / 4 kg (negative)',
    v_tomato_qty = -4);

  select quantity into v_milk_qty
    from public.stock_movements
   where movement_type = 'sale_deduction'
     and item_id = '61000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('milk deduction = 8 x 500ml / 4 converted to 1 L (negative)',
    v_milk_qty = -1);

  -- Notes carry the sale date + dish name.
  perform pg_temp.assert_true('notes carry sale date and dish',
    (select notes from public.stock_movements
      where movement_type = 'sale_deduction'
        and item_id = '61000000-0000-0000-0000-000000000001')
      like 'Sale 2026-10-05: Butter Chicken x8');

  -- current_stock decreased by the deducted amounts.
  select quantity into v_stock from public.current_stock
   where item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('current_stock tomatoes = 100 - 4', v_stock = 96);
  select quantity into v_stock from public.current_stock
   where item_id = '61000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('current_stock milk = 10 - 1', v_stock = 9);
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: daily-entry aggregation — two dishes sharing an ingredient post ONE
-- movement per inventory item
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_row_count integer;
  v_tomato_qty numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- T1's rows are still in the ledger; T2 uses a different sale date so its
  -- assertions filter on notes (the append-only trigger rejects deletes
  -- even for superusers).
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Butter Chicken x4 + Naan x2 (yield 2, 0.5 kg tomatoes each):
  --   Tomatoes: 4 x 2 / 4 + 2 x 0.5 / 2 = 2 + 0.5 = 2.5 kg in ONE row
  --   Milk:     4 x 500 ml / 4 = 0.5 L in one row
  select public.record_sales(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":4},
      {"menu_item_id":"71000000-0000-0000-0000-000000000002","dishes":2}]'::jsonb,
    '2026-10-06'::date) into v_result;

  select count(*) into v_row_count from public.stock_movements
   where movement_type = 'sale_deduction'
     and notes like 'Sale 2026-10-06:%';
  perform pg_temp.assert_true('one movement per inventory item (2 rows, not 3)',
    v_row_count = 2);

  select quantity into v_tomato_qty from public.stock_movements
   where movement_type = 'sale_deduction'
     and item_id = '61000000-0000-0000-0000-000000000001'
     and notes like 'Sale 2026-10-06:%';
  perform pg_temp.assert_true('shared ingredient aggregated to -2.5 kg',
    v_tomato_qty = -2.5);

  perform pg_temp.assert_true('notes name both contributing dishes',
    (select notes from public.stock_movements
      where movement_type = 'sale_deduction'
        and item_id = '61000000-0000-0000-0000-000000000001'
        and notes like 'Sale 2026-10-06:%')
      like 'Sale 2026-10-06: Butter Chicken x4, Naan x2');
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: guard rails — archived dish, dish without recipe, bad inputs
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Archived dish rejected.
  begin
    select public.record_sales(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000003","dishes":1}]'::jsonb) into v_result;
    perform pg_temp.assert_true('archived dish rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('archived dish rejected', true);
  end;

  -- Dish without a recipe rejected.
  begin
    select public.record_sales(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000004","dishes":1}]'::jsonb) into v_result;
    perform pg_temp.assert_true('dish without recipe rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('dish without recipe rejected', true);
  end;

  -- Empty line array rejected.
  begin
    select public.record_sales('[]'::jsonb) into v_result;
    perform pg_temp.assert_true('empty lines rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('empty lines rejected', true);
  end;

  -- Non-positive dishes rejected.
  begin
    select public.record_sales(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":0}]'::jsonb) into v_result;
    perform pg_temp.assert_true('zero dishes rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('zero dishes rejected', true);
  end;

  -- Duplicate dish lines rejected (client must aggregate first).
  begin
    select public.record_sales(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":1},
        {"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb) into v_result;
    perform pg_temp.assert_true('duplicate dish lines rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('duplicate dish lines rejected', true);
  end;

  -- Cross-restaurant dish rejected (not visible in the caller's restaurant).
  begin
    select public.record_sales(
      '[{"menu_item_id":"72000000-0000-0000-0000-000000000001","dishes":1}]'::jsonb) into v_result;
    perform pg_temp.assert_true('cross-restaurant dish rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('cross-restaurant dish rejected', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: roles — owner allowed, manager allowed, staff denied
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  -- Owner of A: allowed.
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select public.record_sales(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000002","dishes":1}]'::jsonb) into v_result;
  perform pg_temp.assert_true('owner records sales', v_result ->> 'sale_date' is not null);

  -- Staff of A: denied (recipes carry costs — staff never see them).
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  begin
    select public.record_sales(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000002","dishes":1}]'::jsonb) into v_result;
    perform pg_temp.assert_true('staff denied', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff denied', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: insufficient-stock policy — over-deduction posts (warn + allow)
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_stock numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Milk is at ~9 L after T1; sell 100 dishes of Butter Chicken → -25 L.
  -- The movement posts anyway; the count reconciles later (P4-04 adds the
  -- flag + audit entry).
  select public.record_sales(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":100}]'::jsonb) into v_result;
  perform pg_temp.assert_true('over-deduction posts', true);

  select quantity into v_stock from public.current_stock
   where item_id = '61000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('stock goes negative', v_stock < 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: append-only — sale_deduction rows cannot be updated or deleted
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  -- Layer 1: the trigger rejects UPDATE/DELETE even for the table owner
  -- (who passes ACL) — run as superuser.
  reset role;

  begin
    update public.stock_movements set quantity = -999
     where movement_type = 'sale_deduction';
    perform pg_temp.assert_true('trigger rejects sale_deduction UPDATE', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('trigger rejects sale_deduction UPDATE',
      v_msg like '%append-only: UPDATE%');
  end;

  begin
    delete from public.stock_movements where movement_type = 'sale_deduction';
    perform pg_temp.assert_true('trigger rejects sale_deduction DELETE', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('trigger rejects sale_deduction DELETE',
      v_msg like '%append-only: DELETE%');
  end;

  -- Layer 3 (client path): authenticated roles get permission denied.
  set role authenticated;

  begin
    update public.stock_movements set quantity = -999
     where movement_type = 'sale_deduction';
    perform pg_temp.assert_true('authenticated denied UPDATE on ledger', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('authenticated denied UPDATE on ledger', true);
  end;

  begin
    delete from public.stock_movements where movement_type = 'sale_deduction';
    perform pg_temp.assert_true('authenticated denied DELETE on ledger', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('authenticated denied DELETE on ledger', true);
  end;
end;
$$;

rollback;
