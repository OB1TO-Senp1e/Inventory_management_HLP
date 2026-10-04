-- ============================================================================
-- P2-02 DB tests: receive_goods RPC.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P2-02 migration (`receive_goods(jsonb)`):
--   * receipt posts positive-quantity `receipt` movements with batch,
--     expiry, unit cost, reference_type='ad_hoc', created_by;
--   * weighted average cost over successive receipts AND across two lines
--     for the same item in one receipt;
--   * atomic abort: one bad line rejects the whole receipt (no rows posted);
--   * validation: non-array envelope, empty array, zero/negative qty,
--     negative cost, malformed UUID/date, past expiry;
--   * tenant isolation: cross-restaurant item rejected;
--   * archived items rejected;
--   * roles: owner/manager/staff may receive; role-less session is rejected;
--   * append-only still holds: receipts cannot be updated or deleted;
--   * expiry is optional (no `is_perishable` column exists); when provided
--     it must be today or later.
-- ============================================================================

\set ON_ERROR_STOP on

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
-- T1: happy path — receipt posts ledger rows with batch/expiry/cost
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  v_result := public.receive_goods(jsonb_build_array(
    jsonb_build_object(
      'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
      'quantity', 10, 'unit_cost', 40,
      'batch_no', 'B-001', 'expiry_date', (current_date + 30)::text,
      'notes', 'first delivery'
    )
  ));

  perform pg_temp.assert_true('T1: returns one result line',
    jsonb_array_length(v_result) = 1);
  perform pg_temp.assert_true('T1: result carries movement_id and avg costs',
    (v_result->0 ? 'movement_id') and (v_result->0 ? 'new_avg_cost'));

  select count(*) into v_count from public.stock_movements
   where item_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1'
     and movement_type = 'receipt';
  perform pg_temp.assert_true('T1: one receipt movement posted', v_count = 1);

  perform pg_temp.assert_true('T1: quantity positive, batch/expiry/cost recorded',
    exists (
      select 1 from public.stock_movements
       where item_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1'
         and movement_type = 'receipt'
         and quantity = 10
         and batch_no = 'B-001'
         and expiry_date = current_date + 30
         and unit_cost = 40
         and reference_type = 'ad_hoc'
         and created_by = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3'::uuid
    ));

  perform pg_temp.assert_true('T1: avg_unit_cost seeded to line cost',
    (select avg_unit_cost from public.items
      where id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 40);

  perform pg_temp.assert_true('T1: current_stock sums the receipt',
    (select quantity from public.current_stock
      where item_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1'
        and restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0') = 10);
end $$;

-- ---------------------------------------------------------------------------
-- T2: weighted average over two successive receipts
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  -- Stock is 10 @ 40 from T1. Receive 10 @ 60 → avg = (400+600)/20 = 50.
  v_result := public.receive_goods(jsonb_build_array(
    jsonb_build_object(
      'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
      'quantity', 10, 'unit_cost', 60
    )
  ));

  perform pg_temp.assert_true('T2: result reports old/new avg cost',
    (v_result->0->>'old_avg_cost')::numeric = 40
    and (v_result->0->>'new_avg_cost')::numeric = 50);

  perform pg_temp.assert_true('T2: items.avg_unit_cost updated to 50',
    (select avg_unit_cost from public.items
      where id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 50);

  perform pg_temp.assert_true('T2: current_stock now 20',
    (select quantity from public.current_stock
      where item_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 20);
end $$;

-- ---------------------------------------------------------------------------
-- T3: two lines for the SAME item in one receipt share the running average
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"owner"}',
    true);

  -- Sugar has no stock yet: 10 @ 40 then 10 @ 60 → avg 50, stock 20.
  v_result := public.receive_goods(jsonb_build_array(
    jsonb_build_object(
      'item_id', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
      'quantity', 10, 'unit_cost', 40
    ),
    jsonb_build_object(
      'item_id', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
      'quantity', 10, 'unit_cost', 60
    )
  ));

  perform pg_temp.assert_true('T3: two result lines returned',
    jsonb_array_length(v_result) = 2);
  perform pg_temp.assert_true('T3: second line sees running avg (40 → 50)',
    (v_result->1->>'old_avg_cost')::numeric = 40
    and (v_result->1->>'new_avg_cost')::numeric = 50);
  perform pg_temp.assert_true('T3: items.avg_unit_cost is 50',
    (select avg_unit_cost from public.items
      where id = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2') = 50);
  perform pg_temp.assert_true('T3: current_stock is 20',
    (select quantity from public.current_stock
      where item_id = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2') = 20);
end $$;

-- ---------------------------------------------------------------------------
-- T4: atomic abort — one bad line rejects the whole receipt
-- ---------------------------------------------------------------------------

do $$
declare
  v_before int;
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  select count(*) into v_before from public.stock_movements
   where restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';

  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 5, 'unit_cost', 45
      ),
      jsonb_build_object(
        'item_id', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
        'quantity', 0, 'unit_cost', 45   -- invalid: zero quantity
      )
    ));
    perform pg_temp.assert_true('T4: zero-qty line raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T4: error names line 2',
      v_msg like '%receive_goods: line 2%');
  end;

  perform pg_temp.assert_true('T4: no partial movements posted',
    (select count(*) from public.stock_movements
      where restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0') = v_before);
end $$;

-- ---------------------------------------------------------------------------
-- T5: tenant isolation — cross-restaurant item rejected
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', -- belongs to Restaurant B
        'quantity', 5, 'unit_cost', 30
      )
    ));
    perform pg_temp.assert_true('T5: cross-restaurant item raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T5: error says item not found in restaurant',
      v_msg like '%not found in your restaurant%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: archived item rejected
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', -- archived
        'quantity', 5, 'unit_cost', 30
      )
    ));
    perform pg_temp.assert_true('T6: archived item raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T6: error says item is archived',
      v_msg like '%is archived%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T7: expiry validation
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  -- Past expiry is rejected.
  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 5, 'unit_cost', 45,
        'expiry_date', (current_date - 1)::text
      )
    ));
    perform pg_temp.assert_true('T7: past expiry raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T7: error says expiry is in the past',
      v_msg like '%in the past%');
  end;

  -- Malformed date is rejected.
  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 5, 'unit_cost', 45,
        'expiry_date', 'not-a-date'
      )
    ));
    perform pg_temp.assert_true('T7: malformed date raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T7: error says date must be valid',
      v_msg like '%must be a valid date%');
  end;

  -- Expiry is optional (no is_perishable column) and a future date works.
  perform pg_temp.assert_true('T7: null expiry accepted',
    jsonb_array_length(public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 5, 'unit_cost', 45
      )
    ))) = 1);
