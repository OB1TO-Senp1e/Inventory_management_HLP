-- ============================================================================
-- P1-04 RLS/RPC tests: supplier_prices + supplier_price_history.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P1-04 migration: owner/manager CRUD on supplier_prices in
-- their own restaurant, staff denied entirely (no policies — every staff
-- query is refused), cross-restaurant isolation, per-pair uniqueness,
-- unit_price > 0, RESTRICT on supplier/item deletes, the
-- set_preferred_supplier() RPC (atomic switch, one preferred per item,
-- archived-supplier/item rejection), the price-history trigger (insert /
-- price-changing update / delete recorded; preferred toggles not
-- recorded), history append-only enforcement (UPDATE/DELETE rejected),
-- and direct history writes denied.
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
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Onions', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('62000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Milk', '60000000-0000-0000-0000-000000000002', 10, 5);

insert into public.suppliers (id, restaurant_id, name) values
  ('63000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Fresh Farms'),
  ('63000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Veggie World'),
  ('64000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dairy Direct');

-- A price row in restaurant B (for cross-restaurant isolation checks).
insert into public.supplier_prices (restaurant_id, supplier_id, item_id, unit_price) values
  ('22222222-2222-2222-2222-222222222222',
   '64000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', 60.00);

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
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: manager of A — CRUD on supplier_prices + history trigger
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_hist_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- insert a price: history row recorded (old null → new 45.50)
  insert into public.supplier_prices
    (restaurant_id, supplier_id, item_id, unit_price)
  values ('11111111-1111-1111-1111-111111111111',
          '63000000-0000-0000-0000-000000000001',
          '61000000-0000-0000-0000-000000000001', 45.50)
  returning id into v_id;
  perform pg_temp.assert_true('manager price insert ok', v_id is not null);
  perform pg_temp.assert_true('currency defaults to INR',
    (select currency from public.supplier_prices where id = v_id) = 'INR');
  perform pg_temp.assert_true('is_preferred defaults to false',
    (select is_preferred from public.supplier_prices where id = v_id) = false);

  select count(*) into v_hist_count from public.supplier_price_history
  where supplier_id = '63000000-0000-0000-0000-000000000001'
    and item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('history row written on insert', v_hist_count = 1);
  perform pg_temp.assert_true('history insert has old null, new 45.50',
    exists (select 1 from public.supplier_price_history
            where supplier_id = '63000000-0000-0000-0000-000000000001'
              and item_id = '61000000-0000-0000-0000-000000000001'
              and old_price is null and new_price = 45.50));

  -- price-changing update: history row recorded
  update public.supplier_prices set unit_price = 48.00 where id = v_id;
  select count(*) into v_hist_count from public.supplier_price_history
  where supplier_id = '63000000-0000-0000-0000-000000000001'
    and item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('history row written on price update', v_hist_count = 2);
  perform pg_temp.assert_true('history update records 45.50 → 48.00',
    exists (select 1 from public.supplier_price_history
            where supplier_id = '63000000-0000-0000-0000-000000000001'
              and item_id = '61000000-0000-0000-0000-000000000001'
              and old_price = 45.50 and new_price = 48.00));

  -- preferred-only toggle: no history row (not a price change)
  update public.supplier_prices set is_preferred = true where id = v_id;
  select count(*) into v_hist_count from public.supplier_price_history
  where supplier_id = '63000000-0000-0000-0000-000000000001'
    and item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('preferred toggle writes no history', v_hist_count = 2);

  -- delete: history row recorded (old 48.00 → new null)
  delete from public.supplier_prices where id = v_id;
  perform pg_temp.assert_true('manager price delete ok',
    not exists (select 1 from public.supplier_prices where id = v_id));
  perform pg_temp.assert_true('history row written on delete',
    exists (select 1 from public.supplier_price_history
            where supplier_id = '63000000-0000-0000-0000-000000000001'
              and item_id = '61000000-0000-0000-0000-000000000001'
              and old_price = 48.00 and new_price is null));
end $$;

