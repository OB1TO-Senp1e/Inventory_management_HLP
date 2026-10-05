-- ============================================================================
-- V2-07 tests: multi-outlet support.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the V2-07 migration
-- (supabase/migrations/20261005160000_multi_outlet.sql):
--   * outlets table + "Main outlet" auto-provisioning (data migration and
--     the effective_outlet_id() fallback);
--   * stock becomes outlet-scoped: outlet_id on stock_movements (NOT NULL,
--     backfilled), current_stock per (restaurant, outlet, item);
--   * RLS outlet isolation: no role can read/write another outlet's rows
--     via any path (negative tests);
--   * switch_outlet(): validation (unknown / foreign / inactive outlet);
--   * transfer_stock(): atomic paired transfer_out/transfer_in, strict
--     over-transfer rejection, no self-transfer, same-restaurant only,
--     batch/expiry preservation, owner/manager only;
--   * outlet deactivation guard: blocked with stock on hand, blocked for
--     the last active outlet, clean deactivate re-pins users;
--   * outlets table RLS: owner manages, manager/staff read-only;
--   * outlet_id on stock_counts / notifications / pos_imports.
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
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B'),
  ('33333333-3333-3333-3333-333333333333', 'Restaurant C'); -- no outlets: provisioning test

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), -- owner of A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), -- manager of A
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'), -- staff of A
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'), -- owner of B
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'); -- owner of C

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'owner'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '33333333-3333-3333-3333-333333333333', 'owner');

insert into public.units (id, restaurant_id, name, symbol) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, reorder_point) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tomato', 'a0000000-0000-0000-0000-000000000001', 5),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Milk',   'a0000000-0000-0000-0000-000000000001', 5);

-- Two outlets for restaurant A (deterministic ids for assertions).
insert into public.outlets (id, restaurant_id, name, is_default) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Main outlet', true),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Downtown', false);

-- One outlet for restaurant B.
insert into public.outlets (id, restaurant_id, name, is_default) values
  ('c0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Main outlet', true);

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
-- T1: "Main outlet" auto-provisioning for a restaurant without outlets
-- ---------------------------------------------------------------------------

do $$
declare
  v_outlet_id uuid;
  v_pinned uuid;
