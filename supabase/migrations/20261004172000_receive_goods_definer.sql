-- ============================================================================
-- P2-02 follow-up 2 — staff item visibility + SECURITY DEFINER receive_goods.
--
-- Two related corrections:
--
-- 1. Staff need READ access to active items. ARCHITECTURE.md §7 and
--    ROUTES.md both grant staff the "receive stock" capability
--    (`/receiving` is owner/manager/staff), and P2-03 gives staff
--    usage/wastage logging — all of which require picking an item in the
--    UI. The P1-01 "staff see zero item rows" rule made those capabilities
--    unusable (empty pickers). New policy `items_select_staff`: staff may
--    SELECT active items in their own restaurant — read-only; insert,
--    update and delete remain denied, and the ItemsPage management UI
--    stays owner/manager-only via the route guard. The P1-01 DB test T3 is
--    updated to assert the new intended behavior.
--
-- 2. `receive_goods` becomes SECURITY DEFINER. The RPC must (a) read the
--    item row and (b) maintain `items.avg_unit_cost` for every role that
--    may receive — including staff, for whom RLS denies both. The function
--    performs its own tenant + role validation (JWT claims) and pins every
--    write to the caller's restaurant, so the definer privilege cannot
--    leak across tenants. `set search_path = public` is fixed (definer
--    safety). Direct table access stays RLS-governed; this is the
--    documented exception for ledger-writing RPCs (ARCHITECTURE.md §11).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Staff read-only visibility of active items (own restaurant)
-- ---------------------------------------------------------------------------

create policy items_select_staff on public.items
  for select to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('staff')
    and active = true
  );

comment on policy items_select_staff on public.items is
  'Staff may read active items in their own restaurant (receiving / usage / wastage pickers). No write access; management UI stays owner/manager-only.';

-- ---------------------------------------------------------------------------
-- 2. receive_goods as SECURITY DEFINER (same body as the fixed version,
--    only the security characteristic changes)
-- ---------------------------------------------------------------------------

create or replace function public.receive_goods(p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_line jsonb;
  v_idx int := 0;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_batch_no text;
  v_expiry date;
  v_notes text;
  v_old_avg numeric;
  v_active boolean;
  v_old_qty numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  -- Envelope validation ------------------------------------------------------
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'receive_goods: lines must be a JSON array of receipt lines.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'receive_goods: receipt must contain at least one line.';
  end if;

  -- Tenant + role (the function's own authority: it runs as definer, so
  -- these checks — not RLS — are what keep tenants and roles apart) --------
  if v_restaurant_id is null then
    raise exception 'receive_goods: no restaurant in session.';
  end if;
  if not (
    public.has_role('owner')
    or public.has_role('manager')
    or public.has_role('staff')
  ) then
    raise exception 'receive_goods: your role cannot receive stock.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Lines: validated and posted one by one inside this single transaction.
  -- Any exception below aborts the whole receipt (atomicity).
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;

    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'receive_goods: line % must be an object.', v_idx;
    end if;

    -- Per-line input validation ---------------------------------------------
    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
    exception when others then
      raise exception 'receive_goods: line %: item_id is not a valid UUID.', v_idx;
    end;
    if v_item_id is null then
      raise exception 'receive_goods: line %: item_id is required.', v_idx;
    end if;

    begin
      v_quantity := (v_line ->> 'quantity')::numeric;
    exception when others then
      raise exception 'receive_goods: line %: quantity must be a number.', v_idx;
    end;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'receive_goods: line %: quantity must be greater than zero (got %).', v_idx, v_quantity;
    end if;

    begin
      v_unit_cost := (v_line ->> 'unit_cost')::numeric;
    exception when others then
      raise exception 'receive_goods: line %: unit_cost must be a number.', v_idx;
    end;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'receive_goods: line %: unit cost cannot be negative (got %).', v_idx, v_unit_cost;
    end if;

    v_batch_no := nullif(trim(v_line ->> 'batch_no'), '');
    v_notes := nullif(trim(v_line ->> 'notes'), '');

    begin
      v_expiry := nullif(v_line ->> 'expiry_date', '')::date;
    exception when others then
      raise exception 'receive_goods: line %: expiry_date must be a valid date (YYYY-MM-DD).', v_idx;
    end;
    if v_expiry is not null and v_expiry < current_date then
      raise exception 'receive_goods: line %: expiry date % is in the past.', v_idx, v_expiry;
    end if;

    -- Item must exist, be active, and belong to the caller's restaurant -----
    select i.avg_unit_cost, i.active
      into v_old_avg, v_active
      from public.items i
     where i.id = v_item_id
       and i.restaurant_id = v_restaurant_id;
    if not found then
      raise exception 'receive_goods: line %: item % not found in your restaurant.', v_idx, v_item_id;
    end if;
    if not v_active then
      raise exception 'receive_goods: line %: item % is archived.', v_idx, v_item_id;
    end if;

    -- Stock before this line, straight from the view. The view sees this
    -- transaction's own uncommitted inserts, so earlier lines of the same
    -- receipt for the same item are already included. v_old_avg is the
    -- per-line running average, updated on items below.
    select coalesce(
        (select cs.quantity
           from public.current_stock cs
          where cs.item_id = v_item_id
            and cs.restaurant_id = v_restaurant_id),
        0)
      into v_old_qty;

    if v_old_qty > 0 then
      v_new_avg := (v_old_qty * v_old_avg + v_quantity * v_unit_cost)
                   / (v_old_qty + v_quantity);
    else
      v_new_avg := v_unit_cost;
    end if;

    -- Post the ledger row ----------------------------------------------------
    insert into public.stock_movements (
      restaurant_id, item_id, movement_type, quantity,
      batch_no, expiry_date, unit_cost, reference_type, notes, created_by
    ) values (
      v_restaurant_id, v_item_id, 'receipt', v_quantity,
      v_batch_no, v_expiry, v_unit_cost, 'ad_hoc', v_notes, v_created_by
    )
    returning id into v_movement_id;

    update public.items
       set avg_unit_cost = v_new_avg
     where id = v_item_id;

    v_results := v_results || jsonb_build_object(
      'movement_id', v_movement_id,
      'item_id', v_item_id,
      'quantity', v_quantity,
      'unit_cost', v_unit_cost,
      'old_avg_cost', v_old_avg,
      'new_avg_cost', v_new_avg
    );
  end loop;

  return v_results;
end;
$$;

comment on function public.receive_goods(jsonb) is
  'Ad hoc goods receiving (SECURITY DEFINER: staff may receive per the role matrix but RLS denies them item reads and the avg-cost update; the function enforces tenant+role itself and pins writes to the caller''s restaurant). Posts receipt movements with batch/expiry/unit-cost, recalculates weighted-average cost, atomic per call. Expiry optional; when provided it must be today or later.';
