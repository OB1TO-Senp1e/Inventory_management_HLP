-- ============================================================================
-- P1-02 RLS tests: taxonomy (item_categories + storage_locations).
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P1-02 migration: `active` flag defaults, owner/manager write
-- access, staff denied, cross-restaurant isolation, per-restaurant name
-- uniqueness, and ON DELETE RESTRICT on items.category_id /
-- items.storage_location_id (in-use delete fails with 23503; unused
-- delete succeeds).
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

insert into public.item_categories (id, restaurant_id, name) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Vegetables'), -- used by item
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Spices'),     -- unused
  ('c0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Dairy');

insert into public.storage_locations (id, restaurant_id, name) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Dry Store'), -- used by item
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Freezer'),   -- unused
  ('d0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Cold Room');

insert into public.units (id, restaurant_id, name, symbol) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'kilogram', 'kg');

insert into public.items
  (id, restaurant_id, name, category_id, unit_id, storage_location_id, par_level, reorder_point)
values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomato', 'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001', 10, 4);

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
-- T1: manager of A — full CRUD on own restaurant's categories
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.item_categories (restaurant_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Herbs')
  returning id into v_id;
  perform pg_temp.assert_true('manager category insert ok', v_id is not null);
  perform pg_temp.assert_true('category active defaults to true',
    (select active from public.item_categories where id = v_id));

  update public.item_categories set name = 'Fresh Herbs' where id = v_id;
  perform pg_temp.assert_true('manager category update ok',
    (select name from public.item_categories where id = v_id) = 'Fresh Herbs');

  -- archive (soft delete)
  update public.item_categories set active = false where id = v_id;
  perform pg_temp.assert_true('manager category archive ok',
    (select active from public.item_categories where id = v_id) = false);

  -- hard delete of an unused row succeeds
  delete from public.item_categories where id = v_id;
  perform pg_temp.assert_true('manager category hard delete ok (unused)',
    not exists (select 1 from public.item_categories where id = v_id));
end $$;

-- ---------------------------------------------------------------------------
-- T2: manager of A — same for storage locations
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.storage_locations (restaurant_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Pantry')
  returning id into v_id;
  perform pg_temp.assert_true('manager location insert ok', v_id is not null);
  perform pg_temp.assert_true('location active defaults to true',
    (select active from public.storage_locations where id = v_id));

  update public.storage_locations set active = false where id = v_id;
  perform pg_temp.assert_true('manager location archive ok',
    (select active from public.storage_locations where id = v_id) = false);

  delete from public.storage_locations where id = v_id;
  perform pg_temp.assert_true('manager location hard delete ok (unused)',
    not exists (select 1 from public.storage_locations where id = v_id));
end $$;

-- ---------------------------------------------------------------------------
-- T3: staff of A — reads allowed, all writes denied
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  select count(*) into v_count from public.item_categories;
  perform pg_temp.assert_true('staff sees own categories', v_count = 2);
  select count(*) into v_count from public.storage_locations;
  perform pg_temp.assert_true('staff sees own locations', v_count = 2);

  begin
    insert into public.item_categories (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky');
    raise exception 'ASSERT FAILED: staff category insert was allowed';
  exception when insufficient_privilege then
    raise notice 'ok: staff category insert denied';
  end;

  update public.item_categories set name = 'Hacked'
  where id = 'c0000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff category update touches 0 rows', v_count = 0);

  update public.storage_locations set active = false
  where id = 'd0000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff location archive touches 0 rows', v_count = 0);

  delete from public.storage_locations
  where id = 'd0000000-0000-0000-0000-000000000002';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('staff location delete touches 0 rows', v_count = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T4: cross-restaurant isolation (manager of A vs restaurant B)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  select count(*) into v_count from public.item_categories;
  perform pg_temp.assert_true('manager sees only A categories', v_count = 2);

  update public.item_categories set name = 'Hacked'
  where id = 'c0000000-0000-0000-0000-000000000003';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('manager cannot touch B category', v_count = 0);

  -- same name is fine in a different restaurant (unique is per-restaurant)
  insert into public.item_categories (restaurant_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Dairy');
  perform pg_temp.assert_true('same name allowed in other restaurant', true);
end $$;

-- ---------------------------------------------------------------------------
-- T5: name uniqueness per restaurant
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    insert into public.item_categories (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Vegetables');
    raise exception 'ASSERT FAILED: duplicate category name was allowed';
  exception when unique_violation then
    raise notice 'ok: duplicate category name rejected';
  end;

  begin
    insert into public.storage_locations (restaurant_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Dry Store');
    raise exception 'ASSERT FAILED: duplicate location name was allowed';
  exception when unique_violation then
    raise notice 'ok: duplicate location name rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- T6: ON DELETE RESTRICT — in-use category cannot be hard-deleted
-- ---------------------------------------------------------------------------

do $$
declare
  v_state text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    delete from public.item_categories
    where id = 'c0000000-0000-0000-0000-000000000001'; -- used by Tomato
    raise exception 'ASSERT FAILED: in-use category delete was allowed';
  exception when foreign_key_violation then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.assert_true('in-use category delete raises 23503', v_state = '23503');
  end;

  perform pg_temp.assert_true('in-use category still exists',
    exists (select 1 from public.item_categories
            where id = 'c0000000-0000-0000-0000-000000000001'));

  -- unused category deletes cleanly
  delete from public.item_categories
  where id = 'c0000000-0000-0000-0000-000000000002'; -- Spices, unused
  perform pg_temp.assert_true('unused category deletes cleanly',
    not exists (select 1 from public.item_categories
                where id = 'c0000000-0000-0000-0000-000000000002'));
end $$;

-- ---------------------------------------------------------------------------
-- T7: ON DELETE RESTRICT — in-use storage location cannot be hard-deleted
-- ---------------------------------------------------------------------------

do $$
declare
  v_state text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    delete from public.storage_locations
    where id = 'd0000000-0000-0000-0000-000000000001'; -- used by Tomato
    raise exception 'ASSERT FAILED: in-use location delete was allowed';
  exception when foreign_key_violation then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_temp.assert_true('in-use location delete raises 23503', v_state = '23503');
  end;

  perform pg_temp.assert_true('in-use location still exists',
    exists (select 1 from public.storage_locations
            where id = 'd0000000-0000-0000-0000-000000000001'));

  -- unused location deletes cleanly
  delete from public.storage_locations
  where id = 'd0000000-0000-0000-0000-000000000002'; -- Freezer, unused
  perform pg_temp.assert_true('unused location deletes cleanly',
    not exists (select 1 from public.storage_locations
                where id = 'd0000000-0000-0000-0000-000000000002'));
end $$;

-- ---------------------------------------------------------------------------
-- T8: owner of B manages B's taxonomy (role sanity across restaurants)
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  select count(*) into v_count from public.item_categories;
  perform pg_temp.assert_true('owner sees only B categories', v_count = 1);

  update public.storage_locations set name = 'Walk-in Cooler'
  where id = 'd0000000-0000-0000-0000-000000000003';
  get diagnostics v_count = row_count;
  perform pg_temp.assert_true('owner location update ok', v_count = 1);
end $$;

-- ---------------------------------------------------------------------------

select 'P1-02 RLS TESTS PASSED' as result;

rollback;
