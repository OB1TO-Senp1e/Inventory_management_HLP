-- ============================================================================
-- P2-03 DB tests — log_wastage / log_usage RPCs + reason_code constraint.
--
-- Single rolled-back transaction. Fixtures are inserted as superuser
-- (bypasses RLS by design); everything else runs as `authenticated` with
-- JWT claims driving tenant/role — the client path.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'Restaurant A'),
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'Restaurant B');

insert into auth.users (id) values
  ('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'), -- owner of A
  ('e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3'), -- manager of A
  ('e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4'), -- staff of A
  ('e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5'), -- owner of B
  ('e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6'); -- role-less user

insert into public.profiles (id, restaurant_id, role) values
  ('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'owner'),
  ('e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'manager'),
  ('e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'staff'),
  ('e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'owner'),
  ('e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'staff');

insert into public.units (id, restaurant_id, name, symbol) values
  ('e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'kilogram', 'kg'),
  ('e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point, active) values
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'Rice',  'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', 50, 10, true),
  ('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'Sugar', 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', 20, 5,  true),
  ('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'OldOil','e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7', 5,  1,  false),
  ('f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'Flour', 'e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8', 30, 8,  true);

-- Seed stock: 20 kg Rice, 10 kg Sugar (receipts posted as superuser).
insert into public.stock_movements
  (restaurant_id, item_id, movement_type, quantity, created_by)
values
  ('e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'receipt', 20, 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'),
  ('e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'receipt', 10, 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2');

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

-- Switch to the client path: RLS enforced, JWT claims drive tenant/role.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: staff logs wastage — movement posted, negative qty, reason code
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_row public.stock_movements%rowtype;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  v_id := public.log_wastage(
    'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 5, 'spoiled', 'smells off');
  perform pg_temp.assert_true('T1: returns a movement id', v_id is not null);

  select * into v_row from public.stock_movements where id = v_id;
  perform pg_temp.assert_true('T1: movement_type is wastage', v_row.movement_type = 'wastage');
  perform pg_temp.assert_true('T1: quantity is negative', v_row.quantity = -5);
  perform pg_temp.assert_true('T1: reason_code stored', v_row.reason_code = 'spoiled');
  perform pg_temp.assert_true('T1: notes stored', v_row.notes = 'smells off');
  perform pg_temp.assert_true('T1: pinned to caller restaurant',
    v_row.restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0');
  perform pg_temp.assert_true('T1: created_by is the staff user',
    v_row.created_by = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4');
end $$;

-- ---------------------------------------------------------------------------
-- T2: staff logs usage — movement posted, negative qty
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v_row public.stock_movements%rowtype;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  v_id := public.log_usage(
    'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 3, 'kitchen_use', null);
  perform pg_temp.assert_true('T2: returns a movement id', v_id is not null);

  select * into v_row from public.stock_movements where id = v_id;
  perform pg_temp.assert_true('T2: movement_type is usage', v_row.movement_type = 'usage');
  perform pg_temp.assert_true('T2: quantity is negative', v_row.quantity = -3);
  perform pg_temp.assert_true('T2: reason_code stored', v_row.reason_code = 'kitchen_use');
  perform pg_temp.assert_true('T2: null notes stay null', v_row.notes is null);
end $$;

-- ---------------------------------------------------------------------------
-- T3: current_stock decreases by the logged amounts
-- ---------------------------------------------------------------------------

do $$
declare
  v_qty numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  select quantity into v_qty from public.current_stock
   where item_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
  perform pg_temp.assert_true('T3: Rice stock is 20 - 5 = 15', v_qty = 15);

  select quantity into v_qty from public.current_stock
   where item_id = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
  perform pg_temp.assert_true('T3: Sugar stock is 10 - 3 = 7', v_qty = 7);
end $$;

-- ---------------------------------------------------------------------------
-- T4: invalid quantities rejected (zero, negative, null)
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  begin
    perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 0, 'spoiled', null);
    perform pg_temp.assert_true('T4: zero wastage qty raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T4: zero qty error is friendly',
      v_msg like '%quantity must be greater than zero%');
  end;

  begin
    perform public.log_usage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', -2, 'kitchen_use', null);
    perform pg_temp.assert_true('T4: negative usage qty raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T4: negative qty error is friendly',
      v_msg like '%quantity must be greater than zero%');
  end;

  begin
    perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', null, 'spoiled', null);
    perform pg_temp.assert_true('T4: null qty raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('T4: null qty raises (any message)', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T5: reason is required; unknown codes rejected (per-type sets)
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  begin
    perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 1, null, null);
    perform pg_temp.assert_true('T5: null reason raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T5: null reason error is friendly',
      v_msg like '%a reason is required%');
  end;

  begin
    perform public.log_usage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 1, '   ', null);
    perform pg_temp.assert_true('T5: blank reason raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T5: blank reason error is friendly',
      v_msg like '%a reason is required%');
  end;

  begin
    perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 1, 'moldy', null);
    perform pg_temp.assert_true('T5: unknown wastage code raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T5: unknown code error is friendly',
      v_msg like '%unknown reason code%');
  end;

  begin
    -- A usage code is not valid for wastage (per-type closed sets).
    perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 1, 'kitchen_use', null);
    perform pg_temp.assert_true('T5: usage code in log_wastage raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T5: cross-type code error is friendly',
      v_msg like '%unknown reason code%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: cross-restaurant + archived items rejected
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  begin
    -- Flour belongs to restaurant B.
    perform public.log_wastage('f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', 1, 'damaged', null);
    perform pg_temp.assert_true('T6: cross-restaurant item raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T6: cross-restaurant error is friendly',
      v_msg like '%not found in your restaurant%');
  end;

  begin
    -- OldOil is archived.
    perform public.log_usage('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 1, 'kitchen_use', null);
    perform pg_temp.assert_true('T6: archived item raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T6: archived error is friendly',
      v_msg like '%is archived%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T7: role-less session rejected; manager/owner can log too
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":""}',
    true);
  begin
    perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 1, 'expired', null);
    perform pg_temp.assert_true('T7: role-less session raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T7: role error is friendly',
      v_msg like '%your role cannot log wastage%');
  end;

  -- Manager of A can log usage.
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);
  v_id := public.log_usage('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 1, 'tasting', null);
  perform pg_temp.assert_true('T7: manager may log usage', v_id is not null);

  -- Owner of A can log wastage.
  perform set_config('request.jwt.claims',
    '{"sub":"e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"owner"}',
    true);
  v_id := public.log_wastage('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 1, 'expired', null);
  perform pg_temp.assert_true('T7: owner may log wastage', v_id is not null);
end $$;

-- ---------------------------------------------------------------------------
-- T8: over-logging past zero stock is permitted (warn + allow policy)
-- ---------------------------------------------------------------------------

do $$
declare
  v_qty numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  -- Rice is at 15 after T1; logging 100 is allowed, stock goes negative.
  perform public.log_wastage('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 100, 'other_wastage', null);
  select quantity into v_qty from public.current_stock
   where item_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
  perform pg_temp.assert_true('T8: over-logging allowed, stock = 15 - 100 = -85', v_qty = -85);
end $$;

-- ---------------------------------------------------------------------------
-- T9: the reason_code CHECK guards direct writes too
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"owner"}',
    true);

  begin
    insert into public.stock_movements
      (restaurant_id, item_id, movement_type, quantity, reason_code, created_by)
    values
      ('e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
       'wastage', -1, 'bogus_code', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2');
    perform pg_temp.assert_true('T9: bad reason_code insert raises', false);
  exception when check_violation then
    perform pg_temp.assert_true('T9: bad reason_code insert raises (check_violation)', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T10: append-only still holds for wastage/usage movements
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"owner"}',
    true);

  begin
    update public.stock_movements set notes = 'tampered'
     where movement_type = 'wastage';
    perform pg_temp.assert_true('T10: wastage UPDATE denied', false);
  exception when insufficient_privilege then
    raise notice 'ok: T10: wastage UPDATE denied at ACL';
  end;

  begin
    delete from public.stock_movements where movement_type = 'usage';
    perform pg_temp.assert_true('T10: usage DELETE denied', false);
  exception when insufficient_privilege then
    raise notice 'ok: T10: usage DELETE denied at ACL';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup: nothing to clean (single transaction rolls back)
-- ---------------------------------------------------------------------------

rollback;
