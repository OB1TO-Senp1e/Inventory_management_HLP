-- ============================================================================
-- P3-02 PO lifecycle: status transitions, send/cancel/receive RPCs.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- 1. `receive_goods` gains optional `p_reference_type` / `p_reference_id`
--    (defaults 'ad_hoc' / null) so PO receives can tag their ledger rows
--    with reference_type='purchase_order', reference_id=<po_id>. The old
--    single-arg signature is dropped (existing callers pass only p_lines,
--    which still resolves via the defaults). Body is otherwise unchanged.
--
-- 2. The P3-01 draft-only guards are replaced:
--    - `po_status_transition_guard()` enforces the legal state machine:
--      draft → sent | cancelled; sent → partially_received | received |
--      cancelled; partially_received → received. received/cancelled are
--      terminal. Once a PO leaves draft, business columns are frozen —
--      only the status itself may change (driven by the lifecycle RPCs).
--    - `po_lines_guard()` relaxes line edits for receives: INSERT/DELETE
--      still draft-only; on sent/partially_received POs ONLY
--      received_quantity may change, monotonically and never above
--      quantity; received/cancelled POs are fully frozen; drafts keep
--      received_quantity at 0.
--
-- 3. New SECURITY DEFINER RPCs (owner/manager only; staff have no PO
--    access — costs): `send_purchase_order`, `cancel_purchase_order`,
--    `receive_purchase_order`. The receive RPC validates each line
--    (received + new <= ordered), posts the ledger via `receive_goods`
--    (reusing its batch/expiry/weighted-average logic), bumps
--    received_quantity, and flips the PO to partially_received/received —
--    all in one transaction. Tenant + role come from JWT claims; writes
--    are pinned to the caller's restaurant (receive_goods precedent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. receive_goods: reference tagging for PO receives
-- ---------------------------------------------------------------------------

