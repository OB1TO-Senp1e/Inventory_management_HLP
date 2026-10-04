-- ============================================================================
-- P2-01 — stock ledger foundation.
--
-- `stock_movements` is the append-only heart of the app: every stock change
-- is a movement row; current stock is derived, never stored. Corrections are
-- NEW movements, never edits.
--
-- Append-only is enforced in THREE layers (defense in depth):
--   1. BEFORE UPDATE OR DELETE trigger that raises an exception;
--   2. RLS: only SELECT and INSERT policies exist — no UPDATE/DELETE
--      policies at all, so those operations are denied by default;
--   3. ACL: only SELECT and INSERT are granted to `authenticated`.
--
-- Signed quantities: positive = stock in, negative = stock out. All
-- quantities are stored in the item's BASE UNIT; conversions are explicit
-- and tested (P4-01). `quantity <> 0` — a zero movement is meaningless.
--
-- Deliberate exception to ARCHITECTURE.md §5 ("every table has updated_at"):
-- an append-only table is never updated, so `updated_at` would be dead
-- weight. `created_at` is the movement timestamp (the business fact).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- stock_movements
-- ---------------------------------------------------------------------------

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete restrict,
  movement_type text not null check (movement_type in (
    'receipt', 'usage', 'sale_deduction', 'wastage',
    'count_adjustment', 'transfer_in', 'transfer_out', 'opening_balance'
  )),
  quantity numeric not null check (quantity <> 0),
  batch_no text null,
  expiry_date date null,
  unit_cost numeric null check (unit_cost is null or unit_cost >= 0),
  reference_type text null,
  reference_id uuid null,
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

comment on table public.stock_movements is
  'Append-only stock ledger. UPDATE/DELETE are rejected by trigger, RLS and ACL. Corrections are new movements.';
comment on column public.stock_movements.quantity is
  'Signed quantity in the item''s base unit: positive = stock in, negative = stock out.';
comment on column public.stock_movements.unit_cost is
  'Cost per base unit at the time of this movement (INR). Used for weighted-average costing.';

-- Indexes for the foreign keys and the screens that will read this table
-- (ledger history per item, movement-type reports, chronological scans).
create index stock_movements_restaurant_id_idx on public.stock_movements (restaurant_id);
create index stock_movements_item_id_idx on public.stock_movements (item_id);
create index stock_movements_restaurant_item_idx on public.stock_movements (restaurant_id, item_id);
create index stock_movements_movement_type_idx on public.stock_movements (movement_type);
create index stock_movements_created_at_idx on public.stock_movements (created_at);

-- ---------------------------------------------------------------------------
-- Append-only enforcement: trigger (layer 1)
-- ---------------------------------------------------------------------------

create or replace function public.reject_stock_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements is append-only: % is not allowed. Post a correcting movement instead.', TG_OP;
end;
$$;

comment on function public.reject_stock_movement_mutation() is
  'Trigger function: rejects any UPDATE or DELETE on stock_movements.';

create trigger stock_movements_no_update_delete
  before update or delete on public.stock_movements
  for each row
  execute function public.reject_stock_movement_mutation();

-- ---------------------------------------------------------------------------
-- current_stock view: the read contract for "what is in stock"
-- ---------------------------------------------------------------------------
-- security_invoker = true (PG15+): the view runs with the caller's
-- permissions so the underlying table's RLS applies. Without it, a view
-- owned by a superuser would bypass RLS entirely.

create view public.current_stock
with (security_invoker = true) as
select
  restaurant_id,
  item_id,
  sum(quantity) as quantity,
  max(created_at) as last_movement_at
from public.stock_movements
group by restaurant_id, item_id;

comment on view public.current_stock is
  'Derived current stock per (restaurant, item). Never written to directly.';

-- ---------------------------------------------------------------------------
-- items.avg_unit_cost: weighted-average cost, maintained by RPCs
-- ---------------------------------------------------------------------------
-- Added here (before receive_goods in P2-02 uses it) so the column exists
-- from the first ledger write. The opening-balance RPC seeds it; receipt
-- RPCs recalculate it.

