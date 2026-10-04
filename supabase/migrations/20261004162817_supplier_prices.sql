-- ============================================================================
-- P1-04 supplier price lists: per-item prices per supplier + price history.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `supplier_prices` — the current price of one item from one supplier.
-- Money is numeric, never float. Prices are per the item's base unit
-- (see ARCHITECTURE.md §5); unit conversions arrive with recipes (P4-01).
--
-- Preferred supplier: at most ONE preferred supplier per item per
-- restaurant, enforced by a partial unique index. Switching the preferred
-- supplier is atomic via the `set_preferred_supplier()` RPC below (two
-- updates in one transaction; the partial unique index keeps it safe under
-- races). A preferred supplier must be active, and its item must be active —
-- archived suppliers are hidden from PO pickers (P1-03 contract), so a
-- preferred archived supplier would be inconsistent.
--
-- `supplier_price_history` — append-only audit of price changes. Rows are
-- written only by the `record_supplier_price_history()` trigger (SECURITY
-- DEFINER, owned by postgres — the history table has no write policies at
-- all, so direct writes are always denied). UPDATE/DELETE on the history
-- table are rejected by trigger. Price rows are recorded on INSERT,
-- on price-changing UPDATEs, and on DELETEs; toggling `is_preferred`
-- alone writes no history row (it is not a price change).
--
-- RLS: owner/manager full access in their own restaurant on both tables
-- (history is read-only for them — no write policies). Staff have NO
-- policies on either table: every staff query is denied (per the role
-- matrix in ARCHITECTURE.md §7 — staff cannot see costs).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- supplier_prices
-- ---------------------------------------------------------------------------

create table public.supplier_prices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  item_id uuid not null references public.items (id) on delete restrict,
  unit_price numeric not null check (unit_price > 0),
  currency text not null default 'INR' check (char_length(currency) between 1 and 10),
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  -- created_by is audit metadata; intentionally no FK to auth.users so that
  -- deleting an auth user never cascades into business data.
  created_by uuid,
  updated_at timestamptz not null default now(),
  -- One price row per (supplier, item) pair.
  unique (supplier_id, item_id)
);

comment on table public.supplier_prices is
  'Current per-item price per supplier (base unit, numeric). At most one preferred supplier per item per restaurant (partial unique index).';
comment on column public.supplier_prices.unit_price is
  'Price per the item''s base unit. Numeric, always > 0.';
comment on column public.supplier_prices.is_preferred is
  'Preferred supplier flag for the item. Switch atomically via set_preferred_supplier().';

-- Indexes for the foreign keys + the list-screen filters (restaurant,
-- supplier, item) and the preferred-supplier lookup.
create index supplier_prices_restaurant_id_idx on public.supplier_prices (restaurant_id);
create index supplier_prices_supplier_id_idx on public.supplier_prices (supplier_id);
create index supplier_prices_item_id_idx on public.supplier_prices (item_id);

-- At most one preferred supplier per item per restaurant.
create unique index supplier_prices_one_preferred_per_item
  on public.supplier_prices (restaurant_id, item_id)
  where is_preferred;

-- updated_at maintenance.
create trigger trg_supplier_prices_updated_at
  before update on public.supplier_prices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RPC: set_preferred_supplier — atomically switch the preferred supplier
-- for an item. SECURITY INVOKER: the UPDATEs run as the caller, so RLS
-- stays the authority; the partial unique index keeps concurrent switches
-- safe. Raises on unknown price rows, archived suppliers/items, and
-- non-owner/manager callers.
-- ---------------------------------------------------------------------------

create or replace function public.set_preferred_supplier(
  p_item_id uuid,
  p_supplier_id uuid
)
returns public.supplier_prices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_row public.supplier_prices%rowtype;
  v_supplier_active boolean;
  v_item_active boolean;
begin
  if p_item_id is null or p_supplier_id is null then
    raise exception 'set_preferred_supplier: item and supplier are required';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'set_preferred_supplier: owner or manager role required';
  end if;

  select * into v_row
  from public.supplier_prices
  where supplier_id = p_supplier_id
    and item_id = p_item_id
    and restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'set_preferred_supplier: no price entry for this supplier and item in your restaurant';
  end if;

  select active into v_supplier_active
  from public.suppliers where id = p_supplier_id;
  select active into v_item_active
  from public.items where id = p_item_id;
  if coalesce(v_supplier_active, false) = false then
    raise exception 'set_preferred_supplier: supplier is archived';
  end if;
  if coalesce(v_item_active, false) = false then
    raise exception 'set_preferred_supplier: item is archived';
  end if;

  -- No-op when already preferred.
  if v_row.is_preferred then
    return v_row;
  end if;

  -- Atomic switch: clear the old preferred, set the new one.
  update public.supplier_prices
  set is_preferred = false
  where item_id = p_item_id
    and restaurant_id = v_restaurant_id
    and is_preferred = true;

  update public.supplier_prices
  set is_preferred = true
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_preferred_supplier(uuid, uuid) is
  'Atomically switches the preferred supplier for an item (owner/manager only). Clears the previous preferred row and sets the new one in one transaction.';

