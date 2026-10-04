-- ============================================================================
-- P3-01 purchase orders: schema for draft POs with line items.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `purchase_orders` — one row per purchase order. Status lifecycle
-- (draft → sent → partially_received → received, plus cancelled) is
-- enforced by P3-02; this migration only creates the status column and a
-- draft-only edit guard. P3-01 creates draft POs with lines.
--
-- `purchase_order_lines` — one row per (PO, item). `unit_price` is a
-- snapshot of the supplier's price at PO creation (prices change; the PO
-- must remember what was agreed). `quantity` is the ordered quantity in
-- the item's base unit; `received_quantity` tracks partial receives and
-- is maintained by P3-02's receive flow (defaults 0 here).
--
-- Money is numeric, never float (ARCHITECTURE.md §5).
--
-- RLS: owner/manager full access in their own restaurant on both tables.
-- Staff have NO policies on either table: every staff query is denied
-- (per the role matrix in ARCHITECTURE.md §7 — POs carry costs and staff
-- cannot see costs).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- purchase_orders
-- ---------------------------------------------------------------------------

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'partially_received', 'received', 'cancelled')),
  order_date date not null default current_date,
  expected_date date check (expected_date is null or expected_date >= order_date),
  notes text check (notes is null or char_length(notes) between 1 and 1000),
  created_at timestamptz not null default now(),
  -- created_by is audit metadata; intentionally no FK to auth.users so that
  -- deleting an auth user never cascades into business data.
  created_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.purchase_orders is
  'Purchase orders to suppliers. Status lifecycle enforced by P3-02; P3-01 creates draft POs.';
comment on column public.purchase_orders.status is
  'Lifecycle state: draft → sent → partially_received → received, or cancelled. Only drafts are editable (trigger).';
comment on column public.purchase_orders.expected_date is
  'Promised delivery date, if known. Must not precede the order date.';

create index purchase_orders_restaurant_id_idx on public.purchase_orders (restaurant_id);
create index purchase_orders_restaurant_status_idx on public.purchase_orders (restaurant_id, status);
create index purchase_orders_supplier_id_idx on public.purchase_orders (supplier_id);

create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- purchase_order_lines
-- ---------------------------------------------------------------------------

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price > 0),
  received_quantity numeric not null default 0 check (received_quantity >= 0),
  notes text check (notes is null or char_length(notes) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (po_id, item_id)
);

comment on table public.purchase_order_lines is
  'Line items of a purchase order. unit_price is a snapshot at PO creation; quantity is the ordered quantity in the item''s base unit.';
comment on column public.purchase_order_lines.received_quantity is
  'Quantity received so far against this line (P3-02 receive flow). Never exceeds quantity — enforced by trigger.';

create index purchase_order_lines_po_id_idx on public.purchase_order_lines (po_id);
create index purchase_order_lines_item_id_idx on public.purchase_order_lines (item_id);

create trigger trg_purchase_order_lines_updated_at
  before update on public.purchase_order_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Draft-only guards (P3-01 scope)
--
-- Only draft POs may be edited, and lines may only change while their PO
-- is a draft. P3-02 replaces the PO guard with the full status-transition
-- state machine and relaxes the line guard for receives.
-- ---------------------------------------------------------------------------

create or replace function public.po_draft_only_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' then
    raise exception 'purchase_orders: only draft purchase orders can be edited (status is %).', old.status;
  end if;
  return new;
end;
$$;

comment on function public.po_draft_only_guard() is
  'P3-01: rejects any UPDATE to a non-draft purchase order. P3-02 replaces this with the status-transition state machine.';

create trigger trg_purchase_orders_draft_only
  before update on public.purchase_orders
  for each row execute function public.po_draft_only_guard();

create or replace function public.po_lines_draft_only_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.purchase_orders
  where id = coalesce(new.po_id, old.po_id);
  if v_status is distinct from 'draft' then
    raise exception 'purchase_order_lines: lines can only change while the purchase order is a draft (status is %).', v_status;
  end if;
  if tg_op = 'UPDATE' and new.received_quantity > new.quantity then
    raise exception 'purchase_order_lines: received_quantity (%) cannot exceed quantity (%).', new.received_quantity, new.quantity;
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.po_lines_draft_only_guard() is
  'P3-01: line inserts/updates/deletes require the parent PO to be a draft; received_quantity can never exceed quantity.';

create trigger trg_purchase_order_lines_draft_only
  before insert or update or delete on public.purchase_order_lines
  for each row execute function public.po_lines_draft_only_guard();

-- ---------------------------------------------------------------------------
-- Grants (PostgREST roles)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- RLS is the authority; role-aware UI hiding is not enforcement.
-- Staff have no policies on either table: every staff query is denied.
-- ---------------------------------------------------------------------------

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

create policy purchase_orders_select_manager on public.purchase_orders
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

create policy purchase_orders_write_manager on public.purchase_orders
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

create policy purchase_order_lines_select_manager on public.purchase_order_lines
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

create policy purchase_order_lines_write_manager on public.purchase_order_lines
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

-- ---------------------------------------------------------------------------
-- RPC: create_purchase_order — atomically create a draft PO with lines.
--
-- SECURITY INVOKER: inserts run as the caller, so the RLS policies above
-- apply (tenant + owner/manager enforced by the database, not the client).
--
-- Validates: supplier exists, is active, and belongs to the caller's
-- restaurant; every line references an active item in the caller's
-- restaurant with quantity > 0 and unit_price > 0. At least one line is
-- required. Returns the new PO id.
-- ---------------------------------------------------------------------------

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_order_date date,
  p_expected_date date,
  p_notes text,
  p_lines jsonb
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
    (restaurant_id, supplier_id, status, order_date, expected_date, notes, created_by)
  values
    (v_restaurant_id, p_supplier_id, 'draft', p_order_date, p_expected_date,
     nullif(p_notes, ''), v_created_by)
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

comment on function public.create_purchase_order(uuid, date, date, text, jsonb) is
  'P3-01: atomically create a draft purchase order with line items (SECURITY INVOKER — caller RLS applies).';