end $$;

-- ---------------------------------------------------------------------------
-- T8: envelope + per-field validation
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);

  begin
    perform public.receive_goods('{"not":"an-array"}'::jsonb);
    perform pg_temp.assert_true('T8: non-array envelope raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T8: envelope error is friendly',
      v_msg like '%must be a JSON array%');
  end;

  begin
    perform public.receive_goods('[]'::jsonb);
    perform pg_temp.assert_true('T8: empty array raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T8: empty receipt error is friendly',
      v_msg like '%at least one line%');
  end;

  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', -3, 'unit_cost', 45
      )
    ));
    perform pg_temp.assert_true('T8: negative qty raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T8: negative qty error is friendly',
      v_msg like '%greater than zero%');
  end;

  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 5, 'unit_cost', -1
      )
    ));
    perform pg_temp.assert_true('T8: negative cost raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T8: negative cost error is friendly',
      v_msg like '%cannot be negative%');
  end;

  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'not-a-uuid',
        'quantity', 5, 'unit_cost', 45
      )
    ));
    perform pg_temp.assert_true('T8: malformed UUID raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T8: UUID error is friendly',
      v_msg like '%not a valid UUID%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T9: roles — owner/manager/staff may receive; role-less session is rejected
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  -- Staff can receive (role matrix §7: receive is a staff capability).
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);
  perform pg_temp.assert_true('T9: staff may receive',
    jsonb_array_length(public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 2, 'unit_cost', 42
      )
    ))) = 1);

  -- A session without a role claim is rejected (tenant set, role empty).
  perform set_config('request.jwt.claims',
    '{"sub":"e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":""}',
    true);
  begin
    perform public.receive_goods(jsonb_build_array(
      jsonb_build_object(
        'item_id', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
        'quantity', 2, 'unit_cost', 42
      )
    ));
    perform pg_temp.assert_true('T9: role-less session raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T9: role error is friendly',
      v_msg like '%cannot receive stock%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T10: append-only still holds for receipts (ACL layer + trigger layer)
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"owner"}',
    true);

  -- ACL layer: authenticated has no UPDATE/DELETE grant on the ledger.
  begin
    update public.stock_movements set notes = 'tampered'
     where movement_type = 'receipt'
       and restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
    perform pg_temp.assert_true('T10: receipt UPDATE denied at ACL', false);
  exception when insufficient_privilege then
    raise notice 'ok: T10: receipt UPDATE denied at ACL';
  end;

  begin
    delete from public.stock_movements
     where movement_type = 'receipt'
       and restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
    perform pg_temp.assert_true('T10: receipt DELETE denied at ACL', false);
  exception when insufficient_privilege then
    raise notice 'ok: T10: receipt DELETE denied at ACL';
  end;
