-- ============================================================================
-- P4-04 — Insufficient-stock handling for record_sales.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- 1. `stock_movements.over_sale` (boolean, default false): TRUE when this
--    movement took the item's stock below zero. Set at INSERT time by
--    `record_sales` (currently the only writer that can go negative on
--    purpose); the append-only ledger never updates it afterwards. A real
--    column — not notes-parsing — so reports can filter on it.
--
-- 2. `audit_log` table: generic, append-only audit trail. Writes ONLY from
--    SECURITY DEFINER RPCs (zero write policies, like supplier_price_history);
--    owner/manager can SELECT their own restaurant's entries, staff see
--    nothing. P4-04 writes one 'over_sale' row per sales entry that flags
--    any movement; P5-06 (user management) and P6 (security pass) will reuse
--    the same table for their entries.
--
-- 3. `compute_sales_deductions(p_lines jsonb)`: the recipe explosion that
--    used to live inline in record_sales — per-(dish, ingredient) deduction
--    in the item's base unit (same-unit factor 1, else the one-hop
--    unit_conversions factor; a missing conversion raises). Dish validation
--    (exists, active, in-restaurant, has recipe) lives here so both callers
--    share one source of truth. SECURITY DEFINER, tenant + owner/manager
--    role enforced from the JWT claims.
--
-- 4. `preview_sales_deductions(p_lines jsonb)`: joins the helper with
--    `current_stock` → per-item current / deduction / projected quantities +
--    would_go_negative. Called by the UI BEFORE submit to render the
--    over-sale warning (the DB is the check's home — the client only
--    displays). SECURITY DEFINER, tenant + owner/manager role enforced.
--
-- 5. `record_sales` (replaced, never edited in place): now loops over
--    `compute_sales_deductions`, sets `over_sale` on each movement from the
--    live current stock, and writes one `audit_log` row (action
--    'over_sale') when any movement is flagged. The signature and summary
--    shape are unchanged.
--
-- Race note: the preview and the post are separate transactions, so stock
-- can move between them. The warning is best-effort UX; the over_sale flag
-- and the audit entry are authoritative and always computed server-side at
-- post time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. over_sale flag on the ledger
-- ---------------------------------------------------------------------------

alter table public.stock_movements
  add column if not exists over_sale boolean not null default false;

comment on column public.stock_movements.over_sale is
  'True when this movement took the item''s stock below zero (set at INSERT time by record_sales; the append-only ledger never updates it).';

-- ---------------------------------------------------------------------------
-- 2. audit_log: generic, append-only audit trail
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  action text not null,
  entity_type text null,
  entity_id uuid null,
  details jsonb null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only audit trail. Rows are written only by SECURITY DEFINER RPCs (no write policies); owner/manager can read their own restaurant''s entries, staff see nothing.';

comment on column public.audit_log.action is
  'Machine-readable action key, e.g. ''over_sale''.';

comment on column public.audit_log.details is
  'Structured payload for the entry (sale date, flagged items, …) — jsonb so each action can carry its own shape.';

create index audit_log_restaurant_id_idx on public.audit_log (restaurant_id);
create index audit_log_action_idx on public.audit_log (action);
create index audit_log_created_at_idx on public.audit_log (created_at);

-- Append-only: reject any UPDATE or DELETE, even for the table owner.
create or replace function public.reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not allowed.', TG_OP;
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_log_mutation();

-- ACL: SELECT only — no write policies below, so direct writes are denied.
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

-- Owner/manager: read their own restaurant's entries. Staff: no policy —
-- every staff query is denied (audit entries can reference costs).
create policy audit_log_select_manager on public.audit_log
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

-- ---------------------------------------------------------------------------
-- 3. compute_sales_deductions: shared recipe explosion
-- ---------------------------------------------------------------------------

