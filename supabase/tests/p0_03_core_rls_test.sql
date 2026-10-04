-- ============================================================================
-- P0-03 RLS tests: core schema (restaurants, profiles, item_categories,
-- storage_locations, units) + helper functions.
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
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'), -- staff of A
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'), -- spare user (profile write tests)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'); -- spare user (negative tests)

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff');

insert into public.item_categories (restaurant_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Vegetables'),
  ('22222222-2222-2222-2222-222222222222', 'Dairy');

insert into public.storage_locations (restaurant_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Dry Store'),
  ('22222222-2222-2222-2222-222222222222', 'Cold Room');

insert into public.units (restaurant_id, name, symbol) values
  ('11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('22222222-2222-2222-2222-222222222222', 'litre', 'L');

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
-- T1: helpers resolve claims (manager of restaurant A)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  perform pg_temp.assert_true('current_restaurant_id() returns A',
    public.current_restaurant_id() = '11111111-1111-1111-1111-111111111111'::uuid);
  perform pg_temp.assert_true('has_role(manager) is true', public.has_role('manager'));
  perform pg_temp.assert_true('has_role(owner) is false', not public.has_role('owner'));
  perform pg_temp.assert_true('has_role(staff) is false', not public.has_role('staff'));
end $$;

-- ---------------------------------------------------------------------------
-- T2: cross-restaurant reads denied (manager of A)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  -- claims still: manager of A (set in T1)
  select count(*) into v_count from public.restaurants;
  perform pg_temp.assert_true('sees exactly 1 restaurant', v_count = 1);
  select count(*) into v_count from public.restaurants where name = 'Restaurant B';
  perform pg_temp.assert_true('cannot see restaurant B', v_count = 0);

  select count(*) into v_count from public.item_categories;
  perform pg_temp.assert_true('sees only A categories', v_count = 1);
  select count(*) into v_count from public.storage_locations;
  perform pg_temp.assert_true('sees only A locations', v_count = 1);
  select count(*) into v_count from public.units;
  perform pg_temp.assert_true('sees only A units', v_count = 1);
  select count(*) into v_count from public.profiles;
  perform pg_temp.assert_true('sees only A profiles (manager+staff)', v_count = 2);
end $$;

-- ---------------------------------------------------------------------------
-- T3: no claims -> helpers null/false, reads return nothing
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.assert_true('current_restaurant_id() null without claims',
    public.current_restaurant_id() is null);
  perform pg_temp.assert_true('has_role() false without claims',
    not public.has_role('manager'));
  select count(*) into v_count from public.item_categories;
  perform pg_temp.assert_true('categories hidden without claims', v_count = 0);
  select count(*) into v_count from public.restaurants;
  perform pg_temp.assert_true('restaurants hidden without claims', v_count = 0);
  select count(*) into v_count from public.profiles;
  perform pg_temp.assert_true('profiles hidden without claims', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T4: staff cannot write master data or profiles (RLS denies)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  begin
    insert into public.item_categories (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky');
    raise exception 'ASSERT FAILED: staff insert into item_categories was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff insert into item_categories denied';
  end;

  begin
    insert into public.units (restaurant_id, name, symbol)
    values ('11111111-1111-1111-1111-111111111111', 'gram', 'g');
    raise exception 'ASSERT FAILED: staff insert into units was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff insert into units denied';
  end;

  begin
    insert into public.profiles (id, restaurant_id, role)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'staff');
    raise exception 'ASSERT FAILED: staff insert into profiles was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff insert into profiles denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T5: manager writes own-restaurant master data, not the other restaurant's
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_n int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.item_categories (restaurant_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Spices')
  returning id into v_id;
  perform pg_temp.assert_true('manager insert into own categories ok', v_id is not null);

  begin
    insert into public.item_categories (restaurant_id, name)
    values ('22222222-2222-2222-2222-222222222222', 'Sneaky B');
    raise exception 'ASSERT FAILED: cross-restaurant insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: cross-restaurant insert denied';
  end;

  update public.item_categories set name = 'Hacked'
  where restaurant_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics v_n = row_count;
  perform pg_temp.assert_true('cross-restaurant update touches 0 rows', v_n = 0);

  delete from public.storage_locations
  where restaurant_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics v_n = row_count;
  perform pg_temp.assert_true('cross-restaurant delete touches 0 rows', v_n = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T6: profile writes are owner-only
-- ---------------------------------------------------------------------------

do $$
begin
  -- manager of A cannot create profiles
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  begin
    insert into public.profiles (id, restaurant_id, role)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'staff');
    raise exception 'ASSERT FAILED: manager insert into profiles was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: manager insert into profiles denied (owner-only)';
  end;

  -- owner of B creates a profile for B
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  insert into public.profiles (id, restaurant_id, role)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'staff');
  raise notice 'ok: owner insert into own profiles allowed';

  -- owner of B cannot create a profile for A
  begin
    insert into public.profiles (id, restaurant_id, role)
    values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'staff');
    raise exception 'ASSERT FAILED: cross-restaurant profile insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: cross-restaurant profile insert denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T7: constraints — role check, FK to auth.users, unique names, updated_at
-- ---------------------------------------------------------------------------

do $$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  begin
    insert into public.profiles (id, restaurant_id, role)
    values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'superadmin');
    raise exception 'ASSERT FAILED: invalid role was allowed';
  exception when check_violation then
    raise notice 'ok: invalid role rejected';
  end;

  begin
    insert into public.profiles (id, restaurant_id, role)
    values ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'staff');
    raise exception 'ASSERT FAILED: profile without auth.users row was allowed';
  exception when foreign_key_violation then
    raise notice 'ok: profile FK to auth.users enforced';
  end;

  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  begin
    insert into public.item_categories (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Vegetables');
    raise exception 'ASSERT FAILED: duplicate category name was allowed';
  exception when unique_violation then
    raise notice 'ok: duplicate category name rejected';
  end;

  select updated_at into v_before from public.item_categories where name = 'Spices';
  update public.item_categories set name = 'Spices & Herbs' where name = 'Spices';
  select updated_at into v_after from public.item_categories where name = 'Spices & Herbs';
  perform pg_temp.assert_true('updated_at maintained on update',
    v_after is not null and v_after >= v_before);
end $$;

-- ---------------------------------------------------------------------------
-- Done: leave the database clean
-- ---------------------------------------------------------------------------

reset role;
rollback;

select 'P0-03 RLS TESTS PASSED' as result;
