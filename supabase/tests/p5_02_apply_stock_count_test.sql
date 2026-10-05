-- ============================================================================
-- P5-02 tests: apply_stock_count (variance review → ledger adjustments).
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P5-02 migration (supabase/migrations/20261005100000_apply_stock_count.sql):
--   * status machine: submitted → applied (owner/manager only); applied
--     terminal; staff cannot move submitted → applied even on their own
--     assigned sessions (trigger, not only the RPC);
--   * apply_stock_count: owner/manager only; count must exist, be the
--     caller's restaurant, and be submitted; re-applying an applied count
--     raises (idempotent: no double post); every line must be counted;
--   * variance = counted_qty − expected_qty; one signed count_adjustment
--     movement per non-zero variance (reference stock_count/<id>);
--     zero-variance lines post nothing;
--   * one audit_log row (action 'stock_count_applied', entity
--     'stock_count') with the per-line variance payload;
--   * lines are frozen once the session is applied (update + delete);
--   * cross-restaurant isolation.
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
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'); -- owner of A

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'owner');

insert into public.units (id, restaurant_id, name, symbol) values
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('60000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'litre', 'L');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point, active) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5, true),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Milk', '60000000-0000-0000-0000-000000000003', 10, 5, true),
  ('61000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Rice', '60000000-0000-0000-0000-000000000001', 10, 5, true);

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
-- Seed stock + a submitted count with known variances (as manager of A)
--
-- Tomatoes: expected 7.5 (opening balance), counted 8   → variance +0.5
-- Milk:     expected 2   (opening balance), counted 1.5 → variance −0.5
-- Rice:     expected 5   (opening balance), counted 5   → variance  0 (no post)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count public.stock_counts;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  perform public.create_opening_balance('61000000-0000-0000-0000-000000000001', 7.5, 30);
  perform public.create_opening_balance('61000000-0000-0000-0000-000000000002', 2, 55);
  perform public.create_opening_balance('61000000-0000-0000-0000-000000000003', 5, 40);

  select * into v_count from public.create_stock_count('October full count', null);
  update public.stock_count_lines set counted_qty = 8
   where count_id = v_count.id and item_id = '61000000-0000-0000-0000-000000000001';
  update public.stock_count_lines set counted_qty = 1.5
   where count_id = v_count.id and item_id = '61000000-0000-0000-0000-000000000002';
  update public.stock_count_lines set counted_qty = 5
   where count_id = v_count.id and item_id = '61000000-0000-0000-0000-000000000003';
  update public.stock_counts set status = 'submitted' where id = v_count.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- T1: apply posts signed count_adjustment movements + flips status (manager)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
  v_result jsonb;
  v_tom_qty numeric;
  v_milk_qty numeric;
  v_rice_posts integer;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select id into v_count_id from public.stock_counts
   where title = 'October full count';

  select public.apply_stock_count(v_count_id) into v_result;

  perform pg_temp.assert_true('apply returns applied status',
    (v_result ->> 'status') = 'applied');
  perform pg_temp.assert_true('apply summary counts 2 posted adjustments',
    (v_result ->> 'posted_adjustments') = '2');
  perform pg_temp.assert_true('apply summary counts 3 total lines',
    (v_result ->> 'total_lines') = '3');

  perform pg_temp.assert_true('session status is applied',
    exists (select 1 from public.stock_counts
             where id = v_count_id and status = 'applied'));

  select quantity into v_tom_qty from public.stock_movements
   where reference_id = v_count_id
     and item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('positive variance posts +0.5 count_adjustment',
    v_tom_qty = 0.5);

  select quantity into v_milk_qty from public.stock_movements
   where reference_id = v_count_id
     and item_id = '61000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('negative variance posts −0.5 count_adjustment',
    v_milk_qty = -0.5);

  select count(*) into v_rice_posts from public.stock_movements
   where reference_id = v_count_id
     and item_id = '61000000-0000-0000-0000-000000000003';
  perform pg_temp.assert_true('zero-variance line posts nothing', v_rice_posts = 0);

  perform pg_temp.assert_true('movements carry count_adjustment type',
    not exists (select 1 from public.stock_movements
                 where reference_id = v_count_id
                   and movement_type <> 'count_adjustment'));

  perform pg_temp.assert_true('movements tagged stock_count reference',
    not exists (select 1 from public.stock_movements
                 where reference_id = v_count_id
                   and reference_type <> 'stock_count'));
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: one audit_log row with the variance payload
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
  v_details jsonb;
begin
  -- Audit read-back as the owner (only owners can read audit_log, P5-05).
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
    '11111111-1111-1111-1111-111111111111', 'owner');
  select id into v_count_id from public.stock_counts
   where title = 'October full count';

  perform pg_temp.assert_true('one stock_count_applied audit row',
    (select count(*) from public.audit_log
      where action = 'stock_count_applied'
        and entity_type = 'stock_count'
        and entity_id = v_count_id) = 1);

  select details into v_details from public.audit_log
   where action = 'stock_count_applied' and entity_id = v_count_id;
  perform pg_temp.assert_true('audit payload has title + totals',
    (v_details ->> 'title') = 'October full count'
    and (v_details ->> 'total_lines') = '3'
    and (v_details ->> 'posted_adjustments') = '2');
  perform pg_temp.assert_true('audit payload carries per-line variances',
    jsonb_array_length(v_details -> 'adjustments') = 3
    and exists (
      select 1 from jsonb_array_elements(v_details -> 'adjustments') a
       where (a ->> 'name') = 'Tomatoes' and (a ->> 'variance') = '0.5'));
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: re-applying an applied count raises (idempotent — no double post)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
  v_before integer;
  v_after integer;
