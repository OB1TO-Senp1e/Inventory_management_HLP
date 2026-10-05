-- ============================================================================
-- P4-03 — record_sales RPC: explode recipes into sale_deduction movements.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `record_sales(p_lines jsonb, p_sale_date date default current_date)` —
-- one call posts a full day's sales entry: each line is one dish with the
-- number of servings/units sold. For every recipe ingredient the function
-- computes
--
--   deduction = dishes x ingredient.quantity / menu_items.yield_quantity
--
-- converted to the inventory item's BASE unit (the recipe builder trigger
-- guarantees the ingredient unit is the base unit or directly convertible —
-- one-hop only in v1, via `unit_conversions`).
--
-- Each distinct inventory item gets ONE aggregated `sale_deduction` movement
-- (negative quantity, base unit): this is what "daily entry aggregates"
-- means — a dish sold twice in a day, or two dishes sharing an ingredient,
-- do not leave duplicate deduction rows. The movement notes carry the sale
-- date and the contributing dishes ("Sale 2026-10-05: Butter Chicken x4"),
-- so the ledger stays human-readable.
--
-- The ledger has no backdated-movement column (created_at is the posting
-- time; the sale date lives in notes). Reports (P5-04) can still group by
-- sale date from notes if needed; a real `occurred_at` column can be added
-- later without changing this signature.
--
-- SECURITY DEFINER, tenant + role enforced inside from the JWT claims —
-- the same rationale as log_wastage/log_usage (this is atomic business
-- logic, ARCHITECTURE.md §2). Role matrix (§7): sales entry is
-- owner/manager only — staff never see recipes/costs.
--
-- Insufficient-stock policy: deducting MORE than current stock is PERMITTED
-- (the movement posts, stock goes negative) — the same "warn + allow"
-- precedent as log_wastage/log_usage (P2-03) and the §8 record_sales
-- philosophy. P4-04 adds the UI warning + explicit confirm, the negative
-- flag on the movement, and the audit entry.
--
-- Guard rails: menu item must exist, be active, belong to the caller's
-- restaurant, and have at least one recipe line. Empty line arrays and
-- non-positive dish counts are rejected.
-- ============================================================================

