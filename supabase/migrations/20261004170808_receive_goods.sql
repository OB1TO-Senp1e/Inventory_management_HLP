-- ============================================================================
-- P2-02 — receive_goods RPC: ad hoc goods receiving against the ledger.
--
-- `receive_goods(p_lines jsonb)` posts one `stock_movements` row per line
-- (movement_type = 'receipt', positive quantity in the item's BASE UNIT —
-- unit conversion lands in P2-05 and is deliberately NOT handled here) and
-- recalculates each item's weighted-average unit cost in the same
-- transaction. All lines are atomic: a single invalid line aborts the whole
-- receipt with an error naming the line number.
--
-- Follows the `create_opening_balance` template (P2-01): validate inputs →
-- validate tenant/role → single transaction → friendly exceptions.
--
-- Role policy (ARCHITECTURE.md §7, ROUTES.md `/receiving`): owner, manager
-- AND staff may receive stock. Staff cannot set opening balances (P2-01)
-- but they can receive deliveries.
--
-- Design notes:
--   * `reference_type = 'ad_hoc'` distinguishes these receipts from PO
--     receipts. P3-02 will extend this RPC (or add a wrapper) to link
--     lines to purchase orders; this version accepts no PO reference.
--   * `items.is_perishable` does NOT exist in this schema, so `expiry_date`
--     is optional. When provided it must be today or later — recording a
--     receipt of already-expired stock is a data error. (Noted in
--     PROGRESS.md Run 14.)
--   * Weighted average: new_avg = (old_qty*old_avg + qty*cost)/(old_qty+qty),
--     where old_qty is current stock BEFORE this receipt (from the
--     `current_stock` view) PLUS any earlier lines for the same item in the
--     same call, and old_avg is `items.avg_unit_cost` as updated line by
--     line. Zero prior stock → avg = line cost.
--   * Returns jsonb: one object per line with movement_id, item_id,
--     quantity, unit_cost, old_avg_cost, new_avg_cost — the UI renders the
--     receipt report from this, never by recomputing cost.
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
  v_received_so_far numeric;
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

    -- Stock before this line: current stock + earlier lines for the same
    -- item in this receipt (their rows are in-flight, invisible to the
    -- view, so they are added explicitly).
    select coalesce(sum((r ->> 'quantity')::numeric), 0)
      into v_received_so_far
      from jsonb_array_elements(v_results) r
     where (r ->> 'item_id')::uuid = v_item_id;
    select coalesce(cs.quantity, 0) + v_received_so_far
      into v_old_qty
      from (select 1) dummy
      left join public.current_stock cs
        on cs.item_id = v_item_id
       and cs.restaurant_id = v_restaurant_id;

    -- Weighted average (v_old_avg is the per-line running average, already
    -- updated by earlier lines for this item).
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

grant execute on function public.receive_goods(jsonb) to authenticated;