-- ---------------------------------------------------------------------------
-- supplier_price_history (append-only)
-- ---------------------------------------------------------------------------

create table public.supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  supplier_id uuid not null,
  item_id uuid not null,
  old_price numeric check (old_price is null or old_price > 0),
  new_price numeric check (new_price is null or new_price > 0),
  -- changed_by is audit metadata; intentionally no FK to auth.users.
  changed_by uuid,
  changed_at timestamptz not null default now(),
  check (old_price is distinct from new_price)
);

comment on table public.supplier_price_history is
  'Append-only audit of supplier price changes. Written only by the record_supplier_price_history() trigger; direct writes are denied (no write policies) and UPDATE/DELETE are rejected by trigger.';

create index supplier_price_history_restaurant_item_idx
  on public.supplier_price_history (restaurant_id, item_id, changed_at desc);
create index supplier_price_history_supplier_idx
  on public.supplier_price_history (supplier_id);

-- ---------------------------------------------------------------------------
-- History writer trigger (SECURITY DEFINER — documented reason: the history
-- table intentionally has no write policies, so the trigger must write as
-- the table owner. Runs as postgres, the migration owner, both on the
-- interim DB and on Supabase cloud.)
-- ---------------------------------------------------------------------------

create or replace function public.record_supplier_price_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub uuid;
begin
  begin
    v_sub := nullif((v_claims::jsonb) ->> 'sub', '')::uuid;
  exception when others then
    v_sub := null;
  end;

  if tg_op = 'INSERT' then
    insert into public.supplier_price_history
      (restaurant_id, supplier_id, item_id, old_price, new_price, changed_by)
    values
      (new.restaurant_id, new.supplier_id, new.item_id, null, new.unit_price, v_sub);
    return new;
  elsif tg_op = 'UPDATE' then
    -- Only price changes are history; toggling is_preferred writes nothing.
    if new.unit_price is distinct from old.unit_price then
      insert into public.supplier_price_history
        (restaurant_id, supplier_id, item_id, old_price, new_price, changed_by)
      values
        (new.restaurant_id, new.supplier_id, new.item_id, old.unit_price, new.unit_price, v_sub);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.supplier_price_history
      (restaurant_id, supplier_id, item_id, old_price, new_price, changed_by)
    values
      (old.restaurant_id, old.supplier_id, old.item_id, old.unit_price, null, v_sub);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.record_supplier_price_history() is
  'AFTER INSERT/UPDATE/DELETE trigger on supplier_prices. SECURITY DEFINER so it can write to the policy-less history table as the table owner.';

create trigger trg_supplier_prices_history
  after insert or update or delete on public.supplier_prices
  for each row execute function public.record_supplier_price_history();

-- ---------------------------------------------------------------------------
-- Append-only enforcement: reject any UPDATE or DELETE on the history table.
-- ---------------------------------------------------------------------------

create or replace function public.reject_supplier_price_history_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'supplier_price_history is append-only: UPDATE and DELETE are not allowed';
  return null;
end;
$$;

create trigger trg_supplier_price_history_no_write
  before update or delete on public.supplier_price_history
  for each row execute function public.reject_supplier_price_history_write();

-- ---------------------------------------------------------------------------
-- Grants (PostgREST roles)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.supplier_prices to authenticated;
-- History is read-only by design: SELECT only, no write policies below.
grant select on public.supplier_price_history to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- RLS is the authority; role-aware UI hiding is not enforcement.
-- Staff have no policies on either table: every staff query is denied
-- (staff cannot see costs, per the role matrix in ARCHITECTURE.md §7).
-- ---------------------------------------------------------------------------

alter table public.supplier_prices enable row level security;
alter table public.supplier_price_history enable row level security;

-- Owner/manager: read prices in their own restaurant.
create policy supplier_prices_select_manager on public.supplier_prices
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

-- Owner/manager: full write access in their own restaurant.
create policy supplier_prices_write_manager on public.supplier_prices
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

-- Owner/manager: read price history in their own restaurant.
-- No write policies: direct INSERT/UPDATE/DELETE are always denied; only
-- the SECURITY DEFINER history trigger (running as table owner) can write.
create policy supplier_price_history_select_manager on public.supplier_price_history
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));
