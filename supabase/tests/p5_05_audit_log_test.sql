-- ============================================================================
-- P5-05 tests: audit log is owner-only (RLS), append-only (trigger + ACL).
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers supabase/migrations/20261005110000_audit_log_owner_only.sql:
--   * owner reads own restaurant's entries;
--   * manager sees zero rows (blocked by RLS);
--   * staff sees zero rows (blocked by RLS);
--   * cross-restaurant isolation (owner of B cannot read A's entries);
--   * append-only: UPDATE/DELETE raise even for the owner;
--   * direct INSERT is denied (no write policies) even for the owner;
--   * the old manager-read policy is gone.
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

-- Audit rows as a SECURITY DEFINER RPC would write them.
insert into public.audit_log (restaurant_id, action, entity_type, details, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'over_sale', 'stock_movement',
   '{"sale_date":"2026-10-05","lines":[],"flagged_items":[]}'::jsonb,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('11111111-1111-1111-1111-111111111111', 'stock_count_applied', 'stock_count',
   '{"title":"Weekly count","total_lines":3,"posted_adjustments":2,"adjustments":[]}'::jsonb,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'over_sale', 'stock_movement',
   '{"sale_date":"2026-10-05","lines":[],"flagged_items":[]}'::jsonb,
   'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- RLS only applies to non-superusers: act as `authenticated` (the app's
-- role) for the role-based assertions below.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: owner reads own restaurant's entries
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select count(*) into v_count from public.audit_log;
  perform pg_temp.assert_true('owner reads own restaurant entries (2)', v_count = 2);
  perform pg_temp.assert_true('owner sees both action kinds',
    exists (select 1 from public.audit_log where action = 'over_sale')
    and exists (select 1 from public.audit_log where action = 'stock_count_applied'));
end $$;

-- ---------------------------------------------------------------------------
-- T2: manager is blocked by RLS (acceptance: staff/manager blocked)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select count(*) into v_count from public.audit_log;
  perform pg_temp.assert_true('manager sees zero rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T3: staff is blocked by RLS
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  select count(*) into v_count from public.audit_log;
  perform pg_temp.assert_true('staff sees zero rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T4: cross-restaurant isolation (owner of B reads only B)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  select count(*) into v_count from public.audit_log;
  perform pg_temp.assert_true('owner of B reads only B entries (1)', v_count = 1);
  perform pg_temp.assert_true('owner of B sees no A entries',
    not exists (select 1 from public.audit_log where restaurant_id = '11111111-1111-1111-1111-111111111111'));
end $$;

-- ---------------------------------------------------------------------------
-- T5: append-only — UPDATE/DELETE raise even for the owner
-- ---------------------------------------------------------------------------

do $$
declare
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  begin
    update public.audit_log set action = 'tampered' where action = 'over_sale';
  exception when others then
    v_raised := true;
  end;
  perform pg_temp.assert_true('UPDATE on audit_log raises (owner)', v_raised);

  v_raised := false;
  begin
    delete from public.audit_log where action = 'over_sale';
  exception when others then
    v_raised := true;
  end;
  perform pg_temp.assert_true('DELETE on audit_log raises (owner)', v_raised);
end $$;

-- ---------------------------------------------------------------------------
-- T6: direct INSERT denied (no write policies), even for the owner
-- ---------------------------------------------------------------------------

do $$
declare
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  begin
    insert into public.audit_log (restaurant_id, action)
    values ('11111111-1111-1111-1111-111111111111', 'manual_entry');
  exception when others then
    v_raised := true;
  end;
  perform pg_temp.assert_true('direct INSERT on audit_log raises (owner)', v_raised);
end $$;

-- ---------------------------------------------------------------------------
-- T7: the old manager policy is gone
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.assert_true('audit_log_select_manager policy does not exist',
    not exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'audit_log'
                  and policyname = 'audit_log_select_manager'));
  perform pg_temp.assert_true('audit_log_select_owner policy exists',
    exists (select 1 from pg_policies
            where schemaname = 'public' and tablename = 'audit_log'
              and policyname = 'audit_log_select_owner'));
end $$;

reset role;

rollback;
