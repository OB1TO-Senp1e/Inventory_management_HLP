-- ============================================================================
-- P4-01 RLS tests: menu_items + recipe_ingredients + unit_conversions.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P4-01 migration: owner/manager CRUD on all three tables in
-- their own restaurant, staff denied entirely (no policies — every staff
-- query is refused; recipes will carry costs in P4-02), cross-restaurant
-- isolation, the unit guard trigger (ingredient unit must be the item's
-- base unit or directly convertible), unique (menu_item_id, item_id),
-- cascade delete of ingredients when a menu item is deleted, and the
-- unit_conversions self-reference/factor guards.
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
  ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'gram', 'g'),
  ('60000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'litre', 'L'),
  ('60000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'kilogram', 'kg');

insert into public.items (id, restaurant_id, name, unit_id, par_level, reorder_point) values
  ('61000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tomatoes', '60000000-0000-0000-0000-000000000001', 10, 5),
  ('61000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Milk', '60000000-0000-0000-0000-000000000003', 10, 5),
  ('62000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Flour', '60000000-0000-0000-0000-000000000004', 10, 5);

insert into public.unit_conversions (id, restaurant_id, from_unit_id, to_unit_id, factor) values
  ('65000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 0.001);

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
-- T1: manager of A — full CRUD on menu_items
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
  values ('11111111-1111-1111-1111-111111111111', 'Butter Chicken', 4, 'servings')
  returning id into v_id;

  perform pg_temp.assert_true('manager inserts menu item',
    (select count(*) from public.menu_items where id = v_id) = 1);

  update public.menu_items set name = 'Butter Chicken v2' where id = v_id;
  perform pg_temp.assert_true('manager updates menu item',
    (select name from public.menu_items where id = v_id) = 'Butter Chicken v2');

  -- Soft archive keeps the row (history for future sales records).
  update public.menu_items set active = false where id = v_id;
  perform pg_temp.assert_true('manager archives menu item',
    (select active from public.menu_items where id = v_id) = false);

  delete from public.menu_items where id = v_id;
  perform pg_temp.assert_true('manager hard-deletes menu item',
    (select count(*) from public.menu_items where id = v_id) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: recipe_ingredients — base-unit and converted-unit inserts, unit guard
-- ---------------------------------------------------------------------------

do $$
declare
  v_menu uuid;
  v_ing uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
  values ('11111111-1111-1111-1111-111111111111', 'Tomato Soup', 4, 'servings')
  returning id into v_menu;

  -- Base unit (kg) — always allowed.
  insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
  values ('11111111-1111-1111-1111-111111111111', v_menu, '61000000-0000-0000-0000-000000000001', 2, '60000000-0000-0000-0000-000000000001')
  returning id into v_ing;
  perform pg_temp.assert_true('base-unit ingredient inserted', v_ing is not null);

  -- Directly convertible unit (g -> kg) — allowed.
  update public.recipe_ingredients
  set quantity = 2000, unit_id = '60000000-0000-0000-0000-000000000002'
  where id = v_ing;
  perform pg_temp.assert_true('converted-unit ingredient update allowed',
    (select unit_id from public.recipe_ingredients where id = v_ing)
      = '60000000-0000-0000-0000-000000000002');

  -- Incompatible unit (L for a kg item) — rejected by the trigger.
  begin
    insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
    values ('11111111-1111-1111-1111-111111111111', v_menu, '61000000-0000-0000-0000-000000000002', 1, '60000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('unit guard rejects incompatible unit', false);
  exception when others then
    perform pg_temp.assert_true('unit guard rejects incompatible unit',
      sqlerrm like '%not convertible%');
  end;

  -- Duplicate (menu_item_id, item_id) — rejected by the unique index.
  begin
    insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
    values ('11111111-1111-1111-1111-111111111111', v_menu, '61000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('unique (menu_item_id, item_id) enforced', false);
  exception when unique_violation then
    perform pg_temp.assert_true('unique (menu_item_id, item_id) enforced', true);
  end;

  -- Cascade: deleting the menu item removes its ingredients.
  delete from public.menu_items where id = v_menu;
  perform pg_temp.assert_true('ingredients cascade on menu item delete',
    (select count(*) from public.recipe_ingredients where menu_item_id = v_menu) = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: staff denied entirely on recipes (no policies for staff)
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible int;
begin
  -- Seed one menu item as manager first.
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
  values ('11111111-1111-1111-1111-111111111111', 'Staff Hidden', 2, 'servings');

  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);

  select count(*) into v_visible from public.menu_items;
  perform pg_temp.assert_true('staff sees zero menu items', v_visible = 0);

  select count(*) into v_visible from public.recipe_ingredients;
  perform pg_temp.assert_true('staff sees zero ingredients', v_visible = 0);

  select count(*) into v_visible from public.unit_conversions;
  perform pg_temp.assert_true('staff sees zero conversions', v_visible = 0);

  begin
    insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
    values ('11111111-1111-1111-1111-111111111111', 'Staff Dish', 1, 'servings');
    perform pg_temp.assert_true('staff insert refused', false);
  exception when insufficient_privilege then
    perform pg_temp.assert_true('staff insert refused', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T4: cross-restaurant isolation (owner of B vs A's data)
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);

  select count(*) into v_visible
  from public.menu_items
  where restaurant_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert_true('B owner cannot see A recipes', v_visible = 0);

  -- And A's rows cannot be touched from B's context.
  begin
    update public.menu_items set name = 'Hijacked'
    where restaurant_id = '11111111-1111-1111-1111-111111111111';
    if not found then
      perform pg_temp.assert_true('B owner cannot update A recipes', true);
    else
      perform pg_temp.assert_true('B owner cannot update A recipes', false);
    end if;
  end;

  -- RLS on unit_conversions is by the conversion's own restaurant_id; the
  -- FK to units(id) allows referencing any unit row (same as other tables).
  -- Cross-restaurant visibility is still blocked by RLS (asserted above).
  perform pg_temp.assert_true('conversion RLS scoped to own restaurant',
    (select count(*) from public.unit_conversions
     where restaurant_id = '11111111-1111-1111-1111-111111111111') = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- T5: unit_conversions constraints (factor > 0, no self-reference, unique)
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- Self-conversion rejected.
  begin
    insert into public.unit_conversions (restaurant_id, from_unit_id, to_unit_id, factor)
    values ('11111111-1111-1111-1111-111111111111',
            '60000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000001', 1.0);
    perform pg_temp.assert_true('self-conversion rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('self-conversion rejected', true);
  end;

  -- Non-positive factor rejected.
  begin
    insert into public.unit_conversions (restaurant_id, from_unit_id, to_unit_id, factor)
    values ('11111111-1111-1111-1111-111111111111',
            '60000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000002', 0);
    perform pg_temp.assert_true('zero factor rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('zero factor rejected', true);
  end;

  -- Duplicate (from, to) pair rejected.
  begin
    insert into public.unit_conversions (restaurant_id, from_unit_id, to_unit_id, factor)
    values ('11111111-1111-1111-1111-111111111111',
            '60000000-0000-0000-0000-000000000002',
            '60000000-0000-0000-0000-000000000001', 0.001);
    perform pg_temp.assert_true('duplicate conversion rejected', false);
  exception when unique_violation then
    perform pg_temp.assert_true('duplicate conversion rejected', true);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T6: check constraints on menu_items / recipe_ingredients
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  begin
    insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
    values ('11111111-1111-1111-1111-111111111111', 'Bad Yield', 0, 'servings');
    perform pg_temp.assert_true('zero yield rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('zero yield rejected', true);
  end;

  begin
    insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
            '61000000-0000-0000-0000-000000000001', 0,
            '60000000-0000-0000-0000-000000000001');
    perform pg_temp.assert_true('zero ingredient quantity rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('zero ingredient quantity rejected', true);
  end;
end;
$$;

rollback;
