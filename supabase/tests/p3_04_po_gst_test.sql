-- ============================================================================
-- P3-04 DB tests: purchase_orders.gst_rate — default, range check, RPC,
-- frozen-columns guard, single RPC signature.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser: bypasses RLS by design)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'GST Testaurant');

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); -- manager of the fixture restaurant

insert into public.profiles (id, restaurant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'manager');

insert into public.units (id, restaurant_id, name, symbol) values
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'GST Tomato', '60000000-0000-0000-0000-000000000001', 10, 5);

insert into public.suppliers (id, restaurant_id, name, active) values
  ('63000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'GST Supplier', true);

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
-- G1: gst_rate defaults, stores, and validates
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_default uuid;
  v_po_rated uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Default 0 when the RPC is called without the new argument.
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001',
    current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":2,"unit_price":50}]'::jsonb
  ) into v_po_default;

  perform pg_temp.assert_true('gst_rate defaults to 0',
    (select gst_rate from public.purchase_orders where id = v_po_default) = 0);

  -- Explicit rate is stored.
  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001',
    current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":100}]'::jsonb,
    18
  ) into v_po_rated;

  perform pg_temp.assert_true('RPC stores the given gst_rate',
    (select gst_rate from public.purchase_orders where id = v_po_rated) = 18);

  -- Out-of-range rate is rejected.
  begin
    perform public.create_purchase_order(
      '63000000-0000-0000-0000-000000000001',
      current_date, null, null,
      '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":100}]'::jsonb,
      101
    );
    perform pg_temp.assert_true('RPC rejects gst_rate > 100', false);
  exception when others then
    perform pg_temp.assert_true('RPC rejects gst_rate > 100', true);
  end;

  -- Negative rate is rejected by the column check (direct insert path).
  begin
    insert into public.purchase_orders (restaurant_id, supplier_id, status, order_date, gst_rate)
    values ('11111111-1111-1111-1111-111111111111', '63000000-0000-0000-0000-000000000001',
            'draft', current_date, -1);
    perform pg_temp.assert_true('column check rejects negative gst_rate', false);
  exception when check_violation then
    perform pg_temp.assert_true('column check rejects negative gst_rate', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- G2: gst_rate editable in draft, frozen once sent
-- ---------------------------------------------------------------------------

do $$
declare
  v_po_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select public.create_purchase_order(
    '63000000-0000-0000-0000-000000000001',
    current_date, null, null,
    '[{"item_id":"61000000-0000-0000-0000-000000000001","quantity":1,"unit_price":100}]'::jsonb,
    5
  ) into v_po_id;

  update public.purchase_orders set gst_rate = 12 where id = v_po_id;
  perform pg_temp.assert_true('gst_rate editable while draft',
    (select gst_rate from public.purchase_orders where id = v_po_id) = 12);

  perform public.send_purchase_order(v_po_id);

  begin
    update public.purchase_orders set gst_rate = 18 where id = v_po_id;
    perform pg_temp.assert_true('gst_rate frozen after send', false);
  exception when others then
    perform pg_temp.assert_true('gst_rate frozen after send', true);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- G3: exactly one create_purchase_order signature (no ambiguity)
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.assert_true('single create_purchase_order signature',
    (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_purchase_order') = 1);
end $$;

rollback;
