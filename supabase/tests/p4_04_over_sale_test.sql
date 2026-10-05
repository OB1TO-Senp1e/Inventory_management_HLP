-- ============================================================================
-- P4-04 tests: insufficient-stock handling for record_sales.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P4-04 migration (supabase/migrations/20261005080000_over_sale_flag.sql):
--   * preview_sales_deductions: per-item current / deduction / projected +
--     would_go_negative (same math record_sales posts);
--   * record_sales sets over_sale=true on movements that drive stock below
--     zero, false otherwise;
--   * an audit_log row (action 'over_sale') is written per over-sale call,
--     none for sufficient-stock calls; payload shape checked;
--   * roles: owner/manager allowed, staff denied (preview + record);
--   * cross-restaurant isolation for preview/record/audit_log;
--   * audit_log is append-only (trigger + ACL) and staff-invisible.
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
  ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'gram', 'g'),
  ('60000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'litre', 'L'),
  ('60000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'millilitre', 'ml');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Milk', '60000000-0000-0000-0000-000000000003', 10, 5);

insert into public.unit_conversions (restaurant_id, from_unit_id, to_unit_id, factor) values
  ('11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000001', 0.001),
  ('11111111-1111-1111-1111-111111111111', '60000000-0000-0000-0000-000000000005',
   '60000000-0000-0000-0000-000000000003', 0.001);

insert into public.menu_items (id, restaurant_id, name, yield_quantity, yield_unit) values
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Butter Chicken', 4, 'servings');

insert into public.recipe_ingredients (menu_item_id, restaurant_id, item_id, quantity, unit_id) values
  -- Butter Chicken: 2 kg tomatoes (same unit), 500 ml milk (one-hop to L).
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000001', 2, '60000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61000000-0000-0000-0000-000000000002', 500, '60000000-0000-0000-0000-000000000005');

-- Tight stock so over-sales are easy to trigger:
-- Tomatoes 2 kg, Milk 1 L.
insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity) values
  ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000001',
   'opening_balance', 2),
  ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000002',
   'opening_balance', 1);

-- All access checks below run as a non-superuser so RLS is enforced.
set role authenticated;

-- ---------------------------------------------------------------------------
-- T1: preview math — current / deduction / projected / would_go_negative
-- ---------------------------------------------------------------------------

