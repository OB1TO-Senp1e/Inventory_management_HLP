-- ============================================================================
-- P5-01 tests: stock count sessions (create, assign, count sheet, progress).
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P5-01 migration (supabase/migrations/20261005090000_stock_counts.sql):
--   * create_stock_count: owner/manager only; assignee must belong to the
--     restaurant; snapshots one line per ACTIVE item with expected_qty from
--     current_stock (0 when no movements); archived items excluded;
--   * current_user_id() reads the JWT subject (null without claims);
--   * staff see and work ONLY their assigned sessions (RLS): SELECT/UPDATE
--     denied for unassigned and others' sessions;
--   * status machine: draft → in_progress → submitted; draft → submitted
--     allowed; submitted terminal; staff cannot change title/assigned_to;
--   * expected_qty frozen after insert (trigger); lines frozen once
--     submitted (update + delete);
--   * cross-restaurant isolation for sessions, lines and the RPC.
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
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), -- manager of A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), -- owner of B
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'), -- staff of A
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'), -- owner of A
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'); -- staff of A (second)

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'staff');

insert into public.units (id, restaurant_id, name, symbol) values
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('60000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'litre', 'L');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point, active) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5, true),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Milk', '60000000-0000-0000-0000-000000000003', 10, 5, true),
  ('61000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Old Stock (archived)', '60000000-0000-0000-0000-000000000001', 10, 5, false);

-- All access checks below run as a non-superuser so RLS is enforced.
set role authenticated;

-- ---------------------------------------------------------------------------
-- Claims helper: act as a given user
-- ---------------------------------------------------------------------------

create or replace function pg_temp.claims(p_user text, p_restaurant text, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"' || p_user || '","restaurant_id":"' || p_restaurant || '","role":"' || p_role || '"}',
    true);
end;
$$;

