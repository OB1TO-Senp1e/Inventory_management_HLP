-- ============================================================================
-- V2-10 tests: revenue report — staff lockout on the price-bearing query
-- path + tenant isolation.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one
-- transaction that is ROLLED BACK at the end, so the database is left
-- clean and this file is re-runnable.
--
-- The V2-10 query path (`getRevenueReport`) reads two halves:
--   (a) `sale_deduction` movement NOTES (dish names per sale) — staff CAN
--       read `stock_movements` (they log usage/wastage against the same
--       ledger), so notes alone are not the enforcement;
--   (b) `menu_items` SELLING PRICES — staff have NO RLS policies here.
-- Revenue = Σ (qty × selling price), so without (b) no revenue figure is
-- computable for staff at the database. These tests pin that split down,
-- plus tenant isolation and the NULL-price honesty the API relies on.
--
-- Covers:
--   * staff: zero rows on `menu_items` (the price-bearing half of the
--     report is denied at the database);
--   * staff CAN read sale_deduction notes (documents the split above —
--     the lockout lives on the price table, not the ledger);
--   * manager of A sees only A's menu items/prices; owner of B sees only B's;
--   * a dish with NULL selling_price is readable by manager but carries
--     no price — the API excludes it from revenue (never 0-prices it).
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('77777777-7777-7777-7777-777777777777', 'Restaurant A'),
  ('88888888-8888-8888-8888-888888888888', 'Restaurant B');

insert into auth.users (id) values
  ('10101010-1010-1010-1010-101010101010'), -- manager of A
  ('20202020-2020-2020-2020-202020202020'), -- owner of B
  ('30303030-3030-3030-3030-303030303030'); -- staff of A

insert into public.profiles (id, restaurant_id, role) values
  ('10101010-1010-1010-1010-101010101010', '77777777-7777-7777-7777-777777777777', 'manager'),
  ('20202020-2020-2020-2020-202020202020', '88888888-8888-8888-8888-888888888888', 'owner'),
  ('30303030-3030-3030-3030-303030303030', '77777777-7777-7777-7777-777777777777', 'staff');

insert into public.units (id, restaurant_id, name, symbol) values
  ('70700000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'kilogram', 'kg'),
  ('70800000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('70900000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'Tomatoes', '70700000-0000-0000-0000-000000000001', 10, 5),
  ('71000000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
   'Flour', '70800000-0000-0000-0000-000000000001', 10, 5);

update public.items set avg_unit_cost = 32.50
  where id = '70900000-0000-0000-0000-000000000001';

insert into public.menu_items (id, restaurant_id, name, yield_quantity, yield_unit, selling_price) values
  ('71100000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'Butter Chicken', 4, 'servings', 199),
  ('71200000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'Priceless Thali', 2, 'servings', NULL),
  ('71300000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
   'B Dish', 2, 'servings', 99);

-- A sale_deduction movement whose notes carry the dish breakdown
-- (the exact format `record_sales` writes).
insert into public.stock_movements
  (restaurant_id, item_id, movement_type, quantity, notes, created_by)
values
  ('77777777-7777-7777-7777-777777777777', '70900000-0000-0000-0000-000000000001',
   'sale_deduction', -2, 'Sale 2026-10-05: Butter Chicken x4',
   '10101010-1010-1010-1010-101010101010');

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
-- T1: staff lockout — the price-bearing half of the report is unreachable
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible int;
  v_notes text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"30303030-3030-3030-3030-303030303030","restaurant_id":"77777777-7777-7777-7777-777777777777","role":"staff"}',
    true);

  -- No policies on menu_items for staff: every staff query is denied, so
  -- no selling price — and therefore no revenue — is computable.
  select count(*) into v_visible from public.menu_items;
  perform pg_temp.assert_true('staff sees zero menu_items rows', v_visible = 0);

  -- The ledger itself IS readable by staff (they log usage/wastage) — the
  -- notes alone reveal dish names but no prices, so no revenue is computable.
  select notes into v_notes from public.stock_movements
   where movement_type = 'sale_deduction' limit 1;
  perform pg_temp.assert_true('staff can read sale_deduction notes',
    v_notes = 'Sale 2026-10-05: Butter Chicken x4');
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: tenant isolation — manager of A / owner of B see only their own prices
-- ---------------------------------------------------------------------------

do $$
declare
  v_names text[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"10101010-1010-1010-1010-101010101010","restaurant_id":"77777777-7777-7777-7777-777777777777","role":"manager"}',
    true);
  select array_agg(name order by name) into v_names from public.menu_items;
  perform pg_temp.assert_true('manager of A sees only A menu items',
    v_names = array['Butter Chicken', 'Priceless Thali']);

  perform set_config('request.jwt.claims',
    '{"sub":"20202020-2020-2020-2020-202020202020","restaurant_id":"88888888-8888-8888-8888-888888888888","role":"owner"}',
    true);
  select array_agg(name order by name) into v_names from public.menu_items;
  perform pg_temp.assert_true('owner of B sees only B menu items',
    v_names = array['B Dish']);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: NULL selling_price is readable by manager but carries no price —
-- the API must exclude the dish from revenue, never 0-price it
-- ---------------------------------------------------------------------------

do $$
declare
  v_price numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"10101010-1010-1010-1010-101010101010","restaurant_id":"77777777-7777-7777-7777-777777777777","role":"manager"}',
    true);
  select selling_price into v_price from public.menu_items
   where name = 'Priceless Thali';
  perform pg_temp.assert_true('unpriced dish reads NULL price', v_price is null);
  select selling_price into v_price from public.menu_items
   where name = 'Butter Chicken';
  perform pg_temp.assert_true('Butter Chicken reads price 199', v_price = 199);
end;
$$;

rollback;
