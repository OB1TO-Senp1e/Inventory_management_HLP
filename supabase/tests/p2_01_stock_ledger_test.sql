-- ============================================================================
-- P2-01 DB tests: stock ledger foundation.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P2-01 migration:
--   * append-only enforcement in all three layers:
--       1. trigger rejects UPDATE and DELETE;
--       2. no UPDATE/DELETE RLS policies exist (pg_policies catalog check);
--       3. ACL grants SELECT+INSERT only (has_table_privilege check);
--   * current_stock view sums signed quantities per (restaurant, item);
--   * current_stock respects tenant isolation (security_invoker);
--   * create_opening_balance: happy path, validation, idempotency,
--     role + tenant checks, avg_unit_cost seeding;
--   * staff can INSERT movements (needed for P2-03) but cannot UPDATE/DELETE;
--   * CHECK constraints: movement_type whitelist, quantity <> 0.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'Restaurant A'),
  ('b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0', 'Restaurant B');

insert into auth.users (id) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'), -- owner of A
  ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'), -- manager of A
  ('a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3'), -- staff of A
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'); -- owner of B

insert into public.profiles (id, restaurant_id, role) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'owner'),
  ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'manager'),
  ('a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3', 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'staff'),
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0', 'owner');

insert into public.units (id, restaurant_id, name, symbol) values
  ('c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0', 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'kilogram', 'kg'),
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'Rice', 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0', 50, 10),
  ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'Sugar', 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0', 20, 5),
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0', 'Flour', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 30, 8);