-- ---------------------------------------------------------------------------
-- T0: current_user_id reads the JWT subject (null without claims)
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  select public.current_user_id() into v_id;
  perform pg_temp.assert_true('current_user_id null without claims', v_id is null);

  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select public.current_user_id() into v_id;
  perform pg_temp.assert_true('current_user_id returns the sub',
    v_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed some stock for the snapshot tests (as manager of A)
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  perform public.create_opening_balance('61000000-0000-0000-0000-000000000001', 7.5, 30);
  perform public.create_opening_balance('61000000-0000-0000-0000-000000000002', 2, 55);
end;
$$;

-- ---------------------------------------------------------------------------
-- T1: create_stock_count snapshots expected qty per active item (manager)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count public.stock_counts;
  v_tom numeric;
  v_milk numeric;
  v_archived integer;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  v_count := public.create_stock_count('Weekly full count',
    'cccccccc-cccc-cccc-cccc-cccccccccccc');

  perform pg_temp.assert_true('count created with title', v_count.title = 'Weekly full count');
  perform pg_temp.assert_true('count starts as draft', v_count.status = 'draft');
  perform pg_temp.assert_true('count assigned to staff',
    v_count.assigned_to = 'cccccccc-cccc-cccc-cccc-cccccccccccc');

  select expected_qty into v_tom from public.stock_count_lines
   where count_id = v_count.id and item_id = '61000000-0000-0000-0000-000000000001';
  select expected_qty into v_milk from public.stock_count_lines
   where count_id = v_count.id and item_id = '61000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('expected_qty snapshotted from current_stock (tomatoes 7.5)', v_tom = 7.5);
  perform pg_temp.assert_true('expected_qty snapshotted from current_stock (milk 2)', v_milk = 2);

  select count(*) into v_archived from public.stock_count_lines
   where count_id = v_count.id and item_id = '61000000-0000-0000-0000-000000000003';
  perform pg_temp.assert_true('archived items get no snapshot line', v_archived = 0);

  perform pg_temp.assert_true('counted_qty starts null',
    not exists (select 1 from public.stock_count_lines
                 where count_id = v_count.id and counted_qty is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: validation — blank title, cross-restaurant assignee, staff denied
-- ---------------------------------------------------------------------------

do $$
declare
  v_dummy public.stock_counts;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');

  begin
    v_dummy := public.create_stock_count('  ', null);
    perform pg_temp.assert_true('blank title rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('blank title rejected', true);
  end;

  begin
    -- bbbb is owner of Restaurant B — not a user of A.
    v_dummy := public.create_stock_count('Bad assignee',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    perform pg_temp.assert_true('cross-restaurant assignee rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('cross-restaurant assignee rejected', true);
  end;

  -- Staff cannot create counts.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');
  begin
    v_dummy := public.create_stock_count('Staff attempt', null);
    perform pg_temp.assert_true('staff cannot create counts', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff cannot create counts', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: staff see and work ONLY their assigned sessions
-- ---------------------------------------------------------------------------

do $$
declare
  v_other_id uuid;
  v_visible integer;
begin
  -- Manager creates a second count, unassigned.
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select id into v_other_id
    from public.create_stock_count('Manager-only count', null);

  -- Staff cccc has one assigned session (from T1) + this unassigned one.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');
  select count(*) into v_visible from public.stock_counts;
  perform pg_temp.assert_true('staff sees exactly their assigned session', v_visible = 1);

  perform pg_temp.assert_true('staff cannot see the unassigned session',
    not exists (select 1 from public.stock_counts where id = v_other_id));

  -- Staff eeee has no assignment: sees nothing.
  perform pg_temp.claims('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '11111111-1111-1111-1111-111111111111', 'staff');
  select count(*) into v_visible from public.stock_counts;
  perform pg_temp.assert_true('unassigned staff sees no sessions', v_visible = 0);

  -- Cross-restaurant: owner of B sees none of A's sessions.
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222', 'owner');
  select count(*) into v_visible from public.stock_counts;
  perform pg_temp.assert_true('cross-restaurant sessions invisible', v_visible = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: line visibility mirrors the session visibility
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
  v_visible integer;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select id into v_count_id from public.stock_counts
   where title = 'Weekly full count';

  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');
  select count(*) into v_visible from public.stock_count_lines
   where count_id = v_count_id;
  perform pg_temp.assert_true('staff reads lines of assigned session', v_visible = 2);

  perform pg_temp.claims('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '11111111-1111-1111-1111-111111111111', 'staff');
  select count(*) into v_visible from public.stock_count_lines
   where count_id = v_count_id;
  perform pg_temp.assert_true('staff cannot read lines of others'' sessions', v_visible = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: staff save progress on assigned sessions; denied elsewhere
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
  v_other_id uuid;
  v_updated integer;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select id into v_count_id from public.stock_counts
   where title = 'Weekly full count';
  select id into v_other_id from public.stock_counts
   where title = 'Manager-only count';

  -- Assigned staff saves a counted qty.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');
  update public.stock_count_lines
     set counted_qty = 6
   where count_id = v_count_id
     and item_id = '61000000-0000-0000-0000-000000000001';
  get diagnostics v_updated = row_count;
  perform pg_temp.assert_true('staff saves counted_qty on assigned session', v_updated = 1);

  -- Same staff member cannot touch the unassigned session's lines.
  update public.stock_count_lines
     set counted_qty = 1
   where count_id = v_other_id
     and item_id = '61000000-0000-0000-0000-000000000001';
  get diagnostics v_updated = row_count;
  perform pg_temp.assert_true('staff cannot save lines of unassigned session', v_updated = 0);

  -- Manager can save progress too.
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  update public.stock_count_lines
     set counted_qty = 5
   where count_id = v_count_id
     and item_id = '61000000-0000-0000-0000-000000000002';
  get diagnostics v_updated = row_count;
  perform pg_temp.assert_true('manager saves counted_qty', v_updated = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: expected_qty frozen; identity columns immutable; staff can't change
--     title/assignment; status machine enforced
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  select id into v_count_id from public.stock_counts
   where title = 'Weekly full count';

  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');

  -- expected_qty frozen.
  begin
    update public.stock_count_lines
       set expected_qty = 999
     where count_id = v_count_id
       and item_id = '61000000-0000-0000-0000-000000000001';
    perform pg_temp.assert_true('expected_qty frozen after snapshot', false);
  exception when raise_exception then
    perform pg_temp.assert_true('expected_qty frozen after snapshot', true);
  end;

  -- draft → in_progress allowed.
  update public.stock_counts set status = 'in_progress' where id = v_count_id;
  perform pg_temp.assert_true('draft → in_progress allowed',
    exists (select 1 from public.stock_counts where id = v_count_id and status = 'in_progress'));

  -- in_progress → draft rejected.
  begin
    update public.stock_counts set status = 'draft' where id = v_count_id;
    perform pg_temp.assert_true('in_progress → draft rejected', false);
  exception when raise_exception then
    perform pg_temp.assert_true('in_progress → draft rejected', true);
  end;

  -- in_progress → submitted allowed.
  update public.stock_counts set status = 'submitted' where id = v_count_id;
  perform pg_temp.assert_true('in_progress → submitted allowed',
    exists (select 1 from public.stock_counts where id = v_count_id and status = 'submitted'));

  -- submitted is terminal.
  begin
    update public.stock_counts set status = 'in_progress' where id = v_count_id;
    perform pg_temp.assert_true('submitted is terminal', false);
  exception when raise_exception then
    perform pg_temp.assert_true('submitted is terminal', true);
  end;

  -- Lines frozen once submitted.
  begin
    update public.stock_count_lines
       set counted_qty = 1
     where count_id = v_count_id
       and item_id = '61000000-0000-0000-0000-000000000001';
    perform pg_temp.assert_true('lines frozen after submit', false);
  exception when raise_exception then
    perform pg_temp.assert_true('lines frozen after submit', true);
  end;

  begin
    delete from public.stock_count_lines
     where count_id = v_count_id
       and item_id = '61000000-0000-0000-0000-000000000001';
    perform pg_temp.assert_true('line delete rejected after submit', false);
  exception when raise_exception then
    perform pg_temp.assert_true('line delete rejected after submit', true);
  end;
end;
$$;

do $$
declare
  v_count_id uuid;
begin
  -- Staff cannot change title/assignment on their assigned session
  -- (a fresh draft one, since T6 submitted the first).
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select (public.create_stock_count('Staff-assigned count',
    'cccccccc-cccc-cccc-cccc-cccccccccccc')).id into v_count_id;

  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');

  begin
    update public.stock_counts set title = 'Renamed by staff' where id = v_count_id;
    perform pg_temp.assert_true('staff cannot change title', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff cannot change title', true);
  end;

  begin
    update public.stock_counts
       set assigned_to = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
     where id = v_count_id;
    perform pg_temp.assert_true('staff cannot reassign the count', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff cannot reassign the count', true);
  end;

  -- …but may move status draft → in_progress on their own session.
  update public.stock_counts set status = 'in_progress' where id = v_count_id;
  perform pg_temp.assert_true('staff may move own session to in_progress',
    exists (select 1 from public.stock_counts where id = v_count_id and status = 'in_progress'));
end;
$$;

rollback;
