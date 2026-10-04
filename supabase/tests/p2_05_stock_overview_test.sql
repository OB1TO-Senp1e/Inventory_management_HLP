-- ============================================================================
-- P2-05 DB tests — stock overview reads: current_stock sums, tenant
-- isolation, batch-movement readability for expiry aggregation.
--
-- The overview page only READS (listStockOverview goes through plain
-- SELECTs — no new RPCs, no schema changes in P2-05), so these tests assert
-- the SELECT contract the page depends on: the `current_stock` view sums,
-- RLS tenant isolation on all three reads, and batch/expiry visibility.
-- Conventions: single transaction, rolled back at the end (the file MUST
-- start with `begin;`).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Restaurant A'),
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B');

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), -- owner of A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), -- manager of A
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'), -- staff of A
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'); -- owner of B

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.units (id, restaurant_id, name, symbol) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point, active) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tomato', 'e0000000-0000-0000-0000-000000000001', 50, 10, true),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Old Herb', 'e0000000-0000-0000-0000-000000000001', 10, 5, false),
  ('f0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Flour',  'e0000000-0000-0000-0000-000000000002', 30, 8,  true);

-- Tomato (A): opening balance + receipt with batch + usage (batch partially
-- consumed). Flour (B): must never leak into A's reads.
insert into public.stock_movements
  (id, restaurant_id, item_id, movement_type, quantity, batch_no, expiry_date, unit_cost, reason_code, notes, created_by, created_at)
values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'opening_balance', 100, null, null, 30, null, null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'receipt', 50, 'B-101', '2026-12-31', 28, null, null, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-09-10T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'usage', -20, 'B-101', '2026-12-31', null, 'kitchen_use', null, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-09-15T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000003',
   'opening_balance', 200, null, null, 40, null, null, 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-09-01T08:00:00Z');

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

-- Switch to the client path: RLS enforced, JWT claims drive tenant/role.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: current_stock sums the ledger per item
-- ---------------------------------------------------------------------------

do $$
declare
  v_qty numeric;
  v_last timestamptz;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select quantity, last_movement_at into v_qty, v_last
    from public.current_stock
   where item_id = 'f0000000-0000-0000-0000-000000000001';

  perform pg_temp.assert_true('T1: Tomato stock = 100 + 50 - 20 = 130', v_qty = 130);
  perform pg_temp.assert_true('T1: last movement is the usage',
    v_last = '2026-09-15T08:00:00Z'::timestamptz);
end $$;

-- ---------------------------------------------------------------------------
-- T2: tenant isolation — manager of A sees only A's stock rows
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from public.current_stock;
  perform pg_temp.assert_true('T2: exactly 1 stock row visible (Tomato)', v_count = 1);

  select count(*) into v_count from public.current_stock
   where restaurant_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert_true('T2: 0 rows from restaurant B', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T3: batch movements readable for the overview's expiry aggregation
-- ---------------------------------------------------------------------------

do $$
declare
  v_rows int;
  v_expiry date;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);

  select count(*), min(expiry_date) into v_rows, v_expiry
    from public.stock_movements
   where batch_no is not null;

  perform pg_temp.assert_true('T3: 2 batch-tagged movements visible', v_rows = 2);
  perform pg_temp.assert_true('T3: batch expiry readable', v_expiry = '2026-12-31');
end $$;

-- ---------------------------------------------------------------------------
-- T4: active-items read for the overview (archived excluded by the query)
-- ---------------------------------------------------------------------------

do $$
declare
  v_names text[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);

  select array_agg(name order by name) into v_names
    from public.items
   where active = true;

  perform pg_temp.assert_true('T4: only active items of A listed',
    v_names = array['Tomato']);
end $$;

-- ---------------------------------------------------------------------------
-- T5: owner of B sees only B's data (symmetric isolation)
-- ---------------------------------------------------------------------------

do $$
declare
  v_qty numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  select quantity into v_qty from public.current_stock
   where item_id = 'f0000000-0000-0000-0000-000000000003';
  perform pg_temp.assert_true('T5: B owner sees Flour stock = 200', v_qty = 200);

  select count(*) into v_qty from public.current_stock
   where restaurant_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert_true('T5: B owner sees 0 rows from A', v_qty = 0);
end $$;

rollback;
