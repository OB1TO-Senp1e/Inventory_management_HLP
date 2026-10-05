-- ============================================================================
-- V2-05 tests: PO send channels (`sent_at`/`sent_via`) + `po_sent` /
-- `po_resent` audit entries.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers supabase/migrations/20261005140000_po_send_channels.sql:
--   * send_purchase_order(p_po_id, p_channel) stamps sent_at/sent_via and
--     writes a po_sent audit row; invalid channel raises;
--   * the one-arg call still works (default null channel — pre-V2-05
--     behaviour, sent_via stays null);
--   * existing guards preserved: non-draft send raises, empty PO raises;
--   * staff cannot send or re-send; tenant isolation holds;
--   * log_po_resend writes a po_resent audit row on sent/partially_received
--     POs without changing the status; raises on draft/cancelled and on a
--     bad channel;
--   * sent_via CHECK constraint rejects other values.
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
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tomato', 'a0000000-0000-0000-0000-000000000001');

insert into public.suppliers (id, restaurant_id, name, phone, email) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Fresh Farms', '+91 98200 12345', 'ramesh@freshfarms.example');

-- Draft PO with one line (the send target).
insert into public.purchase_orders (id, restaurant_id, supplier_id, status) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'draft');
insert into public.purchase_order_lines (id, restaurant_id, po_id, item_id, quantity, unit_price) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 10, 32.5);

-- Draft PO with NO lines (empty-send guard).
insert into public.purchase_orders (id, restaurant_id, supplier_id, status) values
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'draft');

-- Already-sent PO (re-send target) and a cancelled PO.
insert into public.purchase_orders (id, restaurant_id, supplier_id, status, sent_at, sent_via) values
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'sent', now(), 'whatsapp'),
  ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'cancelled', null, null);

-- Fresh draft with a line (T2 invalid-channel target; T1 already sends ...001).
insert into public.purchase_orders (id, restaurant_id, supplier_id, status) values
  ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'draft');
insert into public.purchase_order_lines (id, restaurant_id, po_id, item_id, quantity, unit_price) values
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 5, 30);

