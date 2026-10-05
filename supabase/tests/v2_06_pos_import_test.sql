-- ============================================================================
-- V2-06 tests: import_pos_sales RPC + pos_imports table — POS sales auto-import.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the V2-06 migration
-- (supabase/migrations/20261005150000_pos_imports.sql):
--   * pos_imports rows recorded per imported POS sale (tenant + provider +
--     external id + dish + qty + original sold_at + chosen sale date);
--   * unique (restaurant_id, provider, external_sale_id): re-importing the
--     same sale raises instead of double-posting;
--   * the import posts through record_sales internally: ledger effects
--     (deduction math, notes, summary shape) are identical to manual entry;
--   * guard rails: empty sales, blank provider, blank external id,
--     non-positive dishes, archived dish, cross-restaurant dish;
--   * roles: owner/manager allowed, staff denied (both the RPC and direct
--     table access);
--   * RLS on pos_imports: owner/manager see own restaurant only; staff sees
--     nothing; staff cannot insert/update/delete directly.
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
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5);

insert into public.menu_items (id, restaurant_id, name, yield_quantity, yield_unit) values
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Butter Chicken', 4, 'servings'),
  ('71000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Old Dish', 4, 'servings'),
  ('72000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Other Dish', 4, 'servings');

update public.menu_items set active = false
 where id = '71000000-0000-0000-0000-000000000002';

insert into public.recipe_ingredients (menu_item_id, restaurant_id, item_id, quantity, unit_id) values
  -- Butter Chicken: 2 kg tomatoes per 4 servings.
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000001', 2, '60000000-0000-0000-0000-000000000001');

insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity) values
  ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000001',
   'opening_balance', 100);

-- All access checks below run as a non-superuser so RLS is enforced.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: import posts through record_sales — identical ledger effects to manual
-- entry, and pos_imports rows are recorded
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_tomato_qty numeric;
  v_rows integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.import_pos_sales(
    'stub',
    '[{"external_sale_id":"stub-0001","menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":8,"sold_at":"2026-10-04T13:05:00+05:30"},
      {"external_sale_id":"stub-0002","menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":4,"sold_at":null}]'::jsonb,
    '2026-10-05'::date) into v_result;

  perform pg_temp.assert_true('import returns provider + sale date + count',
    (v_result ->> 'provider') = 'stub'
    and (v_result ->> 'sale_date') = '2026-10-05'
    and (v_result ->> 'imported') = '2');

  -- Same math as manual entry: (8 + 4) dishes x 2 kg / 4 servings = 6 kg.
  select quantity into v_tomato_qty
    from public.stock_movements
   where movement_type = 'sale_deduction'
     and item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('tomato deduction = (8+4) x 2 / 4 kg (negative)',
    v_tomato_qty = -6);

  -- The inner summary has the P4-03 shape (aggregated dish line).
  perform pg_temp.assert_true('inner sales summary aggregates dish lines',
    jsonb_array_length(v_result -> 'sales' -> 'lines') = 1
    and (v_result -> 'sales' -> 'lines' -> 0 ->> 'dishes') = '12');

  -- One pos_imports row per imported POS sale, keeping the original sold_at.
  select count(*) into v_rows from public.pos_imports
   where provider = 'stub';
  perform pg_temp.assert_true('two pos_imports rows recorded', v_rows = 2);

  perform pg_temp.assert_true('import row carries external id, dish, qty, dates',
    exists (select 1 from public.pos_imports
             where external_sale_id = 'stub-0001'
               and menu_item_id = '71000000-0000-0000-0000-000000000001'
               and dishes = 8
               and sold_at = '2026-10-04T13:05:00+05:30'::timestamptz
               and sale_date = '2026-10-05'::date
               and restaurant_id = '11111111-1111-1111-1111-111111111111'));

  perform pg_temp.assert_true('import row records who imported',
    exists (select 1 from public.pos_imports
             where external_sale_id = 'stub-0001'
               and created_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
               and imported_at is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: re-importing the same sale raises — no double-post
-- ---------------------------------------------------------------------------

do $$
declare
  v_before numeric;
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);

  select quantity into v_before from public.current_stock
   where item_id = '61000000-0000-0000-0000-000000000001';

  begin
    perform public.import_pos_sales(
      'stub',
      '[{"external_sale_id":"stub-0001","menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":1,"sold_at":null}]'::jsonb,
      '2026-10-06'::date);
  exception when raise_exception then
    if sqlerrm like '%already imported%' then
      v_raised := true;
    else
      raise;
    end if;
  end;

  perform pg_temp.assert_true('re-import raises already-imported', v_raised);
  perform pg_temp.assert_true('stock unchanged after failed re-import',
    (select quantity from public.current_stock
      where item_id = '61000000-0000-0000-0000-000000000001') = v_before);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: unique index backstop — a direct duplicate insert violates 23505
-- ---------------------------------------------------------------------------

do $$
declare
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);

  begin
    insert into public.pos_imports
      (restaurant_id, provider, external_sale_id, menu_item_id, dishes, sale_date, created_by)
    values
      ('11111111-1111-1111-1111-111111111111', 'stub', 'stub-0001',
       '71000000-0000-0000-0000-000000000001', 1, '2026-10-05'::date,
       'dddddddd-dddd-dddd-dddd-dddddddddddd');
  exception when unique_violation then
    v_raised := true;
  end;

  perform pg_temp.assert_true('duplicate (restaurant, provider, external id) raises 23505', v_raised);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: roles — staff cannot call the RPC
-- ---------------------------------------------------------------------------