-- ---------------------------------------------------------------------------
-- T2: constraints — per-pair uniqueness, unit_price > 0, currency default
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.supplier_prices
    (restaurant_id, supplier_id, item_id, unit_price)
  values ('11111111-1111-1111-1111-111111111111',
          '63000000-0000-0000-0000-000000000001',
          '61000000-0000-0000-0000-000000000001', 45.50);

  begin
    insert into public.supplier_prices
      (restaurant_id, supplier_id, item_id, unit_price)
    values ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000001',
            '61000000-0000-0000-0000-000000000001', 50.00);
    raise exception 'ASSERT FAILED: duplicate (supplier, item) was allowed';
  exception when unique_violation then
    raise notice 'ok: duplicate (supplier, item) rejected';
  end;

  begin
    insert into public.supplier_prices
      (restaurant_id, supplier_id, item_id, unit_price)
    values ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000002',
            '61000000-0000-0000-0000-000000000001', 0);
    raise exception 'ASSERT FAILED: zero unit_price was allowed';
  exception when check_violation then
    raise notice 'ok: zero unit_price rejected';
  end;

  begin
    insert into public.supplier_prices
      (restaurant_id, supplier_id, item_id, unit_price)
    values ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000002',
            '61000000-0000-0000-0000-000000000001', -5);
    raise exception 'ASSERT FAILED: negative unit_price was allowed';
  exception when check_violation then
    raise notice 'ok: negative unit_price rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T3: set_preferred_supplier RPC — atomic switch, one preferred per item
-- ---------------------------------------------------------------------------

do $$
declare
  v_row public.supplier_prices%rowtype;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- second supplier prices the same item
  insert into public.supplier_prices
    (restaurant_id, supplier_id, item_id, unit_price)
  values ('11111111-1111-1111-1111-111111111111',
          '63000000-0000-0000-0000-000000000002',
          '61000000-0000-0000-0000-000000000001', 44.00);

  -- set first supplier preferred
  select * into v_row from public.set_preferred_supplier(
    '61000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true('RPC sets first supplier preferred',
    v_row.is_preferred = true);

  -- switch to the second: exactly one preferred remains
  select * into v_row from public.set_preferred_supplier(
    '61000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true('RPC switches preferred', v_row.is_preferred = true);
  perform pg_temp.assert_true('exactly one preferred per item',
    (select count(*) from public.supplier_prices
     where item_id = '61000000-0000-0000-0000-000000000001'
       and is_preferred = true) = 1);
  perform pg_temp.assert_true('old preferred was cleared',
    (select is_preferred from public.supplier_prices
     where supplier_id = '63000000-0000-0000-0000-000000000001'
       and item_id = '61000000-0000-0000-0000-000000000001') = false);

  -- idempotent: setting the already-preferred supplier is a no-op
  select * into v_row from public.set_preferred_supplier(
    '61000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true('RPC idempotent on already-preferred',
    v_row.is_preferred = true);

  -- direct second-preferred insert violates the partial unique index
  begin
    insert into public.supplier_prices
      (restaurant_id, supplier_id, item_id, unit_price, is_preferred)
    values ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000001',
            '61000000-0000-0000-0000-000000000002', 45.50, true),
           ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000002',
            '61000000-0000-0000-0000-000000000002', 44.00, true);
    raise exception 'ASSERT FAILED: two preferred rows were allowed';
  exception when unique_violation then
    raise notice 'ok: partial unique index rejects two preferred rows';
  end;

  -- unknown (supplier, item) pair → RPC raises
  begin
    perform public.set_preferred_supplier(
      '61000000-0000-0000-0000-000000000002',
      '63000000-0000-0000-0000-000000000002');
    raise exception 'ASSERT FAILED: RPC accepted unknown price pair';
  exception when raise_exception then
    raise notice 'ok: RPC rejects unknown price pair';
  end;

  -- archived supplier cannot become preferred
  update public.suppliers set active = false
  where id = '63000000-0000-0000-0000-000000000002';
  begin
    perform public.set_preferred_supplier(
      '61000000-0000-0000-0000-000000000001',
      '63000000-0000-0000-0000-000000000002');
    raise exception 'ASSERT FAILED: RPC accepted archived supplier';
  exception when raise_exception then
    raise notice 'ok: RPC rejects archived supplier';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T4: staff of A — denied entirely on both tables
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  select count(*) into v_count from public.supplier_prices;
  perform pg_temp.assert_true('staff sees zero prices', v_count = 0);

  select count(*) into v_count from public.supplier_price_history;
  perform pg_temp.assert_true('staff sees zero history rows', v_count = 0);

  begin
    insert into public.supplier_prices
      (restaurant_id, supplier_id, item_id, unit_price)
    values ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000001',
            '61000000-0000-0000-0000-000000000001', 99.00);
    raise exception 'ASSERT FAILED: staff price insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff price insert denied';
  end;

  begin
    perform public.set_preferred_supplier(
      '61000000-0000-0000-0000-000000000001',
      '63000000-0000-0000-0000-000000000001');
    raise exception 'ASSERT FAILED: staff RPC call was allowed';
  exception when raise_exception then
    raise notice 'ok: staff RPC call denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T5: cross-restaurant isolation (manager of A vs restaurant B)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- B's price rows are invisible to the manager of A
  select count(*) into v_count from public.supplier_prices
  where restaurant_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert_true('manager cannot see B prices', v_count = 0);

  select count(*) into v_count from public.supplier_price_history
  where restaurant_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert_true('manager cannot see B history', v_count = 0);

  begin
    insert into public.supplier_prices
      (restaurant_id, supplier_id, item_id, unit_price)
    values ('22222222-2222-2222-2222-222222222222',
            '64000000-0000-0000-0000-000000000001',
            '62000000-0000-0000-0000-000000000001', 61.00);
    raise exception 'ASSERT FAILED: cross-restaurant insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: cross-restaurant price insert denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: history is append-only — UPDATE/DELETE rejected, direct writes denied
