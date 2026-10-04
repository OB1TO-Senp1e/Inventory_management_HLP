-- ============================================================================
-- P1-03 suppliers: supplier master data (contact details).
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `suppliers` is master data: owner/manager have full CRUD in their own
-- restaurant; staff have NO access (per the role matrix in
-- ARCHITECTURE.md §7 — staff cannot manage suppliers). RLS is the authority;
-- the UI hides supplier management from staff as well.
--
-- Archiving is a soft delete (active=false); rows are never hard-deleted by
-- the app. List queries default to active=true, which is also the contract
-- the future purchase-order prefill (P3-01) will rely on: archived suppliers
-- are hidden from PO supplier pickers.
-- ============================================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  contact_person text check (contact_person is null or char_length(contact_person) between 1 and 120),
  phone text check (phone is null or char_length(phone) between 7 and 20),
  email text check (email is null or char_length(email) between 3 and 320),
  address text check (address is null or char_length(address) between 1 and 500),
  -- GSTIN (India): 15 alphanumeric characters. The DB check stays loose on
  -- purpose; the strict shape (state code + PAN + entity + Z + check digit)
  -- is enforced client-side by the Zod schema in src/schemas/supplier.ts.
  gstin text check (gstin is null or gstin ~ '^[A-Za-z0-9]{15}$'),
  notes text check (notes is null or char_length(notes) between 1 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- created_by is audit metadata; intentionally no FK to auth.users so that
  -- deleting an auth user never cascades into business data.
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

comment on table public.suppliers is
  'Supplier master data with contact details. Archiving is a soft delete (active=false); rows are never hard-deleted by the app.';
comment on column public.suppliers.gstin is
  'Optional Indian GSTIN. Loose 15-char alphanumeric check here; strict format validated in the Zod schema.';

-- Indexes for the foreign key + the list-screen filters (restaurant, active)
-- and name ordering.
create index suppliers_restaurant_id_idx on public.suppliers (restaurant_id);
create index suppliers_restaurant_id_active_idx on public.suppliers (restaurant_id, active);
create index suppliers_restaurant_id_name_idx on public.suppliers (restaurant_id, name);

-- updated_at maintenance.
create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants (PostgREST roles)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- RLS is the authority; role-aware UI hiding is not enforcement.
-- Staff have no policies on suppliers at all: every staff query is denied.
-- ---------------------------------------------------------------------------

alter table public.suppliers enable row level security;

-- Owner/manager: read suppliers in their own restaurant.
create policy suppliers_select_manager on public.suppliers
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

-- Owner/manager: full write access in their own restaurant.
-- (The app only ever soft-deletes via active=false; no delete path exists
-- in the client, but the policy shape stays consistent with master data.)
create policy suppliers_write_manager on public.suppliers
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));