-- RLS only applies to non-superusers: act as `authenticated` (the app's
-- role) for the role-based assertions below.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: send with a channel stamps sent_at/sent_via + writes po_sent audit
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  perform public.send_purchase_order('d0000000-0000-0000-0000-000000000001', 'whatsapp');

  perform pg_temp.assert_true('status flipped to sent',
    (select status from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000001') = 'sent');
  perform pg_temp.assert_true('sent_via recorded',
    (select sent_via from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000001') = 'whatsapp');
  perform pg_temp.assert_true('sent_at stamped',
    (select sent_at from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000001') is not null);
  perform pg_temp.assert_true('po_sent audit row with channel',
    (select count(*) from public.audit_log
       where action = 'po_sent'
         and entity_id = 'd0000000-0000-0000-0000-000000000001'
         and details ->> 'channel' = 'whatsapp') = 1);
end $$;

-- ---------------------------------------------------------------------------
-- T2: invalid channel raises; PO untouched (fixture as superuser above)
-- ---------------------------------------------------------------------------

do $$
begin
  -- Owner asserts (audit_log is owner-only to read, so the "no row"
  -- assertion is meaningful only as owner).
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  begin
    perform public.send_purchase_order('d0000000-0000-0000-0000-000000000005', 'pigeon');
    perform pg_temp.assert_true('invalid channel raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('invalid channel raises',
      sqlerrm like '%unknown channel%');
  end;
  perform pg_temp.assert_true('PO still draft after bad channel',
    (select status from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000005') = 'draft');
  perform pg_temp.assert_true('no audit row for failed send',
    (select count(*) from public.audit_log
       where entity_id = 'd0000000-0000-0000-0000-000000000005') = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T3: one-arg call keeps working (pre-V2-05 behaviour, channel null)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  perform public.send_purchase_order('d0000000-0000-0000-0000-000000000005');
  perform pg_temp.assert_true('one-arg send flips to sent',
    (select status from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000005') = 'sent');
  perform pg_temp.assert_true('sent_via null without channel',
    (select sent_via from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000005') is null);
  perform pg_temp.assert_true('po_sent audit row has null channel',
    (select count(*) from public.audit_log
       where action = 'po_sent'
         and entity_id = 'd0000000-0000-0000-0000-000000000005'
         and details ->> 'channel' is null) = 1);
end $$;

-- ---------------------------------------------------------------------------
-- T4: existing guards preserved (non-draft send, empty PO)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  begin
    perform public.send_purchase_order('d0000000-0000-0000-0000-000000000003', 'email');
    perform pg_temp.assert_true('re-send via send_purchase_order raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('re-send via send_purchase_order raises',
      sqlerrm like '%only draft purchase orders can be sent%');
  end;
  begin
    perform public.send_purchase_order('d0000000-0000-0000-0000-000000000002', 'email');
    perform pg_temp.assert_true('empty PO send raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('empty PO send raises',
      sqlerrm like '%no lines%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T5: staff cannot send; owner of B cannot touch A's PO
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  begin
    perform public.send_purchase_order('d0000000-0000-0000-0000-000000000002', 'email');
    perform pg_temp.assert_true('staff send raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff send raises',
      sqlerrm like '%requires owner or manager%');
  end;

  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  begin
    perform public.send_purchase_order('d0000000-0000-0000-0000-000000000002', 'email');
    perform pg_temp.assert_true('cross-tenant send raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('cross-tenant send raises',
      sqlerrm like '%not found in your restaurant%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: log_po_resend on a sent PO writes po_resent; status unchanged
-- ---------------------------------------------------------------------------

do $$
begin
  -- The re-send itself works for managers …
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  perform public.log_po_resend('d0000000-0000-0000-0000-000000000003', 'email');
  perform pg_temp.assert_true('status unchanged by re-send',
    (select status from public.purchase_orders where id = 'd0000000-0000-0000-0000-000000000003') = 'sent');
  -- … but the audit row is asserted as owner (audit_log is owner-only).
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  perform pg_temp.assert_true('po_resent audit row with channel',
    (select count(*) from public.audit_log
       where action = 'po_resent'
         and entity_id = 'd0000000-0000-0000-0000-000000000003'
         and details ->> 'channel' = 'email') = 1);
end $$;

-- ---------------------------------------------------------------------------
-- T7: log_po_resend rejects draft / cancelled / bad channel / staff
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  begin
    perform public.log_po_resend('d0000000-0000-0000-0000-000000000002', 'email');
    perform pg_temp.assert_true('re-send on draft raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('re-send on draft raises',
      sqlerrm like '%only sent purchase orders can be re-sent%');
  end;
  begin
    perform public.log_po_resend('d0000000-0000-0000-0000-000000000004', 'email');
    perform pg_temp.assert_true('re-send on cancelled raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('re-send on cancelled raises',
      sqlerrm like '%only sent purchase orders can be re-sent%');
  end;
  begin
    perform public.log_po_resend('d0000000-0000-0000-0000-000000000003', 'pigeon');
    perform pg_temp.assert_true('re-send with bad channel raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('re-send with bad channel raises',
      sqlerrm like '%unknown channel%');
  end;

  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  begin
    perform public.log_po_resend('d0000000-0000-0000-0000-000000000003', 'email');
    perform pg_temp.assert_true('staff re-send raises', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff re-send raises',
      sqlerrm like '%requires owner or manager%');
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T8: sent_via CHECK constraint rejects other values (superuser, direct)
-- ---------------------------------------------------------------------------

reset role;

do $$
begin
  begin
    update public.purchase_orders
    set sent_via = 'pigeon'
    where id = 'd0000000-0000-0000-0000-000000000003';
    perform pg_temp.assert_true('bad sent_via raises', false);
  exception when check_violation then
    perform pg_temp.assert_true('bad sent_via raises', true);
  end;
end $$;

rollback;