create function public.record_sales(
  p_lines jsonb,
  p_sale_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_sale_date date := coalesce(p_sale_date, current_date);
  v_line_count integer;
  v_menu_id uuid;
  v_menu_name text;
  v_yield numeric;
  v_dishes numeric;
  v_seen uuid[] := '{}';
  -- Accumulated deductions keyed by inventory item id.
  v_item_qty numeric[];
  v_item_ids uuid[];
  v_item_names text[];
  v_dish_notes text[];
  v_summary_ingredients jsonb := '[]'::jsonb;
  v_summary_lines jsonb := '[]'::jsonb;
  v_ded numeric;
  v_ing record;
  v_idx integer;
  v_item_id uuid;
  v_item_name text;
  v_unit_symbol text;
  v_notes text;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'record_sales: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'record_sales: your role cannot record sales.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Input shape -------------------------------------------------------------
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'record_sales: lines must be a JSON array.';
  end if;
  v_line_count := jsonb_array_length(p_lines);
  if v_line_count = 0 then
    raise exception 'record_sales: at least one dish is required.';
  end if;

  -- Per-line validation + recipe explosion ----------------------------------
  for v_menu_id, v_dishes in
    select
      (line ->> 'menu_item_id')::uuid,
      (line ->> 'dishes')::numeric
    from jsonb_array_elements(p_lines) as line
  loop
    if v_menu_id is null then
      raise exception 'record_sales: every line needs a menu_item_id.';
    end if;
    if v_menu_id = any (v_seen) then
      raise exception 'record_sales: duplicate dish in one entry — aggregate dishes per dish first.';
    end if;
    v_seen := v_seen || v_menu_id;

    if v_dishes is null or v_dishes <= 0 then
      raise exception 'record_sales: dishes must be greater than zero (got %).', v_dishes;
    end if;

    -- Menu item: must exist, be active, belong to this restaurant.
    select mi.name, mi.yield_quantity
      into v_menu_name, v_yield
      from public.menu_items mi
     where mi.id = v_menu_id
       and mi.restaurant_id = v_restaurant_id;
    if not found then
      raise exception 'record_sales: menu item % not found in your restaurant.', v_menu_id;
    end if;
    if not (select active from public.menu_items where id = v_menu_id) then
      raise exception 'record_sales: menu item "%" is archived.', v_menu_name;
    end if;

    -- Explode the recipe: per-ingredient deduction in the item's base unit.
    -- Same-unit lines use factor 1; converted lines use the one-hop factor
    -- (null when no conversion row exists — caught below as an error).
    for v_ing in
      select
        ri.item_id,
        i.name as item_name,
        u.symbol as unit_symbol,
        v_dishes * ri.quantity / v_yield
          * case when ri.unit_id = i.unit_id then 1 else uc.factor end
          as deduction_base_qty
      from public.recipe_ingredients ri
      join public.items i on i.id = ri.item_id
      join public.units u on u.id = i.unit_id
      left join public.unit_conversions uc
        on uc.restaurant_id = v_restaurant_id
       and uc.from_unit_id = ri.unit_id
       and uc.to_unit_id = i.unit_id
     where ri.menu_item_id = v_menu_id
       and ri.restaurant_id = v_restaurant_id
    loop
      if v_ing.deduction_base_qty is null then
        -- No conversion path from the ingredient unit to the base unit.
        -- The recipe builder trigger normally prevents this; belt and
        -- suspenders for recipes written before the guard existed.
        raise exception
          'record_sales: cannot convert the recipe unit of "%" to its base unit.',
          v_ing.item_name;
      end if;
      v_ded := v_ing.deduction_base_qty;
      v_idx := array_position(v_item_ids, v_ing.item_id);
      if v_idx is null then
        v_item_ids := coalesce(v_item_ids, '{}') || v_ing.item_id;
        v_item_qty := coalesce(v_item_qty, '{}') || v_ded;
        v_item_names := coalesce(v_item_names, '{}') || v_ing.item_name;
        v_dish_notes := coalesce(v_dish_notes, '{}')
          || format('%s x%s', v_menu_name, regexp_replace(to_char(v_dishes, 'FM999999999999990.099999'), '\.?0+$', ''));
      else
        v_item_qty[v_idx] := v_item_qty[v_idx] + v_ded;
        v_dish_notes[v_idx] := v_dish_notes[v_idx]
          || format(', %s x%s', v_menu_name, regexp_replace(to_char(v_dishes, 'FM999999999999990.099999'), '\.?0+$', ''));
      end if;
    end loop;

    -- The dish must have at least one recipe line.
    if not exists (
      select 1 from public.recipe_ingredients ri
       where ri.menu_item_id = v_menu_id
         and ri.restaurant_id = v_restaurant_id
    ) then
      raise exception 'record_sales: "%" has no recipe — add ingredients before recording sales.', v_menu_name;
    end if;

    v_summary_lines := v_summary_lines || jsonb_build_object(
      'menu_item_id', v_menu_id,
      'name', v_menu_name,
      'dishes', v_dishes
    );
  end loop;

  -- Post one aggregated movement per inventory item --------------------------
  if v_item_ids is null then
    raise exception 'record_sales: no ingredients to deduct.';
  end if;

  for v_idx in 1 .. array_length(v_item_ids, 1) loop
    v_item_id := v_item_ids[v_idx];
    v_item_name := v_item_names[v_idx];
    v_notes := format('Sale %s: %s', to_char(v_sale_date, 'YYYY-MM-DD'), v_dish_notes[v_idx]);
    select u.symbol into v_unit_symbol
      from public.items i
      join public.units u on u.id = i.unit_id
     where i.id = v_item_id;

    insert into public.stock_movements (
      restaurant_id, item_id, movement_type, quantity, notes, created_by
    ) values (
      v_restaurant_id, v_item_id, 'sale_deduction', -v_item_qty[v_idx],
      v_notes, v_created_by
    );

    v_summary_ingredients := v_summary_ingredients || jsonb_build_object(
      'item_id', v_item_id,
      'name', v_item_name,
      'quantity', v_item_qty[v_idx],
      'unit_symbol', v_unit_symbol
    );
  end loop;

  return jsonb_build_object(
    'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
    'lines', v_summary_lines,
    'ingredients', v_summary_ingredients
  );
end;
$$;

comment on function public.record_sales(jsonb, date) is
  'Record a day''s sales: explodes each dish''s recipe into per-ingredient sale_deduction movements (base units, aggregated per item). Owner/manager only; over-deduction permitted (P4-04 adds warn/confirm/flag/audit).';

grant execute on function public.record_sales(jsonb, date) to authenticated;
