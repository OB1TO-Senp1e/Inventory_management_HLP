-- ============================================================================
-- P3-04: GST rate on purchase orders (for the print/PDF view).
--
-- 1. `purchase_orders.gst_rate` — percent (0–100), defaults to 0. The print
--    view computes GST = subtotal * gst_rate / 100 and a grand total.
--    Snapshotted per PO like unit prices: the rate at order time is what the
--    document shows, so later changes to "the" rate never rewrite history.
--
-- 2. `create_purchase_order` gains `p_gst_rate` (default 0, appended last so
--    existing callers keep working). Range-validated like the column check.
--
-- 3. `po_status_transition_guard` freezes `gst_rate` once the PO leaves
--    draft — it is a business column like order_date/notes.
-- ============================================================================

alter table public.purchase_orders
  add column gst_rate numeric not null default 0
  check (gst_rate >= 0 and gst_rate <= 100);

comment on column public.purchase_orders.gst_rate is
  'P3-04: GST percent applied to the PO subtotal on the print view. Snapshotted at creation; frozen once the PO leaves draft.';

-- ---------------------------------------------------------------------------
-- create_purchase_order: accept the GST rate
-- ---------------------------------------------------------------------------
-- Drop the 5-arg version: PostgreSQL identifies functions by signature, so
-- keeping both would make 5-arg calls ambiguous. The new 6th param has a
-- default, so existing 5-arg callers keep working.

drop function if exists public.create_purchase_order(uuid, date, date, text, jsonb);

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_order_date date,
  p_expected_date date,
  p_notes text,
  p_lines jsonb,
  p_gst_rate numeric default 0
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_po_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_notes text;
  v_supplier_active boolean;
begin
  -- Role gate: the RLS policies would reject the inserts anyway, but fail
  -- fast with a friendly message.
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'create_purchase_order: requires owner or manager role.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'create_purchase_order: lines must be a JSON array.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'create_purchase_order: a purchase order needs at least one line.';
  end if;

  if p_gst_rate is null or p_gst_rate < 0 or p_gst_rate > 100 then
    raise exception 'create_purchase_order: gst_rate must be between 0 and 100.';
  end if;

  select active into v_supplier_active
  from public.suppliers
  where id = p_supplier_id and restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'create_purchase_order: supplier not found in your restaurant.';
  end if;
  if not v_supplier_active then
    raise exception 'create_purchase_order: cannot order from an archived supplier.';
  end if;

  if p_expected_date is not null and p_expected_date < p_order_date then
    raise exception 'create_purchase_order: expected date cannot precede the order date.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  insert into public.purchase_orders
    (restaurant_id, supplier_id, status, order_date, expected_date, notes, gst_rate, created_by)
  values
    (v_restaurant_id, p_supplier_id, 'draft', p_order_date, p_expected_date,
     nullif(p_notes, ''), p_gst_rate, v_created_by)
  returning id into v_po_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_notes := nullif(v_line ->> 'notes', '');

    if v_item_id is null then
      raise exception 'create_purchase_order: every line needs an item_id.';
    end if;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'create_purchase_order: line quantity must be > 0.';
    end if;
    if v_unit_price is null or v_unit_price <= 0 then
      raise exception 'create_purchase_order: line unit_price must be > 0.';
    end if;

    perform 1 from public.items
    where id = v_item_id and restaurant_id = v_restaurant_id and active;
    if not found then
      raise exception 'create_purchase_order: item % not found or archived in your restaurant.', v_item_id;
    end if;

    insert into public.purchase_order_lines
      (restaurant_id, po_id, item_id, quantity, unit_price, notes)
    values
      (v_restaurant_id, v_po_id, v_item_id, v_quantity, v_unit_price, v_line_notes);
  end loop;

  return v_po_id;
end;
$$;

comment on function public.create_purchase_order(uuid, date, date, text, jsonb, numeric) is
  'P3-04: atomically create a draft purchase order with line items (SECURITY INVOKER — caller RLS applies). p_gst_rate snapshots the GST percent on the PO.';

-- ---------------------------------------------------------------------------
-- Status guard: freeze gst_rate once the PO leaves draft
-- ---------------------------------------------------------------------------

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
       or new.gst_rate is distinct from old.gst_rate
       or new.created_by is distinct from old.created_by then
      raise exception 'purchase_orders: only draft purchase orders can be edited (status is %).',
        old.status;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.po_status_transition_guard() is
  'P3-04: enforces the PO status state machine (draft → sent/cancelled; sent → partially_received/received/cancelled; partially_received → received) and freezes business columns (incl. gst_rate) once a PO leaves draft.';