-- Baseline movements for the view test (superuser insert, RLS bypassed).
insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity, unit_cost) values
  ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'receipt', 100, 40),
  ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'usage', -30, null),
  ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'wastage', -5, null),
  ('b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 'receipt', 200, 35);

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

-- All access checks below run as a non-superuser so RLS is enforced,
-- EXCEPT T1a: the trigger must also stop the table owner (who passes ACL).
-- ---------------------------------------------------------------------------
-- T1a: layer 1 — trigger rejects UPDATE and DELETE even for the table owner
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_msg text;
begin
  select id into v_id from public.stock_movements
  where movement_type = 'receipt'
    and item_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'
  limit 1;

  begin
    update public.stock_movements set notes = 'tampered' where id = v_id;
    perform pg_temp.assert_true('trigger rejects UPDATE', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('trigger rejects UPDATE',
      v_msg like '%append-only: UPDATE%');
  end;

  begin
    delete from public.stock_movements where id = v_id;
    perform pg_temp.assert_true('trigger rejects DELETE', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('trigger rejects DELETE',
      v_msg like '%append-only: DELETE%');
  end;

  perform pg_temp.assert_true('movements intact after rejected writes',
    (select count(*) from public.stock_movements) = 4);
end $$;

set role authenticated;

-- ---------------------------------------------------------------------------
-- T1b: layer 3 (client path) — authenticated roles get permission denied
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"manager"}',
    true);

  begin
    update public.stock_movements set notes = 'tampered'
    where movement_type = 'receipt' and item_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
    perform pg_temp.assert_true('manager UPDATE denied at ACL', false);
  exception when insufficient_privilege then
    raise notice 'ok: manager UPDATE denied at ACL';
  end;

  begin
    delete from public.stock_movements
    where movement_type = 'receipt' and item_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
    perform pg_temp.assert_true('manager DELETE denied at ACL', false);
  exception when insufficient_privilege then
    raise notice 'ok: manager DELETE denied at ACL';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T2: layer 2 — no UPDATE/DELETE RLS policies exist (catalog check)
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.assert_true('no UPDATE/DELETE policies on stock_movements',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'stock_movements'
        and cmd in ('UPDATE', 'DELETE')
    ));
  perform pg_temp.assert_true('SELECT policy exists',
    exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'stock_movements'
        and cmd = 'SELECT'
    ));
  perform pg_temp.assert_true('INSERT policy exists',
    exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'stock_movements'
        and cmd = 'INSERT'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- T3: layer 3 — ACL grants SELECT+INSERT only
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.assert_true('authenticated has SELECT',
    has_table_privilege('authenticated', 'public.stock_movements', 'SELECT'));
  perform pg_temp.assert_true('authenticated has INSERT',
    has_table_privilege('authenticated', 'public.stock_movements', 'INSERT'));
  perform pg_temp.assert_true('authenticated lacks UPDATE',
    not has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE'));
  perform pg_temp.assert_true('authenticated lacks DELETE',
    not has_table_privilege('authenticated', 'public.stock_movements', 'DELETE'));
end $$;

-- ---------------------------------------------------------------------------
-- T4: current_stock sums signed quantities per (restaurant, item)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"owner"}',
    true);

  perform pg_temp.assert_true('Rice stock = 100 - 30 - 5 = 65',
    (select quantity from public.current_stock
     where item_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 65);
  perform pg_temp.assert_true('Sugar has no movements → no row',
    not exists (select 1 from public.current_stock
                where item_id = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2'));
end $$;

-- ---------------------------------------------------------------------------
-- T5: current_stock respects tenant isolation (security_invoker)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  -- Owner of B sees only B's rows.
  perform set_config('request.jwt.claims',
    '{"sub":"b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1","restaurant_id":"b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0","role":"owner"}',
    true);

  select count(*) into v_count from public.current_stock;
  perform pg_temp.assert_true('owner of B sees exactly 1 stock row', v_count = 1);
  perform pg_temp.assert_true('that row is Flour @ 200',
    (select quantity from public.current_stock
     where item_id = 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3') = 200);

  -- No claims → no rows at all.
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_count from public.current_stock;
  perform pg_temp.assert_true('no claims → no stock rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T6: create_opening_balance — happy path (manager of A, item Sugar)
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"manager"}',
    true);

  select public.create_opening_balance(
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 25, 55.50) into v_id;

  perform pg_temp.assert_true('RPC returns a movement id', v_id is not null);
  perform pg_temp.assert_true('movement row correct',
    exists (select 1 from public.stock_movements
            where id = v_id
              and movement_type = 'opening_balance'
              and quantity = 25
              and unit_cost = 55.50
              and restaurant_id = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0'));
  perform pg_temp.assert_true('avg_unit_cost seeded on item',
    (select avg_unit_cost from public.items
     where id = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2') = 55.50);
  perform pg_temp.assert_true('current_stock now shows Sugar @ 25',
    (select quantity from public.current_stock
     where item_id = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2') = 25);
end $$;

-- ---------------------------------------------------------------------------
-- T7: create_opening_balance — validation + idempotency
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"manager"}',
    true);

  -- Zero quantity rejected.
  begin
    perform public.create_opening_balance('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 0, 10);
    perform pg_temp.assert_true('zero quantity rejected', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('zero quantity rejected',
      v_msg like 'create_opening_balance: quantity%');
  end;

  -- Negative quantity rejected.
  begin
    perform public.create_opening_balance('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', -5, 10);
    perform pg_temp.assert_true('negative quantity rejected', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('negative quantity rejected',
      v_msg like 'create_opening_balance: quantity%');
  end;

  -- Negative unit cost rejected.
  begin
    perform public.create_opening_balance('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 5, -1);
    perform pg_temp.assert_true('negative unit cost rejected', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('negative unit cost rejected',
      v_msg like 'create_opening_balance: unit cost%');
  end;

  -- Cross-restaurant item rejected.
  begin
    perform public.create_opening_balance('d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 5, 10);
    perform pg_temp.assert_true('cross-restaurant item rejected', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('cross-restaurant item rejected',
      v_msg like 'create_opening_balance: item%not found%');
  end;

  -- Duplicate opening balance rejected (Sugar got one in T6).
  begin
    perform public.create_opening_balance('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 5, 10);
    perform pg_temp.assert_true('duplicate opening balance rejected', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('duplicate opening balance rejected',
      v_msg like '%already has an opening balance%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T8: create_opening_balance — role enforcement (staff denied)
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"staff"}',
    true);

  begin
    perform public.create_opening_balance('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 5, 10);
    perform pg_temp.assert_true('staff opening balance denied', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('staff opening balance denied',
      v_msg like '%only owners and managers%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T9: staff can INSERT movements directly (P2-03 needs this) but not mutate
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"staff"}',
    true);

  insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity, notes)
  values ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0',
          'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'usage', -2, 'staff usage')
  returning id into v_id;
  perform pg_temp.assert_true('staff direct INSERT allowed', v_id is not null);

  -- Staff lacks the UPDATE/DELETE grant entirely, so the ACL rejects before
  -- the trigger would fire (the trigger itself is covered in T1a).
  begin
    update public.stock_movements set notes = 'x' where id = v_id;
    perform pg_temp.assert_true('staff UPDATE rejected', false);
  exception when insufficient_privilege then
    raise notice 'ok: staff UPDATE rejected at ACL';
  end;

  begin
    delete from public.stock_movements where id = v_id;
    perform pg_temp.assert_true('staff DELETE rejected', false);
  exception when insufficient_privilege then
    raise notice 'ok: staff DELETE rejected at ACL';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T10: CHECK constraints — movement_type whitelist, quantity <> 0
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2","restaurant_id":"a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0","role":"manager"}',
    true);

  begin
    insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity)
    values ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0',
            'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'teleport', 5);
    perform pg_temp.assert_true('bad movement_type rejected', false);
  exception when check_violation then
    raise notice 'ok: bad movement_type rejected';
  end;

  begin
    insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity)
    values ('a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0',
            'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'usage', 0);
    perform pg_temp.assert_true('zero quantity rejected', false);
  exception when check_violation then
    raise notice 'ok: zero quantity rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------

select 'P2-01 STOCK LEDGER TESTS PASSED' as result;

rollback;
