-- ============================================================================
-- P2-04 DB tests — item detail page reads: ledger ordering, tenant
-- isolation, staff read access, reason codes, batch filtering, pagination.
--
-- The detail page only READS the ledger (listMovements / listBatches go
-- through plain SELECTs — no new RPCs, no schema changes in P2-04), so
-- these tests assert the SELECT contract the page depends on.
-- Conventions: single transaction, rolled back at the end (the file MUST
-- start with `begin;` — see the P2-03 incident note in PROGRESS.md Run 15).
-- ============================================================================

begin;

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
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point, active) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tomato', 'e0000000-0000-0000-0000-000000000001', 50, 10, true),
  ('f0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Flour',  'e0000000-0000-0000-0000-000000000002', 30, 8,  true);

-- Ledger for Tomato (A): opening balance, receipt with batch, wastage with
-- reason code, usage. Explicit created_at values pin the expected order.
insert into public.stock_movements
  (id, restaurant_id, item_id, movement_type, quantity, batch_no, expiry_date, unit_cost, reason_code, notes, created_by, created_at)
values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'opening_balance', 100, null, null, 30, null, null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'receipt', 50, 'B-101', '2026-12-31', 28, null, 'morning delivery', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-09-10T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'wastage', -5, 'B-101', '2026-12-31', null, 'spoiled', 'mushy crate', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-09-12T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001',
   'usage', -20, null, null, null, 'kitchen_use', null, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-09-15T08:00:00Z'),
  -- One movement for Flour (B): must never leak into A's reads.
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000002',
   'opening_balance', 200, null, null, 40, null, null, 'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-09-01T08:00:00Z');

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
-- T1: ledger reads newest-first (created_at desc, id desc tiebreak)
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids uuid[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select array_agg(m.id order by m.created_at desc, m.id desc) into v_ids
    from public.stock_movements m
   where m.item_id = 'f0000000-0000-0000-0000-000000000001';

  perform pg_temp.assert_true('T1: 4 movements for Tomato', array_length(v_ids, 1) = 4);
  perform pg_temp.assert_true('T1: newest first (usage, wastage, receipt, opening)',
    v_ids = array[
      'a0000000-0000-0000-0000-000000000004',
      'a0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000001'
    ]::uuid[]);
end $$;

-- ---------------------------------------------------------------------------
-- T2: tenant isolation — manager of A never sees B's movements
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from public.stock_movements
   where restaurant_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert_true('T2: 0 cross-restaurant movements visible', v_count = 0);

  select count(*) into v_count from public.stock_movements
   where item_id = 'f0000000-0000-0000-0000-000000000002';
  perform pg_temp.assert_true('T2: 0 movements for Flour visible', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T3: staff may SELECT movements (history context for their logging)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  select count(*) into v_count from public.stock_movements
   where item_id = 'f0000000-0000-0000-0000-000000000001';
  perform pg_temp.assert_true('T3: staff reads own-restaurant movements', v_count = 4);

  select count(*) into v_count from public.stock_movements
   where restaurant_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert_true('T3: staff still isolated by tenant', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T4: reason_code and batch/expiry columns are readable on rows
-- ---------------------------------------------------------------------------

do $$
declare
  v_reason text;
  v_batch text;
  v_expiry date;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}',
    true);

  select reason_code, batch_no, expiry_date into v_reason, v_batch, v_expiry
    from public.stock_movements
   where id = 'a0000000-0000-0000-0000-000000000003';
  perform pg_temp.assert_true('T4: wastage reason_code readable',
    v_reason = 'spoiled');
  perform pg_temp.assert_true('T4: batch_no readable', v_batch = 'B-101');
  perform pg_temp.assert_true('T4: expiry_date readable', v_expiry = '2026-12-31');

  -- Batch-tagged rows for the batch aggregation query.
  perform pg_temp.assert_true('T4: 2 batch-tagged movements for Tomato',
    (select count(*) from public.stock_movements
      where item_id = 'f0000000-0000-0000-0000-000000000001'
        and batch_no is not null) = 2);
end $$;

-- ---------------------------------------------------------------------------
-- T5: pagination (limit/offset over the newest-first order)
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids uuid[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select array_agg(m.id order by m.created_at desc, m.id desc) into v_ids
    from (select s.id, s.created_at from public.stock_movements s
           where s.item_id = 'f0000000-0000-0000-0000-000000000001'
           order by s.created_at desc, s.id desc
           limit 2 offset 2) m;
  perform pg_temp.assert_true('T5: second page holds the 2 oldest',
    v_ids = array[
      'a0000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000001'
    ]::uuid[]);
end $$;

-- ---------------------------------------------------------------------------
-- T6: append-only still holds (no UPDATE/DELETE policies on the ledger)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from pg_policies
   where schemaname = 'public' and tablename = 'stock_movements'
     and (cmd = 'UPDATE' or cmd = 'DELETE');
  perform pg_temp.assert_true('T6: zero UPDATE/DELETE policies on the ledger',
    v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup: nothing to clean (single transaction rolls back)
-- ---------------------------------------------------------------------------

rollback;