begin
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
    '11111111-1111-1111-1111-111111111111', 'owner');
  select id into v_count_id from public.stock_counts
   where title = 'October full count';
  select count(*) into v_before from public.stock_movements
   where reference_id = v_count_id;

  begin
    perform public.apply_stock_count(v_count_id);
    perform pg_temp.assert_true('re-apply raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('re-apply raises', true);
  end;

  select count(*) into v_after from public.stock_movements
   where reference_id = v_count_id;
  perform pg_temp.assert_true('re-apply posts nothing extra', v_after = v_before);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: staff cannot apply (RPC denies)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  -- Assigned to the staff user so the post-denial status check below is
  -- visible under RLS (staff can only SELECT their own sessions).
  select (public.create_stock_count('Staff-apply attempt',
    'cccccccc-cccc-cccc-cccc-cccccccccccc')).id into v_count_id;
  update public.stock_count_lines set counted_qty = 1 where count_id = v_count_id;
  update public.stock_counts set status = 'submitted' where id = v_count_id;

  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');
  begin
    perform public.apply_stock_count(v_count_id);
    perform pg_temp.assert_true('staff apply raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff apply raises', true);
  end;

  perform pg_temp.assert_true('staff apply leaves status submitted',
    exists (select 1 from public.stock_counts
             where id = v_count_id and status = 'submitted'));
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: staff cannot move submitted → applied via direct table UPDATE (trigger)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  -- The 'Staff-apply attempt' session is assigned to nobody but visible to
  -- staff? No — staff only see assigned sessions. Create an assigned one.
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select (public.create_stock_count('Staff-assigned count',
    'cccccccc-cccc-cccc-cccc-cccccccccccc')).id into v_count_id;
  update public.stock_count_lines set counted_qty = 1 where count_id = v_count_id;
  update public.stock_counts set status = 'submitted' where id = v_count_id;

  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111', 'staff');
  begin
    update public.stock_counts set status = 'applied' where id = v_count_id;
    perform pg_temp.assert_true('staff direct submitted → applied raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff direct submitted → applied raises', true);
  end;

  perform pg_temp.assert_true('status still submitted after staff attempt',
    exists (select 1 from public.stock_counts
             where id = v_count_id and status = 'submitted'));
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: only submitted counts can be applied (draft / in_progress raise)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select (public.create_stock_count('Draft count', null)).id into v_count_id;

  begin
    perform public.apply_stock_count(v_count_id);
    perform pg_temp.assert_true('apply on draft raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('apply on draft raises', true);
  end;

  update public.stock_counts set status = 'in_progress' where id = v_count_id;
  begin
    perform public.apply_stock_count(v_count_id);
    perform pg_temp.assert_true('apply on in_progress raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('apply on in_progress raises', true);
  end;

  begin
    perform public.apply_stock_count('00000000-0000-0000-0000-000000000000');
    perform pg_temp.assert_true('apply on missing count raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('apply on missing count raises', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T7: uncounted lines raise (variance would be meaningless)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select (public.create_stock_count('Half-counted count', null)).id into v_count_id;
  -- Leave one line uncounted on purpose.
  update public.stock_count_lines set counted_qty = 1
   where count_id = v_count_id
     and item_id = '61000000-0000-0000-0000-000000000001';
  update public.stock_counts set status = 'submitted' where id = v_count_id;

  begin
    perform public.apply_stock_count(v_count_id);
    perform pg_temp.assert_true('apply with uncounted lines raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('apply with uncounted lines raises', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T8: cross-restaurant isolation
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222', 'owner');
  begin
    perform public.apply_stock_count(
      (select id from public.stock_counts where title = 'October full count'));
    perform pg_temp.assert_true('cross-restaurant apply raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('cross-restaurant apply raises', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T9: lines frozen once applied (update + delete raise)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
    '11111111-1111-1111-1111-111111111111', 'owner');
  select id into v_count_id from public.stock_counts
   where title = 'October full count';

  begin
    update public.stock_count_lines set counted_qty = 9
     where count_id = v_count_id
       and item_id = '61000000-0000-0000-0000-000000000001';
    perform pg_temp.assert_true('lines frozen after apply (update)', false);
  exception when raise_exception then
    perform pg_temp.assert_true('lines frozen after apply (update)', true);
  end;

  begin
    delete from public.stock_count_lines
     where count_id = v_count_id
       and item_id = '61000000-0000-0000-0000-000000000001';
    perform pg_temp.assert_true('lines frozen after apply (delete)', false);
  exception when raise_exception then
    perform pg_temp.assert_true('lines frozen after apply (delete)', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T10: applied is terminal (no transition out)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count_id uuid;
begin
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
    '11111111-1111-1111-1111-111111111111', 'owner');
  select id into v_count_id from public.stock_counts
   where title = 'October full count';

  begin
    update public.stock_counts set status = 'submitted' where id = v_count_id;
    perform pg_temp.assert_true('applied → submitted raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('applied → submitted raises', true);
  end;

  begin
    update public.stock_counts set status = 'draft' where id = v_count_id;
    perform pg_temp.assert_true('applied → draft raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('applied → draft raises', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T11: existing transitions still work (draft → in_progress → submitted)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count public.stock_counts;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'manager');
  select * into v_count from public.create_stock_count('Machine check', null);
  update public.stock_counts set status = 'in_progress' where id = v_count.id;
  update public.stock_counts set status = 'submitted' where id = v_count.id;
  perform pg_temp.assert_true('draft → in_progress → submitted still allowed',
    exists (select 1 from public.stock_counts
             where id = v_count.id and status = 'submitted'));
end;
$$;

rollback;
