-- ============================================================================
-- P1-03 RLS tests: suppliers.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P1-03 migration: `active` defaults true, owner/manager full
-- CRUD in their own restaurant, staff denied entirely (no policies — every
-- staff query is refused), cross-restaurant isolation, per-restaurant name
-- uniqueness, and the GSTIN check constraint.
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

insert into public.suppliers
  (id, restaurant_id, name, contact_person, phone, email, address, gstin, notes) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Fresh Farms', 'Ravi Kumar', '+919876543210', 'ravi@freshfarms.example',
   '12 Market Road, Mumbai', '27ABCDE1234F1Z5', 'Delivers on Tuesdays'),
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Spice Traders', null, null, null, null, null, null),
  ('52000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Dairy Direct', null, null, null, null, null, null);

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
-- T1: manager of A — full CRUD on own restaurant's suppliers
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.suppliers
    (restaurant_id, name, contact_person, phone, email, gstin)
  values ('11111111-1111-1111-1111-111111111111', 'Grain House', 'Meera',
          '+911234567890', 'meera@grainhouse.example', '27ABCDE1234F1Z5')
  returning id into v_id;
  perform pg_temp.assert_true('manager supplier insert ok', v_id is not null);
  perform pg_temp.assert_true('supplier active defaults to true',
    (select active from public.suppliers where id = v_id));

  update public.suppliers set contact_person = 'Meera Shah' where id = v_id;
  perform pg_temp.assert_true('manager supplier update ok',
    (select contact_person from public.suppliers where id = v_id) = 'Meera Shah');

  -- archive (soft delete)
  update public.suppliers set active = false where id = v_id;
  perform pg_temp.assert_true('manager supplier archive ok',
    (select active from public.suppliers where id = v_id) = false);

  -- the default (active-only) list hides the archived row
  perform pg_temp.assert_true('archived supplier hidden from active list',
    not exists (select 1 from public.suppliers
                where id = v_id and active = true));

  -- hard delete of a row succeeds at the DB (the app never does this)
  delete from public.suppliers where id = v_id;
  perform pg_temp.assert_true('manager supplier hard delete ok',
    not exists (select 1 from public.suppliers where id = v_id));
end $$;

-- ---------------------------------------------------------------------------
-- T2: staff of A — denied entirely (no staff policies on suppliers)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  select count(*) into v_count from public.suppliers;
  perform pg_temp.assert_true('staff sees zero suppliers', v_count = 0);

  begin
    insert into public.suppliers (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky Supplies');
    raise exception 'ASSERT FAILED: staff supplier insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff supplier insert denied';
  end;

  update public.suppliers set name = 'Hacked'
  where id = '51000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff supplier update touches 0 rows', v_count = 0);

  update public.suppliers set active = false
  where id = '51000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff supplier archive touches 0 rows', v_count = 0);

  delete from public.suppliers
  where id = '51000000-0000-0000-0000-000000000002';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff supplier delete touches 0 rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T3: cross-restaurant isolation (manager of A vs restaurant B)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from public.suppliers;
  perform pg_temp.assert_true('manager sees only A suppliers', v_count = 2);

  update public.suppliers set name = 'Hacked'
  where id = '52000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('manager cannot touch B supplier', v_count = 0);

  begin
    insert into public.suppliers (restaurant_id, name)
    values ('22222222-2222-2222-2222-222222222222', 'Cross-tenant');
    raise exception 'ASSERT FAILED: cross-restaurant insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: cross-restaurant supplier insert denied';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T4: name uniqueness is per restaurant
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    insert into public.suppliers (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Fresh Farms');
    raise exception 'ASSERT FAILED: duplicate supplier name was allowed';
  exception when unique_violation then
    raise notice 'ok: duplicate supplier name rejected';
  end;

  -- same name in a different restaurant is fine (unique is per-restaurant)
  insert into public.suppliers (restaurant_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Dairy Direct');
  perform pg_temp.assert_true('same name allowed in other restaurant', true);
end $$;

-- ---------------------------------------------------------------------------
-- T5: GSTIN check constraint (loose 15-char alphanumeric at the DB level)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    insert into public.suppliers (restaurant_id, name, gstin)
    values ('11111111-1111-1111-1111-111111111111', 'Bad GSTIN Co', 'TOO-SHORT');
    raise exception 'ASSERT FAILED: malformed gstin was allowed';
  exception when check_violation then
    raise notice 'ok: malformed gstin rejected';
  end;

  insert into public.suppliers (restaurant_id, name, gstin)
  values ('11111111-1111-1111-1111-111111111111', 'GSTIN OK Co', '27ABCDE1234F1Z5');
  perform pg_temp.assert_true('well-formed gstin accepted', true);
end $$;

-- ---------------------------------------------------------------------------
-- T6: owner of B manages B's suppliers (role sanity across restaurants)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  select count(*) into v_count from public.suppliers;
  perform pg_temp.assert_true('owner sees only B suppliers', v_count = 1);

  update public.suppliers set contact_person = 'Anil'
  where id = '52000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('owner supplier update ok', v_count = 1);
end $$;

-- ---------------------------------------------------------------------------

select 'P1-03 RLS TESTS PASSED' as result;

rollback;