alter table public.items
  add column avg_unit_cost numeric not null default 0 check (avg_unit_cost >= 0);

comment on column public.items.avg_unit_cost is
  'Weighted-average unit cost in base unit (INR). Maintained by ledger RPCs; never set by clients.';

-- ---------------------------------------------------------------------------
-- RLS (layer 2): SELECT + INSERT only. No UPDATE/DELETE policies exist.
-- ---------------------------------------------------------------------------

alter table public.stock_movements enable row level security;

-- Everyone with a session reads their own restaurant's ledger.
create policy stock_movements_select_own on public.stock_movements
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- Owner, manager AND staff can insert (staff log usage/wastage in P2-03).
-- The WITH CHECK pins the row to the caller's restaurant.
create policy stock_movements_insert_roles on public.stock_movements
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and (
      public.has_role('owner')
      or public.has_role('manager')
      or public.has_role('staff')
    )
  );

-- ---------------------------------------------------------------------------
-- ACL (layer 3): grant only what RLS policies allow.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert on public.stock_movements to authenticated;
-- NOTE: update and delete are deliberately NOT granted.

-- ---------------------------------------------------------------------------
-- RPC: create_opening_balance(p_item_id, p_quantity, p_unit_cost)
-- ---------------------------------------------------------------------------
-- Posts the one-time opening-balance movement for an item and seeds
-- items.avg_unit_cost. SECURITY INVOKER: the caller's RLS applies to both
-- the movement insert and the items update.
--
-- Idempotency decision: a SECOND opening balance for the same item raises a
-- friendly exception instead of silently returning. An opening balance is a
-- deliberate human act; silently succeeding would mislead the caller into
-- thinking stock was added twice (or not at all). Documented in
-- ARCHITECTURE.md §11.
-- Template for the P2-02/P2-03 RPCs: validate inputs → validate
-- tenant/role → single transaction → friendly exceptions.

create or replace function public.create_opening_balance(
  p_item_id uuid,
  p_quantity numeric,
  p_unit_cost numeric
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_movement_id uuid;
begin
  -- Input validation -------------------------------------------------------
  if p_item_id is null then
    raise exception 'create_opening_balance: item id is required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'create_opening_balance: quantity must be greater than zero (got %).', p_quantity;
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'create_opening_balance: unit cost cannot be negative (got %).', p_unit_cost;
  end if;

  -- Tenant + role ------------------------------------------------------------
  if v_restaurant_id is null then
    raise exception 'create_opening_balance: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'create_opening_balance: only owners and managers can set opening balances.';
  end if;
  if not exists (
    select 1 from public.items i
    where i.id = p_item_id and i.restaurant_id = v_restaurant_id
  ) then
    raise exception 'create_opening_balance: item % not found in your restaurant.', p_item_id;
  end if;

  -- Idempotency: one opening balance per item --------------------------------
  if exists (
    select 1 from public.stock_movements m
    where m.item_id = p_item_id
      and m.movement_type = 'opening_balance'
  ) then
    raise exception 'create_opening_balance: item % already has an opening balance. Post a count adjustment instead.', p_item_id;
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  insert into public.stock_movements (
    restaurant_id, item_id, movement_type, quantity,
    unit_cost, created_by, notes
  ) values (
    v_restaurant_id, p_item_id, 'opening_balance', p_quantity,
    p_unit_cost, v_created_by, 'Opening balance'
  )
  returning id into v_movement_id;

  -- Seed the weighted-average cost: the first (and so far only) stock.
  update public.items
    set avg_unit_cost = p_unit_cost
    where id = p_item_id;

  return v_movement_id;
end;
$$;

comment on function public.create_opening_balance(uuid, numeric, numeric) is
  'Posts the one-time opening-balance movement for an item and seeds avg_unit_cost. Owner/manager only. Raises (never silently succeeds) on duplicates.';

grant execute on function public.create_opening_balance(uuid, numeric, numeric) to authenticated;