end $$;

-- Trigger layer: even the table owner (who passes the ACL) is rejected.
reset role;

do $$
declare
  v_msg text;
begin
  begin
    update public.stock_movements set notes = 'tampered'
     where movement_type = 'receipt'
       and restaurant_id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
    perform pg_temp.assert_true('T10: receipt UPDATE rejected by trigger', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T10: receipt UPDATE rejected by trigger',
      v_msg like '%append-only: UPDATE%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T11: list_receivable_items() — narrow picker RPC (id + name + unit
-- symbol only; no cost columns), tenant-isolated, role-checked
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
  v_names text[];
  v_symbols text[];
  v_msg text;
  v_argnames text[];
begin
  -- Staff of A: sees active own-restaurant items only (Rice, Sugar —
  -- name-ordered; OldOil is inactive, Flour belongs to restaurant B).
  perform set_config('request.jwt.claims',
    '{"sub":"e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"staff"}',
    true);

  select array_agg(t.item_name order by t.item_name), array_agg(t.unit_symbol order by t.item_name)
    into v_names, v_symbols
    from public.list_receivable_items() t;
  perform pg_temp.assert_true('T11: staff sees Rice + Sugar via RPC',
    v_names = array['Rice','Sugar']);
  perform pg_temp.assert_true('T11: unit symbols come through',
    v_symbols = array['kg','kg']);

  select count(*) into v_count from public.list_receivable_items();
  perform pg_temp.assert_true('T11: exactly 2 rows (inactive + cross-restaurant excluded)',
    v_count = 2);

  -- The RPC returns exactly three columns — avg_unit_cost cannot leak.
  select proargnames into v_argnames from pg_proc
   where proname = 'list_receivable_items' and pg_function_is_visible(oid);
  perform pg_temp.assert_true('T11: output columns are exactly id/name/symbol',
    v_argnames = array['item_id','item_name','unit_symbol']);

  -- Manager of A: same visibility.
  perform set_config('request.jwt.claims',
    '{"sub":"e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":"manager"}',
    true);
  select count(*) into v_count from public.list_receivable_items();
  perform pg_temp.assert_true('T11: manager sees the same 2 rows', v_count = 2);

  -- Role-less session is rejected with a friendly error.
  perform set_config('request.jwt.claims',
    '{"sub":"e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6","restaurant_id":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","role":""}',
    true);
  begin
    perform public.list_receivable_items();
    perform pg_temp.assert_true('T11: role-less session raises', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('T11: role error is friendly',
      v_msg like '%Only signed-in restaurant users%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup: nothing to clean (single transaction rolls back)
-- ---------------------------------------------------------------------------

rollback;
