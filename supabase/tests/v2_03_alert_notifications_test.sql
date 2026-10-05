-- ============================================================================
-- V2-03 tests: `notifications` + `alert_preferences` RLS, dedupe, checks.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers supabase/migrations/20261005130000_alert_notifications.sql:
--   * owner/manager of the owning restaurant: full CRUD on notifications,
--     upsert/read on alert_preferences;
--   * staff: zero rows on both tables (no policies), writes raise;
--   * cross-restaurant isolation both directions;
--   * dedupe unique index: same (type, item, batch) twice raises 23505;
--     same item with the other type is fine; null batch_no dedupes too;
--   * type CHECK rejects unknown types;
--   * preferences defaults (true/true/7) and window CHECK (1..90);
--   * preference upsert keeps a single row per restaurant.
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
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tomato', 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Milk',   'a0000000-0000-0000-0000-000000000001');

-- RLS only applies to non-superusers: act as `authenticated` (the app's
-- role) for the role-based assertions below.
set role authenticated;

create or replace function pg_temp.claims(p_sub text, p_restaurant text, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    format('{"sub":%s,"restaurant_id":%s,"role":%s}',
           to_json(p_sub::text), to_json(p_restaurant::text), to_json(p_role::text)),
    true);
end;
$$;

-- ---------------------------------------------------------------------------
-- T1: owner of A inserts + reads a low-stock notification
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  insert into public.notifications (restaurant_id, type, title, body, item_id)
    values ('11111111-1111-1111-1111-111111111111', 'low_stock',
            'Tomato is low', '2 kg left (reorder at 5 kg)',
            'b0000000-0000-0000-0000-000000000001')
    returning id into v_id;
  perform pg_temp.assert_true('owner insert returns an id', v_id is not null);
  perform pg_temp.assert_true('owner reads own notification',
    (select count(*) from public.notifications
       where restaurant_id = '11111111-1111-1111-1111-111111111111') = 1);
end $$;

