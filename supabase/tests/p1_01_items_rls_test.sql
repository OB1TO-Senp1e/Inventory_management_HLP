-- ============================================================================
-- P1-01 RLS tests: items catalog.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Pitfall: superusers and table owners bypass RLS, so every access check
-- runs as the non-superuser `authenticated` role via SET ROLE. JWT claims
-- are faked through the `request.jwt.claims` GUC — the same channel
-- Supabase uses to populate auth.jwt().
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

insert into public.item_categories (id, restaurant_id, name) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Vegetables'),
  ('c0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Dairy');

insert into public.storage_locations (id, restaurant_id, name) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Dry Store'),
  ('d0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Cold Room');

insert into public.units (id, restaurant_id, name, symbol) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'litre', 'L');

insert into public.items
  (id, restaurant_id, name, category_id, unit_id, storage_location_id, par_level, reorder_point)
values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomato', 'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001', 10, 4),
  ('f0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Milk', 'c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000002', 20, 8);

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
-- T1: manager of A — full CRUD on own restaurant's items
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from public.items;
  perform pg_temp.assert_true('manager sees only A items', v_count = 1);

  insert into public.items (restaurant_id, name, unit_id, par_level, reorder_point)
  values ('11111111-1111-1111-1111-111111111111', 'Onion', 'e0000000-0000-0000-0000-000000000001', 5, 2)
  returning id into v_id;
  perform pg_temp.assert_true('manager insert ok', v_id is not null);
  perform pg_temp.assert_true('active defaults to true',
    (select active from public.items where id = v_id));

  update public.items set par_level = 7 where id = v_id;
  perform pg_temp.assert_true('manager update ok',
    (select par_level from public.items where id = v_id) = 7);

  -- archive (soft delete)
  update public.items set active = false where id = v_id;
  perform pg_temp.assert_true('manager archive ok',
    (select active from public.items where id = v_id) = false);
end $$;

-- ---------------------------------------------------------------------------
-- T2: owner of B — CRUD on own restaurant's items
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  select count(*) into v_count from public.items;
  perform pg_temp.assert_true('owner sees only B items', v_count = 1);

  insert into public.items (restaurant_id, name, unit_id)
  values ('22222222-2222-2222-2222-222222222222', 'Curd', 'e0000000-0000-0000-0000-000000000002')
  returning id into v_id;
  perform pg_temp.assert_true('owner insert ok', v_id is not null);
end $$;

-- ---------------------------------------------------------------------------
-- T3: staff of A — NO access to items at all (read, write, archive)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  select count(*) into v_count from public.items;
  perform pg_temp.assert_true('staff select returns 0 rows', v_count = 0);

  begin
    insert into public.items (restaurant_id, name, unit_id)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky', 'e0000000-0000-0000-0000-000000000001');
    raise exception 'ASSERT FAILED: staff insert into items was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff insert into items denied';
  end;

  update public.items set name = 'Hacked'
  where id = 'f0000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff update touches 0 rows', v_count = 0);

  delete from public.items
  where id = 'f0000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff delete touches 0 rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T4: cross-restaurant isolation (manager of A vs restaurant B)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from public.items
  where restaurant_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert_true('cannot see B items', v_count = 0);

  begin
    insert into public.items (restaurant_id, name, unit_id)
    values ('22222222-2222-2222-2222-222222222222', 'Sneaky B', 'e0000000-0000-0000-0000-000000000002');
    raise exception 'ASSERT FAILED: cross-restaurant insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: cross-restaurant insert denied';
  end;

  update public.items set name = 'Hacked'
  where restaurant_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('cross-restaurant update touches 0 rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T5: constraints — unique name, non-negative levels, required unit, FKs
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    insert into public.items (restaurant_id, name, unit_id)
    values ('11111111-1111-1111-1111-111111111111', 'Tomato', 'e0000000-0000-0000-0000-000000000001');
    raise exception 'ASSERT FAILED: duplicate item name was allowed';
  exception when unique_violation then
    raise notice 'ok: duplicate (restaurant_id, name) rejected';
  end;

  -- same name in the OTHER restaurant is fine
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  insert into public.items (restaurant_id, name, unit_id)
  values ('22222222-2222-2222-2222-222222222222', 'Tomato', 'e0000000-0000-0000-0000-000000000002');
  raise notice 'ok: same name allowed in another restaurant';

  begin
    insert into public.items (restaurant_id, name, unit_id, par_level)
    values ('22222222-2222-2222-2222-222222222222', 'Bad Par', 'e0000000-0000-0000-0000-000000000002', -1);
    raise exception 'ASSERT FAILED: negative par_level was allowed';
  exception when check_violation then
    raise notice 'ok: negative par_level rejected';
  end;

  begin
    insert into public.items (restaurant_id, name, unit_id, reorder_point)
    values ('22222222-2222-2222-2222-222222222222', 'Bad Reorder', 'e0000000-0000-0000-0000-000000000002', -5);
    raise exception 'ASSERT FAILED: negative reorder_point was allowed';
  exception when check_violation then
    raise notice 'ok: negative reorder_point rejected';
  end;

  begin
    insert into public.items (restaurant_id, name, unit_id)
    values ('22222222-2222-2222-2222-222222222222', 'No Unit', null);
    raise exception 'ASSERT FAILED: null unit_id was allowed';
  exception when not_null_violation then
    raise notice 'ok: null unit_id rejected';
  end;

  begin
    insert into public.items (restaurant_id, name, unit_id, category_id)
    values ('22222222-2222-2222-2222-222222222222', 'Bad Cat', 'e0000000-0000-0000-0000-000000000002',
            '99999999-9999-9999-9999-999999999999');
    raise exception 'ASSERT FAILED: dangling category_id was allowed';
  exception when foreign_key_violation then
    raise notice 'ok: dangling category_id rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: no claims -> items hidden
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_count from public.items;
  perform pg_temp.assert_true('items hidden without claims', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- Done: leave the database clean
-- ---------------------------------------------------------------------------

reset role;
rollback;

select 'P1-01 RLS TESTS PASSED' as result;