-- ---------------------------------------------------------------------------

do $$
declare
  v_hist_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select id into v_hist_id from public.supplier_price_history limit 1;

  -- No UPDATE/DELETE grants exist on the history table, so the ACL denies
  -- these before the trigger even fires.
  begin
    update public.supplier_price_history set new_price = 1 where id = v_hist_id;
    raise exception 'ASSERT FAILED: history update was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: history UPDATE denied';
  end;

  begin
    delete from public.supplier_price_history where id = v_hist_id;
    raise exception 'ASSERT FAILED: history delete was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: history DELETE denied';
  end;

  begin
    insert into public.supplier_price_history
      (restaurant_id, supplier_id, item_id, old_price, new_price)
    values ('11111111-1111-1111-1111-111111111111',
            '63000000-0000-0000-0000-000000000001',
            '61000000-0000-0000-0000-000000000001', 1, 2);
    raise exception 'ASSERT FAILED: direct history insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: direct history insert denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6b: the append-only trigger rejects writes even if grants were loosened
-- (defense in depth — the ACL is the first layer, tested in T6).
-- ---------------------------------------------------------------------------

reset role; -- back to postgres (superuser) for the temporary grant
grant update, delete on public.supplier_price_history to authenticated;
set role authenticated;

do $$
declare
  v_hist_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select id into v_hist_id from public.supplier_price_history limit 1;

  begin
    update public.supplier_price_history set new_price = 1 where id = v_hist_id;
    raise exception 'ASSERT FAILED: trigger allowed history update';
  exception when raise_exception then
    raise notice 'ok: append-only trigger rejects UPDATE';
  end;

  begin
    delete from public.supplier_price_history where id = v_hist_id;
    raise exception 'ASSERT FAILED: trigger allowed history delete';
  exception when raise_exception then
    raise notice 'ok: append-only trigger rejects DELETE';
  end;
end $$;

reset role;
revoke update, delete on public.supplier_price_history from authenticated;
set role authenticated;

-- ---------------------------------------------------------------------------
-- T7: RESTRICT — supplier/item with prices cannot be hard-deleted
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    delete from public.suppliers
    where id = '63000000-0000-0000-0000-000000000001';
    raise exception 'ASSERT FAILED: supplier with prices was deleted';
  exception when foreign_key_violation then
    raise notice 'ok: supplier with prices is RESTRICTed';
  end;

  begin
    delete from public.items
    where id = '61000000-0000-0000-0000-000000000001';
    raise exception 'ASSERT FAILED: item with prices was deleted';
  exception when foreign_key_violation then
    raise notice 'ok: item with prices is RESTRICTed';
  end;
end $$;

-- ---------------------------------------------------------------------------

select 'P1-04 RLS TESTS PASSED' as result;

rollback;