do $$
declare
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  begin
    perform public.import_pos_sales(
      'stub',
      '[{"external_sale_id":"stub-0099","menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":1,"sold_at":null}]'::jsonb,
      '2026-10-05'::date);
  exception when raise_exception then
    if sqlerrm like '%cannot import POS sales%' then
      v_raised := true;
    else
      raise;
    end if;
  end;

  perform pg_temp.assert_true('staff import raises role error', v_raised);
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: guard rails — empty sales, blank provider, blank external id,
-- non-positive dishes, archived dish, cross-restaurant dish
-- ---------------------------------------------------------------------------

do $$
declare
  v_line jsonb;
  v_raised boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Empty sales array.
  v_raised := false;
  begin
    perform public.import_pos_sales('stub', '[]'::jsonb, '2026-10-05'::date);
  exception when raise_exception then
    v_raised := true;
  end;
  perform pg_temp.assert_true('guard rail raises: empty sales', v_raised);

  -- Blank provider.
  v_raised := false;
  begin
    perform public.import_pos_sales('  ',
      jsonb_build_array(jsonb_build_object(
        'external_sale_id', 'x-1',
        'menu_item_id', '71000000-0000-0000-0000-000000000001',
        'dishes', 1, 'sold_at', null)),
      '2026-10-05'::date);
  exception when raise_exception then
    v_raised := true;
  end;
  perform pg_temp.assert_true('guard rail raises: blank provider', v_raised);

  -- Blank external id.
  v_raised := false;
  begin
    perform public.import_pos_sales('stub',
      jsonb_build_array(jsonb_build_object(
        'external_sale_id', '  ',
        'menu_item_id', '71000000-0000-0000-0000-000000000001',
        'dishes', 1, 'sold_at', null)),
      '2026-10-05'::date);
  exception when raise_exception then
    v_raised := true;
  end;
  perform pg_temp.assert_true('guard rail raises: blank external id', v_raised);

  -- Non-positive dishes.
  v_raised := false;
  begin
    perform public.import_pos_sales('stub',
      jsonb_build_array(jsonb_build_object(
        'external_sale_id', 'x-1',
        'menu_item_id', '71000000-0000-0000-0000-000000000001',
        'dishes', 0, 'sold_at', null)),
      '2026-10-05'::date);
  exception when raise_exception then
    v_raised := true;
  end;
  perform pg_temp.assert_true('guard rail raises: zero dishes', v_raised);

  -- Archived dish (rejected by the inner record_sales call).
  v_raised := false;
  begin
    perform public.import_pos_sales('stub',
      jsonb_build_array(jsonb_build_object(
        'external_sale_id', 'x-1',
        'menu_item_id', '71000000-0000-0000-0000-000000000002',
        'dishes', 1, 'sold_at', null)),
      '2026-10-05'::date);
  exception when raise_exception then
    v_raised := true;
  end;
  perform pg_temp.assert_true('guard rail raises: archived dish', v_raised);

  -- Cross-restaurant dish (rejected by the inner record_sales call).
  v_raised := false;
  begin
    perform public.import_pos_sales('stub',
      jsonb_build_array(jsonb_build_object(
        'external_sale_id', 'x-1',
        'menu_item_id', '72000000-0000-0000-0000-000000000001',
        'dishes', 1, 'sold_at', null)),
      '2026-10-05'::date);
  exception when raise_exception then
    v_raised := true;
  end;
  perform pg_temp.assert_true('guard rail raises: cross-restaurant dish', v_raised);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: RLS — owner/manager see own restaurant's imports only; staff sees
-- nothing and cannot write directly
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_raised boolean;
begin
  -- Owner of A sees A's rows.
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select count(*) into v_count from public.pos_imports;
  perform pg_temp.assert_true('owner of A sees own imports', v_count = 2);

  -- Owner of B sees nothing (tenant isolation).
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  select count(*) into v_count from public.pos_imports;
  perform pg_temp.assert_true('owner of B sees no rows of A', v_count = 0);

  -- Staff of A sees nothing.
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  select count(*) into v_count from public.pos_imports;
  perform pg_temp.assert_true('staff sees no pos_imports rows', v_count = 0);

  -- Staff cannot insert directly.
  v_raised := false;
  begin
    insert into public.pos_imports
      (restaurant_id, provider, external_sale_id, menu_item_id, dishes, sale_date, created_by)
    values
      ('11111111-1111-1111-1111-111111111111', 'stub', 'staff-x',
       '71000000-0000-0000-0000-000000000001', 1, '2026-10-05'::date,
       'cccccccc-cccc-cccc-cccc-cccccccccccc');
  exception when insufficient_privilege then
    v_raised := true;
  end;
  perform pg_temp.assert_true('staff direct insert blocked by RLS', v_raised);
end;
$$;

-- ---------------------------------------------------------------------------
-- T7: atomicity — one bad sale aborts the whole import (no partial postings,
-- no partial pos_imports rows)
-- ---------------------------------------------------------------------------

do $$
declare
  v_moves_before integer;
  v_imports_before integer;
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_moves_before from public.stock_movements
   where movement_type = 'sale_deduction';
  select count(*) into v_imports_before from public.pos_imports;

  begin
    perform public.import_pos_sales(
      'stub',
      '[{"external_sale_id":"stub-0101","menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2,"sold_at":null},
        {"external_sale_id":"stub-0001","menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2,"sold_at":null}]'::jsonb,
      '2026-10-07'::date);
  exception when raise_exception then
    v_raised := true;
  end;

  perform pg_temp.assert_true('duplicate in batch raises', v_raised);
  perform pg_temp.assert_true('no partial ledger postings',
    (select count(*) from public.stock_movements
      where movement_type = 'sale_deduction') = v_moves_before);
  perform pg_temp.assert_true('no partial pos_imports rows',
    (select count(*) from public.pos_imports) = v_imports_before);
end;
$$;

rollback;