create or replace function public.compute_sales_deductions(
  p_lines jsonb
)
returns table (
  menu_item_id uuid,
  menu_name text,
  dishes numeric,
  item_id uuid,
  item_name text,
  unit_symbol text,
  deduction_base_qty numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_line_count integer;
  v_menu_id uuid;
  v_menu_name text;
  v_yield numeric;
  v_dishes numeric;
  v_seen uuid[] := '{}';
  v_ing record;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'compute_sales_deductions: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'compute_sales_deductions: your role cannot record sales.';
  end if;

  -- Input shape -------------------------------------------------------------
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'compute_sales_deductions: lines must be a JSON array.';
  end if;
  v_line_count := jsonb_array_length(p_lines);
  if v_line_count = 0 then
    raise exception 'compute_sales_deductions: at least one dish is required.';
  end if;

  -- Per-line validation + recipe explosion ----------------------------------
  for v_menu_id, v_dishes in
    select
      (line ->> 'menu_item_id')::uuid,
      (line ->> 'dishes')::numeric
    from jsonb_array_elements(p_lines) as line
  loop
    if v_menu_id is null then
      raise exception 'compute_sales_deductions: every line needs a menu_item_id.';
    end if;
    if v_menu_id = any (v_seen) then
      raise exception 'compute_sales_deductions: duplicate dish in one entry — aggregate dishes per dish first.';
    end if;
    v_seen := v_seen || v_menu_id;

    if v_dishes is null or v_dishes <= 0 then
      raise exception 'compute_sales_deductions: dishes must be greater than zero (got %).', v_dishes;
    end if;

    -- Menu item: must exist, be active, belong to this restaurant.
    select mi.name, mi.yield_quantity
      into v_menu_name, v_yield
      from public.menu_items mi
     where mi.id = v_menu_id
       and mi.restaurant_id = v_restaurant_id;
    if not found then
      raise exception 'compute_sales_deductions: menu item % not found in your restaurant.', v_menu_id;
    end if;
    if not (select active from public.menu_items where id = v_menu_id) then
      raise exception 'compute_sales_deductions: menu item "%" is archived.', v_menu_name;
    end if;

    if not exists (
      select 1 from public.recipe_ingredients ri
       where ri.menu_item_id = v_menu_id
         and ri.restaurant_id = v_restaurant_id
    ) then
      raise exception 'compute_sales_deductions: "%" has no recipe — add ingredients before recording sales.', v_menu_name;
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
          'compute_sales_deductions: cannot convert the recipe unit of "%" to its base unit.',
          v_ing.item_name;
      end if;
      menu_item_id := v_menu_id;
      menu_name := v_menu_name;
      dishes := v_dishes;
      item_id := v_ing.item_id;
      item_name := v_ing.item_name;
      unit_symbol := v_ing.unit_symbol;
      deduction_base_qty := v_ing.deduction_base_qty;
      return next;
    end loop;
  end loop;

  return;
end;
$$;

comment on function public.compute_sales_deductions(jsonb) is
  'Shared recipe explosion for sales: per-(dish, ingredient) deduction in the item''s base unit. Validates dishes (exists, active, in-restaurant, has recipe). Used by record_sales and preview_sales_deductions.';

grant execute on function public.compute_sales_deductions(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. preview_sales_deductions: the pre-submit over-sale check
-- ---------------------------------------------------------------------------

create or replace function public.preview_sales_deductions(
  p_lines jsonb
)
returns table (
  item_id uuid,
  item_name text,
  unit_symbol text,
  current_quantity numeric,
  deduction_quantity numeric,
  projected_quantity numeric,
  would_go_negative boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null then
    raise exception 'preview_sales_deductions: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'preview_sales_deductions: your role cannot record sales.';
  end if;

  -- One row per inventory item (aggregated across dishes, exactly as
  -- record_sales will post it), with the live current stock.
  return query
    select
      d.item_id,
      max(d.item_name),
      max(d.unit_symbol),
      coalesce(max(cs.quantity), 0),
      sum(d.deduction_base_qty),
      coalesce(max(cs.quantity), 0) - sum(d.deduction_base_qty),
      coalesce(max(cs.quantity), 0) - sum(d.deduction_base_qty) < 0
    from public.compute_sales_deductions(p_lines) d
    left join public.current_stock cs
      on cs.restaurant_id = v_restaurant_id
     and cs.item_id = d.item_id
    group by d.item_id;
end;
$$;

comment on function public.preview_sales_deductions(jsonb) is
  'Pre-submit over-sale check: per-item deduction vs live current stock. The UI shows the warning; record_sales still computes the flag itself at post time (separate transactions can race).';

grant execute on function public.preview_sales_deductions(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. record_sales: flag over-sale movements + write the audit entry
-- ---------------------------------------------------------------------------

create or replace function public.record_sales(
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
  -- Accumulated deductions keyed by inventory item id.
  v_item_qty numeric[];
  v_item_ids uuid[];
  v_item_names text[];
  v_item_symbols text[];
  v_dish_notes text[];
  v_summary_ingredients jsonb := '[]'::jsonb;
  v_summary_lines jsonb := '[]'::jsonb;
  v_flagged_items jsonb := '[]'::jsonb;
  v_row record;
  v_seen_menu uuid[] := '{}';
  v_idx integer;
  v_item_id uuid;
  v_item_name text;
  v_current_qty numeric;
  v_over_sale boolean;
  v_any_over_sale boolean := false;
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

  -- Shared recipe explosion (validates dishes, guards, conversion) ---------
  for v_row in select * from public.compute_sales_deductions(p_lines) loop
    v_idx := array_position(v_item_ids, v_row.item_id);
    if v_idx is null then
      v_item_ids := coalesce(v_item_ids, '{}') || v_row.item_id;
      v_item_qty := coalesce(v_item_qty, '{}') || v_row.deduction_base_qty;
      v_item_names := coalesce(v_item_names, '{}') || v_row.item_name;
      v_item_symbols := coalesce(v_item_symbols, '{}') || v_row.unit_symbol;
      v_dish_notes := coalesce(v_dish_notes, '{}')
        || format('%s x%s', v_row.menu_name, regexp_replace(to_char(v_row.dishes, 'FM999999999999990.099999'), '\.?0+$', ''));
    else
      v_item_qty[v_idx] := v_item_qty[v_idx] + v_row.deduction_base_qty;
      v_dish_notes[v_idx] := v_dish_notes[v_idx]
        || format(', %s x%s', v_row.menu_name, regexp_replace(to_char(v_row.dishes, 'FM999999999999990.099999'), '\.?0+$', ''));
    end if;

    -- Per-dish summary (one entry per dish, in first-seen order).
    if not (v_row.menu_item_id = any (v_seen_menu)) then
      v_seen_menu := v_seen_menu || v_row.menu_item_id;
      v_summary_lines := v_summary_lines || jsonb_build_object(
        'menu_item_id', v_row.menu_item_id,
        'name', v_row.menu_name,
        'dishes', v_row.dishes
      );
    end if;
  end loop;

  -- Post one aggregated movement per inventory item --------------------------
  if v_item_ids is null then
    raise exception 'record_sales: no ingredients to deduct.';
  end if;

  for v_idx in 1 .. array_length(v_item_ids, 1) loop
    v_item_id := v_item_ids[v_idx];
    v_item_name := v_item_names[v_idx];
    v_notes := format('Sale %s: %s', to_char(v_sale_date, 'YYYY-MM-DD'), v_dish_notes[v_idx]);

    -- The over_sale flag is computed here, at post time, from the live
    -- current stock — never from the client's preview (transactions race).
    select coalesce(cs.quantity, 0) into v_current_qty
      from public.current_stock cs
     where cs.restaurant_id = v_restaurant_id
       and cs.item_id = v_item_id;
    v_over_sale := (v_current_qty - v_item_qty[v_idx]) < 0;

    insert into public.stock_movements (
      restaurant_id, item_id, movement_type, quantity, notes, created_by, over_sale
    ) values (
      v_restaurant_id, v_item_id, 'sale_deduction', -v_item_qty[v_idx],
      v_notes, v_created_by, v_over_sale
    );

    if v_over_sale then
      v_any_over_sale := true;
      v_flagged_items := v_flagged_items || jsonb_build_object(
        'item_id', v_item_id,
        'name', v_item_name,
        'unit_symbol', v_item_symbols[v_idx],
        'current_quantity', v_current_qty,
        'deduction_quantity', v_item_qty[v_idx],
        'projected_quantity', v_current_qty - v_item_qty[v_idx]
      );
    end if;

    v_summary_ingredients := v_summary_ingredients || jsonb_build_object(
      'item_id', v_item_id,
      'name', v_item_name,
      'quantity', v_item_qty[v_idx],
      'unit_symbol', v_item_symbols[v_idx]
    );
  end loop;

  -- Audit: one entry per over-sale call (not per movement) -------------------
  if v_any_over_sale then
    insert into public.audit_log (
      restaurant_id, action, entity_type, details, created_by
    ) values (
      v_restaurant_id,
      'over_sale',
      'stock_movement',
      jsonb_build_object(
        'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
        'lines', v_summary_lines,
        'flagged_items', v_flagged_items
      ),
      v_created_by
    );
  end if;

  return jsonb_build_object(
    'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
    'lines', v_summary_lines,
    'ingredients', v_summary_ingredients
  );
end;
$$;

comment on function public.record_sales(jsonb, date) is
  'Record a day''s sales: explodes each dish''s recipe into per-ingredient sale_deduction movements (base units, aggregated per item). Owner/manager only. Movements that take stock below zero are flagged over_sale=true and one audit_log ''over_sale'' row is written per call.';

grant execute on function public.record_sales(jsonb, date) to authenticated;
