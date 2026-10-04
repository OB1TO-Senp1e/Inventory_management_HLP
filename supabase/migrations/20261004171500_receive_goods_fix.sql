-- ============================================================================
-- P2-02 follow-up — fix double-counting in receive_goods.
--
-- The base migration computed the running stock as
--   current_stock + SUM(lines already posted in this receipt).
-- That is wrong: inside one transaction PostgreSQL sees its own
-- uncommitted inserts, so the `current_stock` view ALREADY includes the
-- earlier lines of the same receipt. Adding them again double-counted
-- (a 10+10 receipt at 40/60 averaged to 46.67 instead of 50).
--
-- Fix: read the running quantity straight from the view. The
-- `items.avg_unit_cost` row (updated per line) supplies the running
-- average, so multi-line receipts for one item average correctly with no
-- extra bookkeeping.
-- ============================================================================

create or replace function public.receive_goods(p_lines jsonb)
returns jsonb
language plpgsql
security invoker
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

  -- Tenant + role --------------------------------------------------------------
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
    -- receipt for the same item are already included — do NOT add them
    -- again (that was the double-counting bug fixed here). v_old_avg is
    -- the per-line running average, updated on items below.
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
  'Ad hoc goods receiving: posts receipt movements with batch/expiry/unit-cost and recalculates weighted-average cost. Atomic per call; owner/manager/staff. Expiry optional (no is_perishable column); when provided it must be today or later.';
