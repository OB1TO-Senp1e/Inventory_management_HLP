-- ============================================================================
-- P3-01 RLS/RPC tests: purchase_orders + purchase_order_lines.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P3-01 migration: owner/manager CRUD on both tables in their
-- own restaurant, staff denied entirely (no policies — every staff query
-- is refused), cross-restaurant isolation, the create_purchase_order()
-- RPC (atomic header+lines insert, supplier/item validation, archived
-- rejection, empty-lines rejection), the draft-only guards (PO edits and
-- line changes rejected once status <> 'draft'), received_quantity <=
-- quantity, and unique (po_id, item_id).
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

insert into public.units (id, restaurant_id, name, symbol) values
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('60000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Onions', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('62000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Milk', '60000000-0000-0000-0000-000000000002', 10, 5);

insert into public.suppliers (id, restaurant_id, name, active) values
  ('63000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Fresh Farms', true),
  ('63000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Old Veggie', false),
  ('64000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dairy Direct', true);

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
-- T1: manager of A — create_purchase_order RPC (happy path)
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_line_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001',
    current_date,
    current_date + 7,
    'Weekly order',
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5},
      {"item_id":"61000000-0000-0000-0000-000000000002","quantity":5,"unit_price":28}]'::jsonb
  ) into v_po_id;

  perform pg_temp.assert_true('RPC returns a PO id', v_po_id is not null);
  perform pg_temp.assert_true('PO status is draft',
    (select status from public.purchase_orders where id = v_po_id) = 'draft');
  perform pg_temp.assert_true('PO pinned to caller restaurant',
    (select restaurant_id from public.purchase_orders where id = v_po_id)
      = '11111111-1111-1111-1111-111111111111');
  select count(*) into v_line_count
  from public.purchase_order_lines where po_id = v_po_id;
  perform pg_temp.assert_true('two lines inserted atomically', v_line_count = 2);
  perform pg_temp.assert_true('line price snapshot stored',
    (select unit_price from public.purchase_order_lines
     where po_id = v_po_id and item_id = '61000000-0000-0000-0000-000000000001') = 32.5);
  perform pg_temp.assert_true('received_quantity defaults to 0',
    (select sum(received_quantity) from public.purchase_order_lines where po_id = v_po_id) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: RPC validation — archived supplier, unknown item, empty lines, bad qty
-- ---------------------------------------------------------------------------

do $$
declare
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Archived supplier rejected.
  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000002', current_date, null, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":10}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('archived supplier rejected', v_failed);

  -- Cross-restaurant supplier rejected.
  begin
    perform public.create_purchase_order(
      '64000000-0000-0000-0000-000000000001', current_date, null, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":10}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('other-restaurant supplier rejected', v_failed);

  -- Cross-restaurant item rejected.
  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001', current_date, null, null,
      '[{"item_id":"62000000-0000-0000-0000-000000000001","quantity":1,"unit_price":10}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('other-restaurant item rejected', v_failed);

  -- Empty lines rejected.
  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001', current_date, null, null, '[]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('empty lines rejected', v_failed);

  -- Zero quantity rejected.
  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001', current_date, null, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":0,"unit_price":10}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('zero quantity rejected', v_failed);

  -- Expected date before order date rejected.
  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001', current_date, current_date - 1, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":10}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('expected-before-order rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: staff of A — denied everywhere (no policies)
-- ---------------------------------------------------------------------------

do $$
declare
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  begin
    perform count(*) from public.purchase_orders;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  -- Note: SELECT with no matching policy returns 0 rows (not an error) in
  -- RLS; assert the denial by row count instead.
  perform pg_temp.assert_true('staff sees zero POs',
    (select count(*) from public.purchase_orders) = 0);
  perform pg_temp.assert_true('staff sees zero PO lines',
    (select count(*) from public.purchase_order_lines) = 0);

  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001', current_date, null, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":10}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('staff RPC call rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: owner of B — cross-restaurant isolation
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  perform pg_temp.assert_true('owner B sees zero POs from A',
    (select count(*) from public.purchase_orders) = 0);
  perform pg_temp.assert_true('owner B sees zero lines from A',
    (select count(*) from public.purchase_order_lines) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: draft-only guards — edits and line changes on non-draft POs rejected
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":4,"unit_price":30}]'::jsonb
  ) into v_po_id;

  -- Draft edits allowed.
  update public.purchase_orders set notes = 'updated while draft' where id = v_po_id;
  perform pg_temp.assert_true('draft PO header editable',
    (select notes from public.purchase_orders where id = v_po_id) = 'updated while draft');

  -- Move the PO out of draft via the real P3-02 send RPC.
  set role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  perform public.send_purchase_order(v_po_id);
  perform pg_temp.assert_true('PO sent via RPC',
    (select status from public.purchase_orders where id = v_po_id) = 'sent');

  -- Header edit on sent PO rejected.
  begin
    update public.purchase_orders set notes = 'sneaky edit' where id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('non-draft PO header edit rejected', v_failed);

  -- Line insert on sent PO rejected.
  begin
    insert into public.purchase_order_lines
      (restaurant_id, po_id, item_id, quantity, unit_price)
    values ('11111111-1111-1111-1111-111111111111', v_po_id,
            '61000000-0000-0000-0000-000000000002', 2, 28);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('line insert on sent PO rejected', v_failed);

  -- Line delete on sent PO rejected.
  begin
    delete from public.purchase_order_lines where po_id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('line delete on sent PO rejected', v_failed);

  -- received_quantity can never exceed quantity (even on a draft).
  -- Use a fresh draft PO: the sent PO above cannot return to draft
  -- (the status guard correctly rejects sent → draft).
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":4,"unit_price":30}]'::jsonb
  ) into v_po_id;
  begin
    update public.purchase_order_lines
    set received_quantity = 999 where po_id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('received_quantity > quantity rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: unique (po_id, item_id) — no duplicate lines
-- ---------------------------------------------------------------------------

do $$
declare
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001', current_date, null, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":10},
        {"item_id":"61000000-0000-0000-0000-000000000001","quantity":2,"unit_price":11}]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('duplicate item lines rejected', v_failed);
end;
$$;

reset role;
rollback;
