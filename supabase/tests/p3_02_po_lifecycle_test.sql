-- ============================================================================
-- P3-02 RLS/RPC tests: PO lifecycle (send / cancel / receive).
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P3-02 migration: the status-transition state machine
-- (draft → sent/cancelled; sent → partially_received/received/cancelled;
-- partially_received → received; received/cancelled terminal), the
-- relaxed line guard (received_quantity-only changes on sent/receivable
-- POs, monotonic, <= quantity), send/cancel/receive_purchase_order RPCs
-- (role + tenant enforcement, PO locking, over-receive rejection,
-- ledger postings tagged purchase_order/<po_id> with the PO's price
-- snapshot as unit cost), and receive_goods backward compatibility
-- (single-arg callers still work, reference defaults to ad_hoc).
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
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Onions', '60000000-0000-0000-0000-000000000001', 10, 5);

insert into public.suppliers (id, restaurant_id, name, active) values
  ('63000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Fresh Farms', true);

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
-- T1: send happy path — draft → sent
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_po_id;

  perform public.send_purchase_order(v_po_id);
  perform pg_temp.assert_true('draft → sent',
    (select status from public.purchase_orders where id = v_po_id) = 'sent');
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: send validation — non-draft, empty lines, unknown PO
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_empty_po uuid;
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_po_id;
  perform public.send_purchase_order(v_po_id);

  -- Already sent → rejected.
  begin
    perform public.send_purchase_order(v_po_id);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('send twice rejected', v_failed);

  -- Unknown PO → rejected.
  begin
    perform public.send_purchase_order('00000000-0000-0000-0000-000000000000');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('send unknown PO rejected', v_failed);

  -- PO with no lines → rejected (inserted directly as superuser would
  -- bypass RLS; here the RPC path is tested via a draft stripped of lines).
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_empty_po;
  delete from public.purchase_order_lines where po_id = v_empty_po;
  begin
    perform public.send_purchase_order(v_empty_po);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('send PO with no lines rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: illegal status transitions rejected by the trigger (direct UPDATE)
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
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_po_id;

  -- draft → received (skipping sent) rejected.
  begin
    update public.purchase_orders set status = 'received' where id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('draft → received rejected', v_failed);

  perform public.send_purchase_order(v_po_id);

  -- sent → draft (backwards) rejected.
  begin
    update public.purchase_orders set status = 'draft' where id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('sent → draft rejected', v_failed);

  -- Editing business columns on a sent PO rejected.
  begin
    update public.purchase_orders set notes = 'sneaky edit' where id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('sent PO header edit rejected', v_failed);

  perform public.cancel_purchase_order(v_po_id);

  -- cancelled is terminal.
  begin
    update public.purchase_orders set status = 'sent' where id = v_po_id;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('cancelled → sent rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: cancel happy path — draft → cancelled, sent → cancelled
-- ---------------------------------------------------------------------------

do $$
declare
  v_draft uuid;
  v_sent uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_draft;
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000002","quantity":5,"unit_price":28}]'::jsonb
  ) into v_sent;
  perform public.send_purchase_order(v_sent);

  perform public.cancel_purchase_order(v_draft);
  perform pg_temp.assert_true('draft → cancelled',
    (select status from public.purchase_orders where id = v_draft) = 'cancelled');

  perform public.cancel_purchase_order(v_sent);
  perform pg_temp.assert_true('sent → cancelled',
    (select status from public.purchase_orders where id = v_sent) = 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: partial receive → partially_received; full receive → received
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_line1 uuid;
  v_line2 uuid;
  v_result jsonb;
  v_stock numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5},
      {"item_id":"61000000-0000-0000-0000-000000000002","quantity":4,"unit_price":28}]'::jsonb
  ) into v_po_id;
  perform public.send_purchase_order(v_po_id);

  select id into v_line1 from public.purchase_order_lines
  where po_id = v_po_id and item_id = '61000000-0000-0000-0000-000000000001';
  select id into v_line2 from public.purchase_order_lines
  where po_id = v_po_id and item_id = '61000000-0000-0000-0000-000000000002';

  -- Partial: 6 of 10 on line 1.
  select public.receive_purchase_order(v_po_id,
    jsonb_build_array(jsonb_build_object(
      'po_line_id', v_line1, 'quantity', 6,
      'batch_no', 'B-001', 'expiry_date', (current_date + 30)::text, 'notes', 'first drop'
    ))) into v_result;

  perform pg_temp.assert_true('partial receive → partially_received',
    (v_result ->> 'status') = 'partially_received'
    and (select status from public.purchase_orders where id = v_po_id) = 'partially_received');
  perform pg_temp.assert_true('received_quantity bumped',
    (select received_quantity from public.purchase_order_lines where id = v_line1) = 6);

  -- Ledger: one receipt movement tagged to the PO, cost = PO snapshot.
  perform pg_temp.assert_true('ledger movement tagged purchase_order/<po_id>',
    (select count(*) from public.stock_movements
     where reference_type = 'purchase_order' and reference_id = v_po_id
       and item_id = '61000000-0000-0000-0000-000000000001'
       and quantity = 6 and unit_cost = 32.5
       and batch_no = 'B-001') = 1);
  select quantity into v_stock from public.current_stock
  where item_id = '61000000-0000-0000-0000-000000000001'
    and restaurant_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert_true('current_stock reflects the receipt', v_stock = 6);

  -- Full: remaining 4 on line 1 + all 4 on line 2.
  select public.receive_purchase_order(v_po_id,
    jsonb_build_array(
      jsonb_build_object('po_line_id', v_line1, 'quantity', 4),
      jsonb_build_object('po_line_id', v_line2, 'quantity', 4)
    )) into v_result;

  perform pg_temp.assert_true('full receive → received',
    (v_result ->> 'status') = 'received'
    and (select status from public.purchase_orders where id = v_po_id) = 'received');
  perform pg_temp.assert_true('line 1 fully received',
    (select received_quantity from public.purchase_order_lines where id = v_line1) = 10);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: receive validation — over-receive, draft PO, bad line, unknown PO
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_line uuid;
  v_draft uuid;
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_po_id;
  perform public.send_purchase_order(v_po_id);
  select id into v_line from public.purchase_order_lines where po_id = v_po_id;

  -- Over-receive: 11 > 10 ordered.
  begin
    perform public.receive_purchase_order(v_po_id,
      jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 11)));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('over-receive rejected', v_failed);
  perform pg_temp.assert_true('failed receive leaves received_quantity at 0',
    (select received_quantity from public.purchase_order_lines where id = v_line) = 0);

  -- Receive 6, then receiving 5 more (6+5 > 10) rejected.
  perform public.receive_purchase_order(v_po_id,
    jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 6)));
  begin
    perform public.receive_purchase_order(v_po_id,
      jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 5)));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('cumulative over-receive rejected', v_failed);

  -- Line from another PO rejected.
  begin
    perform public.receive_purchase_order(v_po_id,
      jsonb_build_array(jsonb_build_object(
        'po_line_id', '00000000-0000-0000-0000-000000000000', 'quantity', 1)));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('unknown line rejected', v_failed);

  -- Receive against a draft PO rejected.
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_draft;
  begin
    perform public.receive_purchase_order(v_draft,
      jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 1)));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('receive on draft PO rejected', v_failed);

  -- Zero quantity rejected.
  begin
    perform public.receive_purchase_order(v_po_id,
      jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 0)));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('zero receive quantity rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T7: role enforcement — staff denied on all three RPCs
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_line uuid;
  v_failed boolean;
begin
  -- Manager creates + sends a PO first.
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_po_id;
  perform public.send_purchase_order(v_po_id);
  select id into v_line from public.purchase_order_lines where po_id = v_po_id;

  -- Staff attempts.
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  begin
    perform public.send_purchase_order(v_po_id);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('staff send rejected', v_failed);

  begin
    perform public.cancel_purchase_order(v_po_id);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('staff cancel rejected', v_failed);

  begin
    perform public.receive_purchase_order(v_po_id,
      jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 1)));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('staff receive rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T8: tenant isolation — manager of A cannot touch B's PO
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_b uuid;
  v_failed boolean;
begin
  -- B's PO row inserted directly as superuser (bypasses RLS by design).
  reset role;
  insert into public.purchase_orders (id, restaurant_id, supplier_id, status, order_date)
  values ('70000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
          '63000000-0000-0000-0000-000000000001', 'draft', current_date);
  set role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    perform public.send_purchase_order('70000000-0000-0000-0000-000000000001');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('cross-restaurant send rejected', v_failed);

  begin
    perform public.cancel_purchase_order('70000000-0000-0000-0000-000000000001');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('cross-restaurant cancel rejected', v_failed);

  begin
    perform public.receive_purchase_order('70000000-0000-0000-0000-000000000001', '[]'::jsonb);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('cross-restaurant receive rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T9: line guard — direct edits on non-draft POs
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
  v_line uuid;
  v_failed boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001', current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":10,"unit_price":32.5}]'::jsonb
  ) into v_po_id;
  perform public.send_purchase_order(v_po_id);
  select id into v_line from public.purchase_order_lines where po_id = v_po_id;

  -- Changing the ordered quantity on a sent PO is rejected.
  begin
    update public.purchase_order_lines set quantity = 20 where id = v_line;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('quantity edit on sent PO rejected', v_failed);

  -- Decreasing received_quantity directly is rejected.
  perform public.receive_purchase_order(v_po_id,
    jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 4)));
  begin
    update public.purchase_order_lines set received_quantity = 1 where id = v_line;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('received_quantity decrease rejected', v_failed);

  -- Bumping received_quantity directly past quantity is rejected.
  begin
    update public.purchase_order_lines set received_quantity = 99 where id = v_line;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('direct over-receive rejected', v_failed);

  -- Fully receive, then any line change is rejected (terminal state).
  perform public.receive_purchase_order(v_po_id,
    jsonb_build_array(jsonb_build_object('po_line_id', v_line, 'quantity', 6)));
  begin
    delete from public.purchase_order_lines where id = v_line;
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('line delete on received PO rejected', v_failed);

  -- received is terminal for the header too.
  begin
    perform public.cancel_purchase_order(v_po_id);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert_true('cancel received PO rejected', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- T10: receive_goods backward compatibility (single-arg callers)
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Old single-argument call shape still resolves (defaults fill in).
  select public.receive_goods(
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":2,"unit_cost":30}]'::jsonb
  ) into v_result;

  perform pg_temp.assert_true('single-arg receive_goods works',
    jsonb_array_length(v_result) = 1);
  perform pg_temp.assert_true('reference defaults to ad_hoc',
    (select count(*) from public.stock_movements
     where reference_type = 'ad_hoc' and reference_id is null
       and item_id = '61000000-0000-0000-0000-000000000001'
       and quantity = 2) >= 1);
end;
$$;

reset role;
rollback;