do $$
declare
  v_tom record;
  v_milk record;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Butter Chicken x8 (yield 4):
  --   Tomatoes: 8 x 2 / 4 = 4 kg vs 2 kg stock  → -2, flagged
  --   Milk:     8 x 500 ml / 4 = 1000 ml = 1 L vs 1 L stock → 0, not flagged
  select * into v_tom from public.preview_sales_deductions(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":8}]'::jsonb)
   where item_id = '61000000-0000-0000-0000-000000000001';
  select * into v_milk from public.preview_sales_deductions(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":8}]'::jsonb)
   where item_id = '61000000-0000-0000-0000-000000000002';

  perform pg_temp.assert_true('preview returns both ingredients',
    v_tom.item_id is not null and v_milk.item_id is not null);
  perform pg_temp.assert_true('preview: tomatoes current 2 kg',
    v_tom.current_quantity = 2);
  perform pg_temp.assert_true('preview: tomatoes deduction 4 kg',
    v_tom.deduction_quantity = 4);
  perform pg_temp.assert_true('preview: tomatoes projected -2 kg',
    v_tom.projected_quantity = -2);
  perform pg_temp.assert_true('preview: tomatoes would_go_negative',
    v_tom.would_go_negative is true);
  perform pg_temp.assert_true('preview: milk deduction converts ml→L (1 L)',
    v_milk.deduction_quantity = 1);
  perform pg_temp.assert_true('preview: milk projected 0, not flagged',
    v_milk.projected_quantity = 0 and v_milk.would_go_negative is false);

  -- Sufficient stock: Butter Chicken x2 → tomatoes 1 kg vs 2 kg → not flagged.
  select * into v_tom from public.preview_sales_deductions(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb)
   where item_id = '61000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('preview: sufficient stock not flagged',
    v_tom.would_go_negative is false and v_tom.projected_quantity = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: record_sales flags the movement + writes the audit entry on over-sale
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_flagged_count integer;
  v_audit record;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Butter Chicken x8: tomatoes go to -2 → flagged; milk stays 0 → not flagged.
  select public.record_sales(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":8}]'::jsonb,
    '2026-10-05'::date) into v_result;

  select count(*) into v_flagged_count from public.stock_movements
   where restaurant_id = '11111111-1111-1111-1111-111111111111'
     and movement_type = 'sale_deduction'
     and over_sale is true;
  perform pg_temp.assert_true('one movement flagged over_sale', v_flagged_count = 1);

  perform pg_temp.assert_true('flagged movement is tomatoes',
    exists (select 1 from public.stock_movements
             where movement_type = 'sale_deduction'
               and over_sale is true
               and item_id = '61000000-0000-0000-0000-000000000001'
               and quantity = -4));

  perform pg_temp.assert_true('milk movement not flagged',
    exists (select 1 from public.stock_movements
             where movement_type = 'sale_deduction'
               and over_sale is false
               and item_id = '61000000-0000-0000-0000-000000000002'));

  -- The audit entry: one row per over-sale call, with the payload shape.
  select * into v_audit from public.audit_log
   where restaurant_id = '11111111-1111-1111-1111-111111111111'
     and action = 'over_sale';
  perform pg_temp.assert_true('audit_log has the over_sale row',
    v_audit.id is not null);
  perform pg_temp.assert_true('audit entry pins the restaurant',
    v_audit.restaurant_id = '11111111-1111-1111-1111-111111111111');
  perform pg_temp.assert_true('audit entry carries the sale date',
    v_audit.details ->> 'sale_date' = '2026-10-05');
  perform pg_temp.assert_true('audit entry flags tomatoes with projected -2',
    (v_audit.details -> 'flagged_items' -> 0 ->> 'item_id')
      = '61000000-0000-0000-0000-000000000001'
    and (v_audit.details -> 'flagged_items' -> 0 ->> 'projected_quantity')::numeric = -2
    and jsonb_array_length(v_audit.details -> 'flagged_items') = 1);
  perform pg_temp.assert_true('audit entry lists the contributing dish',
    (v_audit.details -> 'lines' -> 0 ->> 'name') = 'Butter Chicken');
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: sufficient stock → no flag, no audit entry
-- ---------------------------------------------------------------------------

do $$
declare
  v_audit_count integer;
  v_flagged_count integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- T2 left tomatoes at -2 kg and milk at exactly 0; restock both so x2
  -- (1 kg tomatoes, 0.5 L milk) is fully sufficient.
  -- Direct insert as the table owner inside the test transaction is fine
  -- (fixtures pattern); the RPC path is what the app uses.
  reset role;
  insert into public.stock_movements (restaurant_id, item_id, movement_type, quantity) values
    ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000001',
     'opening_balance', 10),
    ('11111111-1111-1111-1111-111111111111', '61000000-0000-0000-0000-000000000002',
     'opening_balance', 10);
  set role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  perform public.record_sales(
    '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb,
    '2026-10-06'::date);

  select count(*) into v_flagged_count from public.stock_movements
   where restaurant_id = '11111111-1111-1111-1111-111111111111'
     and movement_type = 'sale_deduction'
     and over_sale is true
     and notes like '%2026-10-06%';
  perform pg_temp.assert_true('sufficient sale: no movement flagged', v_flagged_count = 0);

  select count(*) into v_audit_count from public.audit_log
   where restaurant_id = '11111111-1111-1111-1111-111111111111'
     and details ->> 'sale_date' = '2026-10-06';
  perform pg_temp.assert_true('sufficient sale: no audit entry', v_audit_count = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: roles — staff denied on preview and record
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  begin
    perform * from public.preview_sales_deductions(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb);
    perform pg_temp.assert_true('staff denied preview_sales_deductions', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('staff denied preview_sales_deductions',
      v_msg like '%your role cannot record sales%');
  end;

  begin
    perform public.record_sales(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb);
    perform pg_temp.assert_true('staff denied record_sales', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('staff denied record_sales',
      v_msg like '%your role cannot record sales%');
  end;

  begin
    perform * from public.compute_sales_deductions(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb);
    perform pg_temp.assert_true('staff denied compute_sales_deductions', false);
  exception when raise_exception then
    perform pg_temp.assert_true('staff denied compute_sales_deductions', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: tenant isolation — preview and audit_log stay in-restaurant
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
  v_visible_count integer;
begin
  -- Manager of A cannot preview: B has no dish fixture here, and a forged
  -- cross-restaurant menu_item_id would raise "not found in your restaurant".
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    perform * from public.preview_sales_deductions(
      '[{"menu_item_id":"72000000-0000-0000-0000-000000000001","dishes":2}]'::jsonb);
    perform pg_temp.assert_true('preview rejects unknown menu item', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('preview rejects unknown menu item',
      v_msg like '%not found in your restaurant%');
  end;

  -- Owner of B cannot see A's audit entries.
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  select count(*) into v_visible_count from public.audit_log;
  perform pg_temp.assert_true('owner of B sees zero audit rows', v_visible_count = 0);

  -- Owner of A sees A's over_sale entry.
  perform set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);
  select count(*) into v_visible_count from public.audit_log;
  perform pg_temp.assert_true('owner of A sees the audit row', v_visible_count = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: audit_log is append-only — trigger (layer 1) and ACL (layer 3)
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  -- Layer 1: the trigger rejects UPDATE/DELETE even for the table owner.
  reset role;

  begin
    update public.audit_log set action = 'tampered';
    perform pg_temp.assert_true('trigger rejects audit_log UPDATE', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('trigger rejects audit_log UPDATE',
      v_msg like '%append-only: UPDATE%');
  end;

  begin
    delete from public.audit_log;
    perform pg_temp.assert_true('trigger rejects audit_log DELETE', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('trigger rejects audit_log DELETE',
      v_msg like '%append-only: DELETE%');
  end;

  -- Layer 3 (client path): authenticated gets permission denied on writes.
  set role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    insert into public.audit_log (restaurant_id, action)
    values ('11111111-1111-1111-1111-111111111111', 'forged');
    perform pg_temp.assert_true('authenticated denied INSERT on audit_log', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('authenticated denied INSERT on audit_log', true);
  end;

  begin
    update public.audit_log set action = 'forged';
    perform pg_temp.assert_true('authenticated denied UPDATE on audit_log', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('authenticated denied UPDATE on audit_log', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T7: staff cannot SELECT audit entries
-- ---------------------------------------------------------------------------

do $$
begin
  set role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  perform pg_temp.assert_true('staff sees zero audit rows',
    (select count(*) from public.audit_log) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T8: preview guard parity — empty lines and bad dishes raise
-- ---------------------------------------------------------------------------

do $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    perform * from public.preview_sales_deductions('[]'::jsonb);
    perform pg_temp.assert_true('preview rejects empty lines', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('preview rejects empty lines',
      v_msg like '%at least one dish%');
  end;

  begin
    perform * from public.preview_sales_deductions(
      '[{"menu_item_id":"71000000-0000-0000-0000-000000000001","dishes":0}]'::jsonb);
    perform pg_temp.assert_true('preview rejects non-positive dishes', false);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.assert_true('preview rejects non-positive dishes',
      v_msg like '%greater than zero%');
  end;
end;
$$;

rollback;
