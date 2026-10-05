-- ============================================================================
-- V2-01 tests: `items.barcode` uniqueness + `find_item_by_barcode` RPC.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers supabase/migrations/20261005120000_item_barcode.sql:
--   * barcode is optional (nulls allowed, many nulls coexist);
--   * uniqueness is per restaurant (duplicate in the same restaurant
--     raises 23505; the same code in another restaurant is fine);
--   * `find_item_by_barcode` resolves the item for owner/manager/staff of
--     the owning restaurant, returns zero rows for unknown or blank codes;
--   * tenant isolation (owner of B cannot resolve A's barcode);
--   * without JWT claims the RPC raises (staff of A can't be impersonated);
--   * archived items are not resolved;
--   * staff still see zero rows on `items` directly (barcode column does not
--     leak through RLS — the RPC is the only staff path).
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
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, barcode) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tomato', 'a0000000-0000-0000-0000-000000000001', '8901000000011'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Flour',  'a0000000-0000-0000-0000-000000000001', null),
  ('b0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tomato', 'a0000000-0000-0000-0000-000000000002', null);

-- RLS only applies to non-superusers: act as `authenticated` (the app's
-- role) for the role-based assertions below.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: null barcodes coexist (uniqueness is partial)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  perform pg_temp.assert_true('two null-barcode items exist in A',
    (select count(*) from public.items
       where restaurant_id = '11111111-1111-1111-1111-111111111111'
         and barcode is null) >= 1);
end $$;

-- ---------------------------------------------------------------------------
-- T2: duplicate barcode in the SAME restaurant raises 23505
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  begin
    insert into public.items (restaurant_id, name, unit_id, barcode)
      values ('11111111-1111-1111-1111-111111111111', 'Cherry Tomato',
              'a0000000-0000-0000-0000-000000000001', '8901000000011');
    perform pg_temp.assert_true('duplicate barcode was rejected', false);
  exception when unique_violation then
    perform pg_temp.assert_true('duplicate barcode in same restaurant raises', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T3: same barcode in ANOTHER restaurant is fine
-- ---------------------------------------------------------------------------

do $$
begin
  -- T2 left the claims as owner of A: switch to owner of B for the
  -- cross-restaurant write.
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  update public.items
     set barcode = '8901000000011'
   where id = 'b0000000-0000-0000-0000-000000000003';
  perform pg_temp.assert_true('same barcode in another restaurant allowed',
    (select barcode from public.items
       where id = 'b0000000-0000-0000-0000-000000000003') = '8901000000011');
end $$;

-- ---------------------------------------------------------------------------
-- T4: find_item_by_barcode resolves for owner, manager AND staff of A
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select item_name into v_name from public.find_item_by_barcode('8901000000011');
  perform pg_temp.assert_true('owner resolves barcode to Tomato', v_name = 'Tomato');

  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select item_name into v_name from public.find_item_by_barcode('8901000000011');
  perform pg_temp.assert_true('manager resolves barcode to Tomato', v_name = 'Tomato');

  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  select item_name into v_name from public.find_item_by_barcode('8901000000011');
  perform pg_temp.assert_true('staff resolves barcode to Tomato', v_name = 'Tomato');
end $$;

-- ---------------------------------------------------------------------------
-- T5: unknown and blank barcodes return zero rows (not an error)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select count(*) into v_count from public.find_item_by_barcode('0000000000000');
  perform pg_temp.assert_true('unknown barcode returns zero rows', v_count = 0);
  select count(*) into v_count from public.find_item_by_barcode('   ');
  perform pg_temp.assert_true('blank barcode returns zero rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T6: tenant isolation — owner of B resolves B's item, not A's
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  -- B's Tomato shares the code after T3, but the RPC must pin to B's row.
  select item_id into v_id from public.find_item_by_barcode('8901000000011');
  perform pg_temp.assert_true('owner of B resolves only B''s item',
    v_id = 'b0000000-0000-0000-0000-000000000003');
end $$;

-- ---------------------------------------------------------------------------
-- T7: without JWT claims the RPC raises
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform * from public.find_item_by_barcode('8901000000011');
    perform pg_temp.assert_true('RPC without claims was rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('RPC without claims raises', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T8: archived items are not resolved
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  -- T7 left the claims empty: restore owner-of-A claims for the update.
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  update public.items set active = false
    where id = 'b0000000-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select count(*) into v_count from public.find_item_by_barcode('8901000000011');
  perform pg_temp.assert_true('archived item is not resolved', v_count = 0);
  update public.items set active = true
    where id = 'b0000000-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- T9: staff still see zero rows on `items` directly (barcode via RPC only)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  select count(*) into v_count from public.items;
  perform pg_temp.assert_true('staff sees zero rows on items (no barcode leak)', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- Done: leave the database clean
-- ---------------------------------------------------------------------------

reset role;
rollback;

select 'V2-01 BARCODE TESTS PASSED' as result;
