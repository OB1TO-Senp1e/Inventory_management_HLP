-- ============================================================================
-- P4-02 tests: menu_items.selling_price + menu_item_costs view.
--
-- Plain-SQL tests run via `pnpm test:db` (psql with ON_ERROR_STOP: any
-- unexpected error aborts non-zero). Everything runs inside one transaction
-- that is ROLLED BACK at the end, so the database is left clean and this
-- file is re-runnable.
--
-- Covers the P4-02 migration:
--   * selling_price: nullable, CHECK (> 0 when set), manager CRUD,
--     clearable back to null.
--   * menu_item_costs view: total ingredient cost for the full yield
--     computed LIVE from items.avg_unit_cost and the direct unit
--     conversions (same-unit factor 1, converted unit via factor);
--     empty recipes cost 0; the view recomputes when avg_unit_cost
--     changes (nothing is snapshotted).
--   * RLS on the view (security_invoker): owner/manager see their own
--     restaurant's rows, staff see zero rows (no policies on the recipe
--     tables — costs stay hidden), cross-restaurant isolation.
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

-- Live weighted-average costs (normally maintained by the receiving RPCs).
update public.items set avg_unit_cost = 32.50
  where id = '61000000-0000-0000-0000-000000000001';
update public.items set avg_unit_cost = 58.00
  where id = '61000000-0000-0000-0000-000000000002';
update public.items set avg_unit_cost = 45.00
  where id = '62000000-0000-0000-0000-000000000001';

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
-- T1: selling_price — nullable, CHECK > 0, manager CRUD, clearable
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  -- A recipe may exist before pricing is set: null is the default.
  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
  values ('11111111-1111-1111-1111-111111111111', 'Unpriced Dish', 4, 'servings')
  returning id into v_id;
  perform pg_temp.assert_true('selling_price defaults to null',
    (select selling_price from public.menu_items where id = v_id) is null);

  -- Set and update a price.
  update public.menu_items set selling_price = 199 where id = v_id;
  perform pg_temp.assert_true('manager sets selling price',
    (select selling_price from public.menu_items where id = v_id) = 199);

  update public.menu_items set selling_price = 249.50 where id = v_id;
  perform pg_temp.assert_true('manager updates selling price',
    (select selling_price from public.menu_items where id = v_id) = 249.50);

  -- Clear it back to null.
  update public.menu_items set selling_price = null where id = v_id;
  perform pg_temp.assert_true('manager clears selling price',
    (select selling_price from public.menu_items where id = v_id) is null);

  -- Zero and negative prices are rejected.
  begin
    update public.menu_items set selling_price = 0 where id = v_id;
    perform pg_temp.assert_true('zero selling price rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('zero selling price rejected', true);
  end;

  begin
    insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit, selling_price)
    values ('11111111-1111-1111-1111-111111111111', 'Bad Price', 2, 'servings', -10);
    perform pg_temp.assert_true('negative selling price rejected', false);
  exception when check_violation then
    perform pg_temp.assert_true('negative selling price rejected', true);
  end;

  delete from public.menu_items where id = v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: menu_item_costs view — live cost math (base unit, conversion, empty)
-- ---------------------------------------------------------------------------

do $$
declare
  v_butter uuid;
  v_soup uuid;
  v_empty uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);

  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit, selling_price)
  values ('11111111-1111-1111-1111-111111111111', 'Butter Chicken', 4, 'servings', 199)
  returning id into v_butter;

  -- 2 kg Tomatoes @ 32.50/kg = 65; 1 L Milk @ 58/L = 58 → 123.
  insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
  values
    ('11111111-1111-1111-1111-111111111111', v_butter, '61000000-0000-0000-0000-000000000001', 2, '60000000-0000-0000-0000-000000000001'),
    ('11111111-1111-1111-1111-111111111111', v_butter, '61000000-0000-0000-0000-000000000002', 1, '60000000-0000-0000-0000-000000000003');

  perform pg_temp.assert_true('view sums base-unit lines',
    (select ingredient_cost from public.menu_item_costs where menu_item_id = v_butter) = 123);

  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
  values ('11111111-1111-1111-1111-111111111111', 'Tomato Soup', 2, 'servings')
  returning id into v_soup;

  -- 500 g Tomatoes @ 32.50/kg via the g→kg factor = 16.25.
  insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
  values ('11111111-1111-1111-1111-111111111111', v_soup, '61000000-0000-0000-0000-000000000001', 500, '60000000-0000-0000-0000-000000000002');

  perform pg_temp.assert_true('view applies unit conversion',
    (select ingredient_cost from public.menu_item_costs where menu_item_id = v_soup) = 16.25);

  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit)
  values ('11111111-1111-1111-1111-111111111111', 'Empty Dish', 1, 'servings')
  returning id into v_empty;

  perform pg_temp.assert_true('empty recipe costs 0',
    (select ingredient_cost from public.menu_item_costs where menu_item_id = v_empty) = 0);

  -- The view is LIVE: changing avg_unit_cost recomputes the cost.
  -- Tomatoes 32.50 → 40: Butter Chicken = 2×40 + 58 = 138.
  update public.items set avg_unit_cost = 40
  where id = '61000000-0000-0000-0000-000000000001';

  perform pg_temp.assert_true('cost updates when avg_unit_cost changes',
    (select ingredient_cost from public.menu_item_costs where menu_item_id = v_butter) = 138);
  perform pg_temp.assert_true('converted line updates too (500g @ 40 = 20)',
    (select ingredient_cost from public.menu_item_costs where menu_item_id = v_soup) = 20);
end;
$$;

-- ---------------------------------------------------------------------------
-- T3: view RLS — staff see nothing, tenants isolated
-- ---------------------------------------------------------------------------

do $$
declare
  v_visible int;
  v_b_item uuid;
begin
  -- A recipe in restaurant B for the isolation check.
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  insert into public.menu_items (restaurant_id, name, yield_quantity, yield_unit, selling_price)
  values ('22222222-2222-2222-2222-222222222222', 'B Dish', 2, 'servings', 99)
  returning id into v_b_item;
  insert into public.recipe_ingredients (restaurant_id, menu_item_id, item_id, quantity, unit_id)
  values ('22222222-2222-2222-2222-222222222222', v_b_item, '62000000-0000-0000-0000-000000000001', 1, '60000000-0000-0000-0000-000000000004');
  perform pg_temp.assert_true('B view row costs 1kg Flour @ 45',
    (select ingredient_cost from public.menu_item_costs where menu_item_id = v_b_item) = 45);

  -- Manager of A: sees A's rows only.
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"manager"}',
    true);
  select count(*) into v_visible from public.menu_item_costs;
  perform pg_temp.assert_true('manager of A sees only A view rows', v_visible = 3);
  perform pg_temp.assert_true('manager of A cannot see B view row',
    (select count(*) from public.menu_item_costs where menu_item_id = v_b_item) = 0);

  -- Owner of B: sees B's row only.
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","restaurant_id":"22222222-2222-2222-2222-222222222222","role":"owner"}',
    true);
  select count(*) into v_visible from public.menu_item_costs;
  perform pg_temp.assert_true('owner of B sees only B view row', v_visible = 1);

  -- Staff of A: recipes carry costs — zero rows, not an error.
  perform set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","restaurant_id":"11111111-1111-1111-1111-111111111111","role":"staff"}',
    true);
  select count(*) into v_visible from public.menu_item_costs;
  perform pg_temp.assert_true('staff sees zero cost rows', v_visible = 0);
end;
$$;

rollback;