-- ---------------------------------------------------------------------------
-- T2: dedupe index — same (type, item, batch) twice raises 23505
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  begin
    insert into public.notifications (restaurant_id, type, title, item_id)
      values ('11111111-1111-1111-1111-111111111111', 'low_stock',
              'dup', 'b0000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('duplicate active alert was rejected', false);
  exception when unique_violation then
    perform pg_temp.assert_true('duplicate (type,item,batch) raises 23505', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T3: same item, other type is a different alert (allowed)
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  insert into public.notifications (restaurant_id, type, title, item_id, batch_no)
    values ('11111111-1111-1111-1111-111111111111', 'expiring_soon',
            'Milk batch expiring', 'b0000000-0000-0000-0000-000000000002', 'B-12');
  perform pg_temp.assert_true('expiring_soon for same restaurant allowed',
    (select count(*) from public.notifications
       where restaurant_id = '11111111-1111-1111-1111-111111111111') = 2);
end $$;

-- ---------------------------------------------------------------------------
-- T4: null batch_no also dedupes (coalesce in the index)
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  -- First insert with a null batch_no (the low-stock shape).
  insert into public.notifications (restaurant_id, type, title, item_id, batch_no)
    values ('11111111-1111-1111-1111-111111111111', 'low_stock',
            'Milk low (null batch)', 'b0000000-0000-0000-0000-000000000002', null);
  begin
    insert into public.notifications (restaurant_id, type, title, item_id, batch_no)
      values ('11111111-1111-1111-1111-111111111111', 'low_stock',
              'dup null batch', 'b0000000-0000-0000-0000-000000000002', null);
    perform pg_temp.assert_true('null-batch duplicate was rejected', false);
  exception when unique_violation then
    perform pg_temp.assert_true('null batch_no dedupes via coalesce', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T5: type CHECK rejects unknown types
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  begin
    insert into public.notifications (restaurant_id, type, title, item_id)
      values ('11111111-1111-1111-1111-111111111111', 'overstock',
              'bad type', 'b0000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('unknown type was rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('unknown notification type raises', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: manager of A reads, marks read, deletes (resolution path)
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         '11111111-1111-1111-1111-111111111111', 'manager');
  perform pg_temp.assert_true('manager reads A notifications',
    (select count(*) from public.notifications) = 3);
  select id into v_id from public.notifications
   where type = 'low_stock' limit 1;
  update public.notifications set read_at = now() where id = v_id;
  perform pg_temp.assert_true('manager marks notification read',
    (select read_at from public.notifications where id = v_id) is not null);
  delete from public.notifications where id = v_id;
  perform pg_temp.assert_true('manager deletes (resolves) notification',
    (select count(*) from public.notifications
       where id = v_id) = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T7: staff of A sees zero rows and cannot write
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
                         '11111111-1111-1111-1111-111111111111', 'staff');
  perform pg_temp.assert_true('staff sees zero notifications',
    (select count(*) from public.notifications) = 0);
  perform pg_temp.assert_true('staff sees zero preference rows',
    (select count(*) from public.alert_preferences) = 0);
  begin
    insert into public.notifications (restaurant_id, type, title, item_id)
      values ('11111111-1111-1111-1111-111111111111', 'low_stock',
              'staff write', 'b0000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('staff insert was rejected', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('staff insert raises (no policy)', true);
  end;
  begin
    insert into public.alert_preferences (restaurant_id, low_stock_enabled)
      values ('11111111-1111-1111-1111-111111111111', false);
    perform pg_temp.assert_true('staff preference write was rejected', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('staff preference write raises (no policy)', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T8: owner of B is isolated from A's rows (both directions)
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
                         '22222222-2222-2222-2222-222222222222', 'owner');
  perform pg_temp.assert_true('owner of B sees zero notifications',
    (select count(*) from public.notifications) = 0);
  perform pg_temp.assert_true('owner of B sees zero preference rows',
    (select count(*) from public.alert_preferences) = 0);
  begin
    insert into public.notifications (restaurant_id, type, title, item_id)
      values ('11111111-1111-1111-1111-111111111111', 'low_stock',
              'cross write', 'b0000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('cross-restaurant insert was rejected', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('cross-restaurant insert raises', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T9: preferences — defaults, upsert, window CHECK
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  -- Absent row = defaults (client-side contract); a bare insert gets DB defaults.
  insert into public.alert_preferences (restaurant_id)
    values ('11111111-1111-1111-1111-111111111111');
  perform pg_temp.assert_true('preference defaults true/true/7',
    (select low_stock_enabled and expiry_enabled and expiry_days_window = 7
       from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111'));
  -- Upsert keeps one row per restaurant.
  insert into public.alert_preferences
    (restaurant_id, low_stock_enabled, expiry_days_window)
    values ('11111111-1111-1111-1111-111111111111', false, 14)
    on conflict (restaurant_id) do update
      set low_stock_enabled = excluded.low_stock_enabled,
          expiry_days_window = excluded.expiry_days_window,
          updated_at = now();
  perform pg_temp.assert_true('preference upsert keeps one row',
    (select count(*) from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111') = 1
    and (select expiry_days_window from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111') = 14);
  begin
    update public.alert_preferences set expiry_days_window = 0
     where restaurant_id = '11111111-1111-1111-1111-111111111111';
    perform pg_temp.assert_true('window 0 was rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('expiry window 0 raises', true);
  end;
  begin
    update public.alert_preferences set expiry_days_window = 91
     where restaurant_id = '11111111-1111-1111-1111-111111111111';
    perform pg_temp.assert_true('window 91 was rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('expiry window 91 raises', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T10: manager reads/updates preferences; item delete cascades its alerts
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         '11111111-1111-1111-1111-111111111111', 'manager');
  perform pg_temp.assert_true('manager reads preferences',
    (select count(*) from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111') = 1);
  update public.alert_preferences set expiry_enabled = false
   where restaurant_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert_true('manager updates preferences',
    (select not expiry_enabled from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111'));
end $$;

reset role;

-- Item hard-delete cascades its notifications (superuser, RLS bypassed).
delete from public.items where id = 'b0000000-0000-0000-0000-000000000002';

set role authenticated;

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  perform pg_temp.assert_true('deleting an item cascades its notifications',
    (select count(*) from public.notifications
       where item_id = 'b0000000-0000-0000-0000-000000000002') = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T11: upsert_alert_preferences RPC — owner/manager write, staff denied,
-- window validated, tenant-scoped
-- ---------------------------------------------------------------------------

do $$
declare
  v_window integer;
begin
  -- Owner of A upserts (no row exists yet for the assertions above it was
  -- inserted directly; delete it first for a clean RPC path).
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  delete from public.alert_preferences
   where restaurant_id = '11111111-1111-1111-1111-111111111111';
  select expiry_days_window into v_window
    from public.upsert_alert_preferences(true, true, 14);
  perform pg_temp.assert_true('RPC insert returns the window',
    v_window = 14);
  perform pg_temp.assert_true('RPC insert persists one row',
    (select count(*) from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111') = 1);

  -- Second call updates the same row (no duplicate).
  perform public.upsert_alert_preferences(false, true, 21);
  perform pg_temp.assert_true('RPC upsert keeps one row per restaurant',
    (select count(*) from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111') = 1
    and (select not low_stock_enabled from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111'));

  -- Window bounds enforced.
  begin
    perform public.upsert_alert_preferences(true, true, 0);
    perform pg_temp.assert_true('window 0 via RPC was rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('RPC rejects window 0', true);
  end;
  begin
    perform public.upsert_alert_preferences(true, true, 91);
    perform pg_temp.assert_true('window 91 via RPC was rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('RPC rejects window 91', true);
  end;
end $$;

do $$
begin
  -- Manager of A may write via the RPC.
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         '11111111-1111-1111-1111-111111111111', 'manager');
  perform public.upsert_alert_preferences(true, false, 10);
  perform pg_temp.assert_true('manager RPC upsert succeeds',
    (select not expiry_enabled from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111'));

  -- Staff of A is denied by the RPC's internal role check.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
                         '11111111-1111-1111-1111-111111111111', 'staff');
  begin
    perform public.upsert_alert_preferences(true, true, 7);
    perform pg_temp.assert_true('staff RPC write was rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('RPC denies staff', true);
  end;

  -- Owner of B writes their own restaurant's row (tenant-scoped).
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
                         '22222222-2222-2222-2222-222222222222', 'owner');
  perform public.upsert_alert_preferences(true, true, 5);
  perform pg_temp.assert_true('owner of B gets their own row',
    (select expiry_days_window from public.alert_preferences
      where restaurant_id = '22222222-2222-2222-2222-222222222222') = 5);
  -- B cannot see A's row (tenant isolation); verify A's row survived under
  -- A's own claims.
  perform pg_temp.assert_true('B sees only their own row',
    (select count(*) from public.alert_preferences) = 1);
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  perform pg_temp.assert_true('A''s row untouched by B''s upsert',
    (select expiry_days_window from public.alert_preferences
      where restaurant_id = '11111111-1111-1111-1111-111111111111') = 10);
end $$;

reset role;
rollback;

select 'V2-03 ALERT NOTIFICATION TESTS PASSED' as result;