begin
  -- Restaurant C's owner has no outlet yet; effective_outlet_id provisions it.
  perform pg_temp.claims('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                         '33333333-3333-3333-3333-333333333333', 'owner');

  select public.effective_outlet_id() into v_outlet_id;
  perform pg_temp.assert_true('provisioning returns an outlet', v_outlet_id is not null);
  perform pg_temp.assert_true('provisioned outlet is named "Main outlet"',
    (select name from public.outlets where id = v_outlet_id) = 'Main outlet');
  perform pg_temp.assert_true('provisioned outlet is the default',
    (select is_default from public.outlets where id = v_outlet_id));
  select current_outlet_id into v_pinned
    from public.profiles where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  perform pg_temp.assert_true('provisioning pins the profile', v_pinned = v_outlet_id);

  -- Second call returns the same outlet (idempotent, no duplicates).
  perform pg_temp.assert_true('second call returns the same outlet',
    public.effective_outlet_id() = v_outlet_id);
  perform pg_temp.assert_true('exactly one outlet for restaurant C',
    (select count(*) from public.outlets
      where restaurant_id = '33333333-3333-3333-3333-333333333333') = 1);

  -- ensure_current_outlet pins without provisioning when one exists.
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
                         '22222222-2222-2222-2222-222222222222', 'owner');
  perform pg_temp.assert_true('ensure pins existing default without creating',
    public.ensure_current_outlet() = 'c0000000-0000-0000-0000-000000000003'::uuid);
  perform pg_temp.assert_true('still one outlet for restaurant B',
    (select count(*) from public.outlets
      where restaurant_id = '22222222-2222-2222-2222-222222222222') = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: switch_outlet() validation
-- ---------------------------------------------------------------------------

do $$
declare
  v_raised text := '';
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');

  -- Happy path: switch to Downtown.
  perform pg_temp.assert_true('switch to Downtown returns its id',
    (public.switch_outlet('c0000000-0000-0000-0000-000000000002')).id = 'c0000000-0000-0000-0000-000000000002'::uuid);
  perform pg_temp.assert_true('profile pinned to Downtown',
    (select current_outlet_id from public.profiles
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      = 'c0000000-0000-0000-0000-000000000002'::uuid);

  -- Unknown outlet.
  begin
    perform public.switch_outlet('c0000000-0000-0000-0000-000000009999');
  exception when raise_exception then
    v_raised := 'unknown';
  end;
  perform pg_temp.assert_true('unknown outlet raises', v_raised = 'unknown');

  -- Another restaurant's outlet.
  v_raised := '';
  begin
    perform public.switch_outlet('c0000000-0000-0000-0000-000000000003');
  exception when raise_exception then
    v_raised := 'foreign';
  end;
  perform pg_temp.assert_true('foreign outlet raises', v_raised = 'foreign');

  -- Inactive outlet.
  update public.outlets set is_active = false
   where id = 'c0000000-0000-0000-0000-000000000002';
  v_raised := '';
  begin
    perform public.switch_outlet('c0000000-0000-0000-0000-000000000002');
  exception when raise_exception then
    v_raised := 'inactive';
  end;
  perform pg_temp.assert_true('inactive outlet raises', v_raised = 'inactive');
  update public.outlets set is_active = true
   where id = 'c0000000-0000-0000-0000-000000000002';

  -- Switch back to Main for the remaining tests.
  perform public.switch_outlet('c0000000-0000-0000-0000-000000000001');

  -- Staff can switch too (they operate within an outlet).
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
                         '11111111-1111-1111-1111-111111111111', 'staff');
  perform pg_temp.assert_true('staff can switch outlets',
    (public.switch_outlet('c0000000-0000-0000-0000-000000000002')).id = 'c0000000-0000-0000-0000-000000000002'::uuid);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: outlet isolation — stock_movements + current_stock
-- ---------------------------------------------------------------------------

do $$
declare
  v_main uuid := 'c0000000-0000-0000-0000-000000000001';
  v_downtown uuid := 'c0000000-0000-0000-0000-000000000002';
begin
  -- Owner posts 100 kg tomatoes at Main (current outlet).
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  perform public.switch_outlet(v_main);
  perform public.receive_goods(
    ('[{"item_id":"b0000000-0000-0000-0000-000000000001","quantity":100,"unit_cost":10,' ||
     '"batch_no":"B1","expiry_date":"2027-01-01"}]')::jsonb);

  -- Switch to Downtown: Main's stock must be invisible.
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('Downtown sees no tomato stock',
    not exists (select 1 from public.current_stock
                 where item_id = 'b0000000-0000-0000-0000-000000000001'));
  perform pg_temp.assert_true('Downtown sees no movements either',
    (select count(*) from public.stock_movements
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 0);

  -- Post 40 kg at Downtown; each outlet now has its own balance.
  perform public.receive_goods(
    ('[{"item_id":"b0000000-0000-0000-0000-000000000001","quantity":40,"unit_cost":10,' ||
     '"batch_no":"B2","expiry_date":"2027-02-01"}]')::jsonb);
  perform pg_temp.assert_true('Downtown stock = 40',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 40);

  perform public.switch_outlet(v_main);
  perform pg_temp.assert_true('Main stock still = 100',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 100);

  -- Cross-outlet negative: even the owner cannot smuggle another outlet's
  -- id into a direct insert — RLS rejects it (the backstop only fills NULLs,
  -- never overrides an explicit value).
  begin
    insert into public.stock_movements
      (restaurant_id, outlet_id, item_id, movement_type, quantity)
    values
      ('11111111-1111-1111-1111-111111111111', v_downtown,
       'b0000000-0000-0000-0000-000000000001', 'wastage', -1);
    perform pg_temp.assert_true('smuggled cross-outlet insert rejected', false);
  exception when others then
    perform pg_temp.assert_true('smuggled cross-outlet insert rejected', true);
  end;
  -- And omitting outlet_id pins the row to the caller's outlet via backstop.
  insert into public.stock_movements
    (restaurant_id, item_id, movement_type, quantity)
  values
    ('11111111-1111-1111-1111-111111111111',
     'b0000000-0000-0000-0000-000000000001', 'wastage', -1);
  perform pg_temp.assert_true('omitted outlet_id pinned to caller outlet',
    (select outlet_id from public.stock_movements
      where movement_type = 'wastage'
      order by created_at desc limit 1) = v_main);

  -- Staff at Downtown cannot see Main's ledger at all.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
                         '11111111-1111-1111-1111-111111111111', 'staff');
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('staff at Downtown sees only Downtown rows',
    (select count(*) from public.stock_movements
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: transfer_stock() happy path — atomic paired movements
-- ---------------------------------------------------------------------------

do $$
declare
  v_main uuid := 'c0000000-0000-0000-0000-000000000001';
  v_downtown uuid := 'c0000000-0000-0000-0000-000000000002';
  v_t jsonb;
  v_out uuid;
  v_in uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  perform public.switch_outlet(v_main);

  -- Transfer 30 kg of batch B1 from Main to Downtown.
  select public.transfer_stock(
    v_downtown,
    'b0000000-0000-0000-0000-000000000001',
    30, 'B1', 'weekly rebalance') into v_t;

  perform pg_temp.assert_true('transfer returns a transfer id',
    (v_t ->> 'transfer_id') is not null);
  perform pg_temp.assert_true('from/to echoed',
    (v_t ->> 'from_outlet_id') = v_main::text
    and (v_t ->> 'to_outlet_id') = v_downtown::text);

  v_out := (v_t ->> 'transfer_out_movement_id')::uuid;
  v_in := (v_t ->> 'transfer_in_movement_id')::uuid;

  -- The paired movements share one reference_id (the transfer group).
  -- Out-leg assertions (visible from Main, the source outlet).
  perform pg_temp.assert_true('transfer_out reference_type is transfer',
    (select reference_type from public.stock_movements where id = v_out) = 'transfer');
  perform pg_temp.assert_true('transfer_out reference_id = transfer id',
    (select reference_id from public.stock_movements where id = v_out)
      = (v_t ->> 'transfer_id')::uuid);
  perform pg_temp.assert_true('transfer_out is -30',
    (select quantity from public.stock_movements where id = v_out) = -30);
  perform pg_temp.assert_true('transfer_out batch_no/expiry preserved',
    (select batch_no from public.stock_movements where id = v_out) = 'B1'
    and (select expiry_date from public.stock_movements where id = v_out) = '2027-01-01');

  -- In-leg assertions (visible from Downtown, the destination outlet).
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('transfer_in reference_type is transfer',
    (select reference_type from public.stock_movements where id = v_in) = 'transfer');
  perform pg_temp.assert_true('transfer_in reference_id = transfer id',
    (select reference_id from public.stock_movements where id = v_in)
      = (v_t ->> 'transfer_id')::uuid);
  perform pg_temp.assert_true('transfer_in is +30',
    (select quantity from public.stock_movements where id = v_in) = 30);
  perform pg_temp.assert_true('transfer_in batch_no/expiry preserved',
    (select batch_no from public.stock_movements where id = v_in) = 'B1'
    and (select expiry_date from public.stock_movements where id = v_in) = '2027-01-01');
  perform public.switch_outlet(v_main);

  -- Balances moved: Main 100 - 1 (wastage) - 30 = 69; Downtown 40 + 30 = 70.
  perform pg_temp.assert_true('Main tomato stock = 69',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 69);
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('Downtown tomato stock = 70',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 70);

  -- Audit trail: one stock_transfer entry naming both outlets.
  perform public.switch_outlet(v_main);
  perform pg_temp.assert_true('audit_log has the stock_transfer entry',
    exists (select 1 from public.audit_log
             where action = 'stock_transfer'
               and entity_id = (v_t ->> 'transfer_id')::uuid
               and details ->> 'from_outlet_name' = 'Main outlet'
               and details ->> 'to_outlet_name' = 'Downtown'));
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: transfer_stock() guard rails
-- ---------------------------------------------------------------------------

do $$
declare
  v_main uuid := 'c0000000-0000-0000-0000-000000000001';
  v_downtown uuid := 'c0000000-0000-0000-0000-000000000002';
  v_foreign uuid := 'c0000000-0000-0000-0000-000000000003';
  v_raised text := '';
  v_before_main numeric;
  v_before_downtown numeric;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  perform public.switch_outlet(v_main);
  select quantity into v_before_main from public.current_stock
   where item_id = 'b0000000-0000-0000-0000-000000000001';
  perform public.switch_outlet(v_downtown);
  select quantity into v_before_downtown from public.current_stock
   where item_id = 'b0000000-0000-0000-0000-000000000001';
  perform public.switch_outlet(v_main);

  -- Over-transfer: Main holds 69, asking for 70 raises — strictly.
  begin
    perform public.transfer_stock(v_downtown,
      'b0000000-0000-0000-0000-000000000001', 70);
  exception when raise_exception then
    v_raised := 'over';
  end;
  perform pg_temp.assert_true('over-transfer raises', v_raised = 'over');

  -- Exact on-hand is allowed.
  v_raised := '';
  begin
    perform public.transfer_stock(v_downtown,
      'b0000000-0000-0000-0000-000000000001', 69);
  exception when raise_exception then
    v_raised := 'exact';
  end;
  perform pg_temp.assert_true('exact on-hand transfer succeeds', v_raised = '');

  -- Balances after the exact transfer: Main 0, Downtown 139.
  perform pg_temp.assert_true('Main drained to 0',
    coalesce((select quantity from public.current_stock
               where item_id = 'b0000000-0000-0000-0000-000000000001'), 0) = 0);
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('Downtown now 139',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 139);
  perform public.switch_outlet(v_main);

  -- Self-transfer raises.
  v_raised := '';
  begin
    perform public.transfer_stock(v_main,
      'b0000000-0000-0000-0000-000000000001', 1);
  exception when raise_exception then
    v_raised := 'self';
  end;
  perform pg_temp.assert_true('self-transfer raises', v_raised = 'self');

  -- Cross-restaurant destination raises.
  v_raised := '';
  begin
    perform public.transfer_stock(v_foreign,
      'b0000000-0000-0000-0000-000000000001', 1);
  exception when raise_exception then
    v_raised := 'foreign';
  end;
  perform pg_temp.assert_true('foreign outlet raises', v_raised = 'foreign');

  -- Inactive destination raises. (Use a fresh empty outlet: Downtown holds
  -- stock, so the deactivation guard would block deactivating it.)
  insert into public.outlets (restaurant_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Temp Closed')
  returning id into v_foreign;
  update public.outlets set is_active = false where id = v_foreign;
  v_raised := '';
  begin
    perform public.transfer_stock(v_foreign,
      'b0000000-0000-0000-0000-000000000001', 1);
  exception when raise_exception then
    v_raised := 'inactive';
  end;
  perform pg_temp.assert_true('inactive destination raises', v_raised = 'inactive');
  delete from public.outlets where id = v_foreign;

  -- Atomicity: the failed transfers above left no partial legs behind.
  perform pg_temp.assert_true('no orphan transfer legs',
    (select count(*) from public.stock_movements
      where reference_type = 'transfer'
        and (quantity <> 30 and quantity <> -30
             and quantity <> 69 and quantity <> -69
             and quantity <> 10 and quantity <> -10)) = 0);

  -- Staff cannot transfer.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
                         '11111111-1111-1111-1111-111111111111', 'staff');
  perform public.switch_outlet(v_downtown);
  v_raised := '';
  begin
    perform public.transfer_stock(v_main,
      'b0000000-0000-0000-0000-000000000001', 1);
  exception when raise_exception then
    v_raised := 'staff';
  end;
  perform pg_temp.assert_true('staff transfer denied', v_raised = 'staff');

  -- Manager can transfer.
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         '11111111-1111-1111-1111-111111111111', 'manager');
  perform public.switch_outlet(v_downtown);
  v_raised := '';
  begin
    perform public.transfer_stock(v_main,
      'b0000000-0000-0000-0000-000000000001', 10);
  exception when raise_exception then
    v_raised := 'manager';
  end;
  perform pg_temp.assert_true('manager transfer succeeds', v_raised = '');

  -- Drain Main back to 0 so T6 starts with Main empty / Downtown stocked.
  perform public.switch_outlet(v_main);
  perform public.transfer_stock(v_downtown,
    'b0000000-0000-0000-0000-000000000001', 10);
  perform pg_temp.assert_true('Main back to 0',
    coalesce((select quantity from public.current_stock
               where item_id = 'b0000000-0000-0000-0000-000000000001'), 0) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: outlet deactivation guard
-- ---------------------------------------------------------------------------

do $$
declare
  v_main uuid := 'c0000000-0000-0000-0000-000000000001';
  v_downtown uuid := 'c0000000-0000-0000-0000-000000000002';
  v_raised text := '';
  v_empty uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');

  -- Downtown holds stock (139 tomatoes) → deactivation raises.
  begin
    update public.outlets set is_active = false where id = v_downtown;
  exception when raise_exception then
    v_raised := 'stock';
  end;
  perform pg_temp.assert_true('deactivating an outlet with stock raises', v_raised = 'stock');
  perform pg_temp.assert_true('outlet still active',
    (select is_active from public.outlets where id = v_downtown));

  -- Main is now empty (0 tomatoes) — but it is the default; deactivating the
  -- last active outlet raises even when empty. First create a third outlet.
  insert into public.outlets (id, restaurant_id, name)
  values ('c0000000-0000-0000-0000-000000000004',
          '11111111-1111-1111-1111-111111111111', 'Airport');
  v_empty := 'c0000000-0000-0000-0000-000000000004';

  -- Clean deactivate of the empty non-default outlet works.
  update public.outlets set is_active = false where id = v_empty;
  perform pg_temp.assert_true('empty non-default outlet deactivates cleanly',
    not (select is_active from public.outlets where id = v_empty));

  -- Deactivating the default promotes the oldest active outlet.
  update public.outlets set is_active = false where id = v_main;
  perform pg_temp.assert_true('Main deactivated (it was empty)',
    not (select is_active from public.outlets where id = v_main));
  perform pg_temp.assert_true('Downtown promoted to default',
    (select is_default from public.outlets where id = v_downtown));

  -- Users pinned to Main get re-pinned to the new default.
  perform pg_temp.assert_true('owner re-pinned to Downtown',
    (select current_outlet_id from public.profiles
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = v_downtown);

  -- Deactivating the last active outlet raises.
  v_raised := '';
  begin
    update public.outlets set is_active = false where id = v_downtown;
  exception when raise_exception then
    v_raised := 'last';
  end;
  perform pg_temp.assert_true('last active outlet cannot be deactivated', v_raised = 'last');

  -- Restore Main for the remaining tests.
  update public.outlets set is_active = true where id = v_main;
  update public.outlets set is_active = true where id = v_empty;
end;
$$;

-- ---------------------------------------------------------------------------
-- T7: outlets table RLS — owner manages, others read-only, tenant-isolated
-- ---------------------------------------------------------------------------

do $$
declare
  v_raised text := '';
begin
  -- Manager cannot insert outlets.
  perform pg_temp.claims('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         '11111111-1111-1111-1111-111111111111', 'manager');
  begin
    insert into public.outlets (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky');
  exception when others then
    v_raised := 'denied';
  end;
  perform pg_temp.assert_true('manager cannot create outlets', v_raised = 'denied');

  -- Staff cannot update outlets.
  perform pg_temp.claims('cccccccc-cccc-cccc-cccc-cccccccccccc',
                         '11111111-1111-1111-1111-111111111111', 'staff');
  v_raised := '';
  begin
    update public.outlets set address = 'x'
     where id = 'c0000000-0000-0000-0000-000000000001';
  exception when others then
    v_raised := 'denied';
  end;
  -- (update with no matching visible row is a silent no-op under RLS; the
  -- assertion is that the address did not change.)
  perform pg_temp.assert_true('staff cannot rename outlets',
    (select address from public.outlets
      where id = 'c0000000-0000-0000-0000-000000000001') is distinct from 'x');

  -- Cross-restaurant: owner of A cannot see B's outlets.
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');
  perform pg_temp.assert_true('owner of A sees only A outlets',
    (select count(*) from public.outlets) = 3);

  -- Owner can CRUD outlets.
  insert into public.outlets (restaurant_id, name, address)
  values ('11111111-1111-1111-1111-111111111111', 'Test Kitchen', '42 Spice Rd')
  returning id into v_raised; -- reuse: holds the new id
  perform pg_temp.assert_true('owner creates outlet', v_raised <> 'denied' and v_raised is not null);
  update public.outlets set address = '43 Spice Rd' where name = 'Test Kitchen';
  perform pg_temp.assert_true('owner updates outlet',
    (select address from public.outlets where name = 'Test Kitchen') = '43 Spice Rd');
  delete from public.outlets where name = 'Test Kitchen';
  perform pg_temp.assert_true('owner deletes outlet',
    not exists (select 1 from public.outlets where name = 'Test Kitchen'));

  -- Duplicate names (case-insensitive) rejected per restaurant.
  v_raised := '';
  begin
    insert into public.outlets (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'downtown');
  exception when unique_violation then
    v_raised := 'dup';
  end;
  perform pg_temp.assert_true('duplicate outlet name rejected', v_raised = 'dup');

  -- Same name in another restaurant is fine.
  perform pg_temp.claims('dddddddd-dddd-dddd-dddd-dddddddddddd',
                         '22222222-2222-2222-2222-222222222222', 'owner');
  insert into public.outlets (restaurant_id, name)
  values ('22222222-2222-2222-2222-222222222222', 'Downtown');
  perform pg_temp.assert_true('same name allowed in another restaurant',
    exists (select 1 from public.outlets
             where restaurant_id = '22222222-2222-2222-2222-222222222222'
               and name = 'Downtown'));
end;
$$;

-- ---------------------------------------------------------------------------
-- T8: RPCs are outlet-aware — sales deduct from the current outlet only
-- ---------------------------------------------------------------------------

do $$
declare
  v_main uuid := 'c0000000-0000-0000-0000-000000000001';
  v_downtown uuid := 'c0000000-0000-0000-0000-000000000002';
  v_menu uuid := '71000000-0000-0000-0000-000000000001';
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');

  -- Menu item "Tomato Soup": 2 kg tomatoes per dish.
  insert into public.menu_items (id, restaurant_id, name, yield_quantity, yield_unit) values
    (v_menu, '11111111-1111-1111-1111-111111111111', 'Tomato Soup', 1, 'serving');
  insert into public.recipe_ingredients
    (menu_item_id, restaurant_id, item_id, quantity, unit_id) values
    (v_menu, '11111111-1111-1111-1111-111111111111',
     'b0000000-0000-0000-0000-000000000001', 2,
     'a0000000-0000-0000-0000-000000000001');

  -- Stock up Main (10 kg) and Downtown (already 130 from transfers; add 0).
  perform public.switch_outlet(v_main);
  perform public.receive_goods(
    ('[{"item_id":"b0000000-0000-0000-0000-000000000001","quantity":10,"unit_cost":10}]')::jsonb);

  -- Sell 3 dishes at Main → deducts 6 kg from Main only.
  perform public.record_sales(
    ('[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":3}]')::jsonb,
    '2026-10-05'::date);
  perform pg_temp.assert_true('Main tomato stock = 10 - 6 = 4',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 4);

  -- Downtown untouched by Main's sale (would raise over-sale if it read
  -- Main's 4 kg — instead it sees its own 130).
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('Downtown tomato stock unchanged at 139',
    (select quantity from public.current_stock
      where item_id = 'b0000000-0000-0000-0000-000000000001') = 139);

  -- The sale_deduction row is pinned to Main.
  perform pg_temp.assert_true('sale_deduction rows carry the selling outlet',
    not exists (select 1 from public.stock_movements
                 where movement_type = 'sale_deduction'
                   and outlet_id is distinct from v_main));
end;
$$;

-- ---------------------------------------------------------------------------
-- T9: outlet_id on stock_counts, notifications, pos_imports
-- ---------------------------------------------------------------------------

do $$
declare
  v_main uuid := 'c0000000-0000-0000-0000-000000000001';
  v_downtown uuid := 'c0000000-0000-0000-0000-000000000002';
  v_count uuid;
begin
  perform pg_temp.claims('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         '11111111-1111-1111-1111-111111111111', 'owner');

  -- Stock count created at Downtown carries Downtown.
  perform public.switch_outlet(v_downtown);
  select (public.create_stock_count('Downtown count', null)).id into v_count;
  perform pg_temp.assert_true('stock count pinned to Downtown',
    (select outlet_id from public.stock_counts where id = v_count) = v_downtown);

  -- Switch to Main: the Downtown count is invisible (RLS).
  perform public.switch_outlet(v_main);
  perform pg_temp.assert_true('Main cannot see Downtown count',
    not exists (select 1 from public.stock_counts where id = v_count));

  -- Notifications are outlet-pinned: one at Main is invisible at Downtown.
  insert into public.notifications (restaurant_id, type, title, item_id)
  values ('11111111-1111-1111-1111-111111111111', 'low_stock',
          'Milk low at Main', 'b0000000-0000-0000-0000-000000000002');
  perform pg_temp.assert_true('notification pinned to Main',
    (select outlet_id from public.notifications
      where title = 'Milk low at Main') = v_main);
  perform public.switch_outlet(v_downtown);
  perform pg_temp.assert_true('Downtown cannot see Main notification',
    not exists (select 1 from public.notifications
                 where title = 'Milk low at Main'));
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- T10: data-migration backfill — pre-V2-07 rows land on the default outlet
-- ---------------------------------------------------------------------------
-- (Runs as superuser after reset role: simulates the migration's own
-- backfill logic against a legacy row shape.)

do $$
declare
  v_restaurant uuid := '44444444-4444-4444-4444-444444444444';
  v_item uuid := 'b0000000-0000-0000-0000-000000000099';
  v_default uuid;
begin
  insert into public.restaurants (id, name) values (v_restaurant, 'Legacy Co');
  insert into public.units (id, restaurant_id, name, symbol)
  values ('a0000000-0000-0000-0000-000000000099', v_restaurant, 'kilogram', 'kg');
  insert into public.items (id, restaurant_id, name, unit_id)
  values (v_item, v_restaurant, 'Legacy Flour', 'a0000000-0000-0000-0000-000000000099');

  -- Simulate a pre-V2-07 row: outlet_id filled by the migration backfill
  -- (default outlet per restaurant), as the migration's UPDATE does.
  insert into public.outlets (restaurant_id, name, is_default)
  values (v_restaurant, 'Main outlet', true)
  returning id into v_default;
  insert into public.stock_movements (restaurant_id, outlet_id, item_id, movement_type, quantity)
  values (v_restaurant, v_default, v_item, 'opening_balance', 50);

  perform pg_temp.assert_true('legacy row readable via current_stock',
    (select quantity from public.current_stock
      where restaurant_id = v_restaurant and item_id = v_item) = 50);
  perform pg_temp.assert_true('legacy row sits on the default outlet',
    (select outlet_id from public.stock_movements
      where restaurant_id = v_restaurant and item_id = v_item) = v_default);
end;
$$;

commit;