drop function if exists public.receive_goods(jsonb);
create or replace function public.receive_goods(
  p_lines jsonb,
  p_reference_type text default 'ad_hoc',
  p_reference_id uuid default null
)
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
  if p_reference_type is null or btrim(p_reference_type) = '' then
    raise exception 'receive_goods: reference_type cannot be empty.';
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
      batch_no, expiry_date, unit_cost, reference_type, reference_id,
      notes, created_by
    ) values (
      v_restaurant_id, v_item_id, 'receipt', v_quantity,
      v_batch_no, v_expiry, v_unit_cost, p_reference_type, p_reference_id,
      v_notes, v_created_by
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

comment on function public.receive_goods(jsonb, text, uuid) is
  'Ad hoc goods receiving (SECURITY DEFINER: staff may receive per the role matrix but RLS denies them item reads and the avg-cost update; the function enforces tenant+role itself and pins writes to the caller''s restaurant). Posts receipt movements with batch/expiry/unit-cost, recalculates weighted-average cost, atomic per call. Expiry optional; when provided it must be today or later.';

-- ---------------------------------------------------------------------------
-- 2. Status-transition guard (replaces the P3-01 draft-only guard)
-- ---------------------------------------------------------------------------

drop trigger if exists trg_purchase_orders_draft_only on public.purchase_orders;
drop function if exists public.po_draft_only_guard();

create or replace function public.po_status_transition_guard()
returns trigger
language plpgsql
as $$
begin
  -- Legal transitions. received/cancelled are terminal: nothing leaves them.
  if old.status = new.status then
    -- Same-status writes: drafts remain fully editable; otherwise only a
    -- no-op status write is allowed (business columns stay frozen).
    if old.status <> 'draft' then
      -- fall through to the frozen-columns check
    else
      return new;
    end if;
  elsif old.status = 'draft' and new.status in ('sent', 'cancelled') then
    -- ok
  elsif old.status = 'sent'
    and new.status in ('partially_received', 'received', 'cancelled') then
    -- ok
  elsif old.status = 'partially_received' and new.status = 'received' then
    -- ok
  else
    raise exception 'purchase_orders: illegal status transition from % to %.',
      old.status, new.status;
  end if;

  -- Once a PO leaves draft, business columns are frozen; only the status
  -- itself may change (driven by the lifecycle RPCs below).
  if old.status <> 'draft' then
    if new.supplier_id is distinct from old.supplier_id
       or new.restaurant_id is distinct from old.restaurant_id
       or new.order_date is distinct from old.order_date
       or new.expected_date is distinct from old.expected_date
       or new.notes is distinct from old.notes
       or new.created_by is distinct from old.created_by then
      raise exception 'purchase_orders: only draft purchase orders can be edited (status is %).',
        old.status;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.po_status_transition_guard() is
  'P3-02: enforces the PO status state machine (draft → sent/cancelled; sent → partially_received/received/cancelled; partially_received → received) and freezes business columns once a PO leaves draft.';

create trigger trg_purchase_orders_status_guard
  before update on public.purchase_orders
  for each row execute function public.po_status_transition_guard();

-- ---------------------------------------------------------------------------
-- 3. Line guard (replaces the P3-01 draft-only line guard)
-- ---------------------------------------------------------------------------

drop trigger if exists trg_purchase_order_lines_draft_only on public.purchase_order_lines;
drop function if exists public.po_lines_draft_only_guard();

create or replace function public.po_lines_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_po_id uuid := coalesce(new.po_id, old.po_id);
begin
  select status into v_status
  from public.purchase_orders
  where id = v_po_id;

  if tg_op = 'INSERT' then
    if v_status is distinct from 'draft' then
      raise exception 'purchase_order_lines: lines can only be added to draft purchase orders (status is %).',
        v_status;
    end if;
    if new.received_quantity <> 0 then
      raise exception 'purchase_order_lines: received_quantity must start at 0.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_status is distinct from 'draft' then
      raise exception 'purchase_order_lines: lines can only be removed from draft purchase orders (status is %).',
        v_status;
    end if;
    return old;
  end if;

  -- UPDATE
  if v_status = 'draft' then
    if new.received_quantity <> 0 then
      raise exception 'purchase_order_lines: cannot receive against a draft purchase order.';
    end if;
    if new.received_quantity > new.quantity then
      raise exception 'purchase_order_lines: received_quantity (%) cannot exceed quantity (%).',
        new.received_quantity, new.quantity;
    end if;
    return new;
  end if;

  if v_status in ('sent', 'partially_received') then
    -- Receive flow: ONLY received_quantity may change — monotonically and
    -- never above the ordered quantity.
    if new.po_id is distinct from old.po_id
       or new.item_id is distinct from old.item_id
       or new.quantity is distinct from old.quantity
       or new.unit_price is distinct from old.unit_price
       or new.notes is distinct from old.notes then
      raise exception 'purchase_order_lines: only received_quantity can change on a % purchase order.',
        v_status;
    end if;
    if new.received_quantity < old.received_quantity then
      raise exception 'purchase_order_lines: received_quantity cannot decrease (% → %).',
        old.received_quantity, new.received_quantity;
    end if;
    if new.received_quantity > new.quantity then
      raise exception 'purchase_order_lines: received_quantity (%) cannot exceed quantity (%).',
        new.received_quantity, new.quantity;
    end if;
    return new;
  end if;

  raise exception 'purchase_order_lines: lines of a % purchase order cannot be changed.', v_status;
end;
$$;

comment on function public.po_lines_guard() is
  'P3-02: line INSERT/DELETE stay draft-only; on sent/partially_received POs only received_quantity may change (monotonic, <= quantity); received/cancelled POs are frozen.';

create trigger trg_purchase_order_lines_guard
  before insert or update or delete on public.purchase_order_lines
  for each row execute function public.po_lines_guard();

-- ---------------------------------------------------------------------------
-- 4. Lifecycle RPCs (SECURITY DEFINER: owner/manager only)
-- ---------------------------------------------------------------------------

create or replace function public.send_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_status text;
  v_line_count int;
begin
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'send_purchase_order: requires owner or manager role.';
  end if;
  if v_restaurant_id is null then
    raise exception 'send_purchase_order: no restaurant in session.';
  end if;

  select status into v_status
  from public.purchase_orders
  where id = p_po_id and restaurant_id = v_restaurant_id
  for update;
  if not found then
    raise exception 'send_purchase_order: purchase order not found in your restaurant.';
  end if;
  if v_status <> 'draft' then
    raise exception 'send_purchase_order: only draft purchase orders can be sent (status is %).',
      v_status;
  end if;

  select count(*) into v_line_count
  from public.purchase_order_lines
  where po_id = p_po_id;
  if v_line_count = 0 then
    raise exception 'send_purchase_order: cannot send a purchase order with no lines.';
  end if;

  update public.purchase_orders set status = 'sent' where id = p_po_id;
end;
$$;

comment on function public.send_purchase_order(uuid) is
  'P3-02: draft → sent (SECURITY DEFINER, owner/manager only). Requires at least one line.';

create or replace function public.cancel_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_status text;
begin
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'cancel_purchase_order: requires owner or manager role.';
  end if;
  if v_restaurant_id is null then
    raise exception 'cancel_purchase_order: no restaurant in session.';
  end if;

  select status into v_status
  from public.purchase_orders
  where id = p_po_id and restaurant_id = v_restaurant_id
  for update;
  if not found then
    raise exception 'cancel_purchase_order: purchase order not found in your restaurant.';
  end if;
  if v_status not in ('draft', 'sent') then
    raise exception 'cancel_purchase_order: only draft or sent purchase orders can be cancelled (status is %).',
      v_status;
  end if;

  update public.purchase_orders set status = 'cancelled' where id = p_po_id;
end;
$$;

comment on function public.cancel_purchase_order(uuid) is
  'P3-02: draft/sent → cancelled (SECURITY DEFINER, owner/manager only). received/cancelled are terminal.';

create or replace function public.receive_purchase_order(p_po_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_status text;
  v_line jsonb;
  v_idx int := 0;
  v_po_line_id uuid;
  v_qty numeric;
  v_item_id uuid;
  v_unit_price numeric;
  v_ordered numeric;
  v_received numeric;
  v_receive_input jsonb := '[]'::jsonb;
  v_all_received boolean;
  v_new_status text;
  v_result jsonb;
begin
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'receive_purchase_order: requires owner or manager role.';
  end if;
  if v_restaurant_id is null then
    raise exception 'receive_purchase_order: no restaurant in session.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'receive_purchase_order: lines must be a JSON array.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'receive_purchase_order: nothing to receive.';
  end if;

  -- Lock the PO: concurrent receives serialize here.
  select status into v_status
  from public.purchase_orders
  where id = p_po_id and restaurant_id = v_restaurant_id
  for update;
  if not found then
    raise exception 'receive_purchase_order: purchase order not found in your restaurant.';
  end if;
  if v_status not in ('sent', 'partially_received') then
    raise exception 'receive_purchase_order: can only receive against sent purchase orders (status is %).',
      v_status;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    begin
      v_po_line_id := (v_line ->> 'po_line_id')::uuid;
    exception when others then
      raise exception 'receive_purchase_order: line %: po_line_id is not a valid UUID.', v_idx;
    end;
    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when others then
      raise exception 'receive_purchase_order: line %: quantity must be a number.', v_idx;
    end;
    if v_po_line_id is null then
      raise exception 'receive_purchase_order: line %: po_line_id is required.', v_idx;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'receive_purchase_order: line %: quantity must be greater than zero.', v_idx;
    end if;

    select item_id, unit_price, quantity, received_quantity
      into v_item_id, v_unit_price, v_ordered, v_received
    from public.purchase_order_lines
    where id = v_po_line_id and po_id = p_po_id and restaurant_id = v_restaurant_id
    for update;
    if not found then
      raise exception 'receive_purchase_order: line %: purchase order line not found on this order.', v_idx;
    end if;
    if v_received + v_qty > v_ordered then
      raise exception 'receive_purchase_order: line %: receiving % would exceed the ordered quantity % (already received %).',
        v_idx, v_qty, v_ordered, v_received;
    end if;

    -- Stage for receive_goods: unit cost is the PO's snapshotted price.
    v_receive_input := v_receive_input || jsonb_build_object(
      'item_id', v_item_id,
      'quantity', v_qty,
      'unit_cost', v_unit_price,
      'batch_no', nullif(btrim(v_line ->> 'batch_no'), ''),
      'expiry_date', nullif(v_line ->> 'expiry_date', ''),
      'notes', nullif(btrim(v_line ->> 'notes'), '')
    );

    update public.purchase_order_lines
    set received_quantity = received_quantity + v_qty
    where id = v_po_line_id;
  end loop;

  -- Post the ledger movements, tagged back to this PO. Any failure rolls
  -- back the received_quantity bumps above (single transaction).
  perform public.receive_goods(v_receive_input, 'purchase_order', p_po_id);

  select bool_and(received_quantity >= quantity)
    into v_all_received
  from public.purchase_order_lines
  where po_id = p_po_id;
  v_new_status := case when coalesce(v_all_received, true)
                       then 'received' else 'partially_received' end;

  update public.purchase_orders set status = v_new_status where id = p_po_id;

  select jsonb_build_object(
    'po_id', p_po_id,
    'status', v_new_status,
    'lines', (select jsonb_agg(jsonb_build_object(
                'po_line_id', id,
                'item_id', item_id,
                'quantity', quantity,
                'received_quantity', received_quantity
              ) order by item_id)
              from public.purchase_order_lines where po_id = p_po_id)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.receive_purchase_order(uuid, jsonb) is
  'P3-02: receive against a sent/partially_received PO (SECURITY DEFINER, owner/manager only). Validates received+new <= ordered per line, posts receipt movements via receive_goods (reference purchase_order/<po_id>, PO unit-price snapshot as cost), bumps received_quantity, flips status to partially_received/received — atomically.';

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

grant execute on function public.receive_goods(jsonb, text, uuid) to authenticated;
grant execute on function public.send_purchase_order(uuid) to authenticated;
grant execute on function public.cancel_purchase_order(uuid) to authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb) to authenticated;
