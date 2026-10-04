-- ============================================================================
-- P1-01 items: ingredients/supplies catalog.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `items` is master data: owner/manager have full CRUD in their own
-- restaurant; staff have NO access (per the role matrix in
-- ARCHITECTURE.md §7 — staff cannot manage items). RLS is the authority;
-- the UI hides item management from staff as well.
-- ============================================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  category_id uuid references public.item_categories (id) on delete set null,
  unit_id uuid not null references public.units (id) on delete restrict,
  storage_location_id uuid references public.storage_locations (id) on delete set null,
  par_level numeric not null default 0 check (par_level >= 0),
  reorder_point numeric not null default 0 check (reorder_point >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- created_by is audit metadata; intentionally no FK to auth.users so that
  -- deleting an auth user never cascades into business data.
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

comment on table public.items is
  'Ingredients and supplies catalog. Quantities (par/reorder) are stored in the item''s base unit (unit_id). Archiving is a soft delete (active=false); rows are never hard-deleted by the app.';
comment on column public.items.category_id is
  'Optional: items may be uncategorized until P1-02 organizes categories.';
comment on column public.items.unit_id is
  'Base unit for this item (required — stock movements are stored in base units). RESTRICT on delete: a unit in use cannot be removed.';
comment on column public.items.storage_location_id is
  'Optional default storage location for this item.';
comment on column public.items.par_level is
  'Target stock level in base units. Must be >= 0.';
comment on column public.items.reorder_point is
  'Order more when stock falls to this level (base units). Must be >= 0.';

-- Indexes for every foreign key + the list-screen filter (restaurant, active).
create index items_restaurant_id_idx on public.items (restaurant_id);
create index items_category_id_idx on public.items (category_id);
create index items_unit_id_idx on public.items (unit_id);
create index items_storage_location_id_idx on public.items (storage_location_id);
create index items_restaurant_id_active_idx on public.items (restaurant_id, active);

-- updated_at maintenance.
create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants (PostgREST roles)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.items to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- RLS is the authority; role-aware UI hiding is not enforcement.
-- Staff have no policies on items at all: every staff query is denied.
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;

-- Owner/manager: read items in their own restaurant.
create policy items_select_manager on public.items
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

-- Owner/manager: full write access in their own restaurant.
-- (The app only ever soft-deletes via active=false; no delete path exists
-- in the client, but the policy shape stays consistent with master data.)
create policy items_write_manager on public.items
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));
