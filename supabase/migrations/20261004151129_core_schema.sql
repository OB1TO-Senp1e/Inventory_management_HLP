-- ============================================================================
-- P0-03 core schema: restaurants, profiles (role), item_categories,
-- storage_locations, units + RLS helper functions.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16 with a
-- stub auth.users (scripts/interim-db-setup.sql — never a migration).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at maintenance trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: refreshes updated_at. Attached to every table.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  -- created_by is audit metadata; intentionally no FK to auth.users so that
  -- deleting an auth user never cascades into business data.
  created_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.restaurants is
  'One row per restaurant. v1 is single-restaurant; the column exists so RLS stays multi-tenant-safe.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'App profile per auth user: home restaurant + role. Role is the RLS authority; UI hiding is not enforcement.';

create table public.item_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  symbol text not null check (char_length(symbol) between 1 and 16),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, symbol)
);

comment on table public.units is
  'Base units used by items (e.g. kilogram/kg). Quantities are stored in base units; conversions are explicit.';

-- Indexes for every foreign key.
create index profiles_restaurant_id_idx on public.profiles (restaurant_id);
create index item_categories_restaurant_id_idx on public.item_categories (restaurant_id);
create index storage_locations_restaurant_id_idx on public.storage_locations (restaurant_id);
create index units_restaurant_id_idx on public.units (restaurant_id);

-- updated_at triggers.
create trigger trg_restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_item_categories_updated_at
  before update on public.item_categories
  for each row execute function public.set_updated_at();
create trigger trg_storage_locations_updated_at
  before update on public.storage_locations
  for each row execute function public.set_updated_at();
create trigger trg_units_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions
--
-- Both read current_setting('request.jwt.claims', true) — the exact channel
-- through which Supabase populates auth.jwt(). Behaviour is therefore
-- identical on Supabase cloud and on the interim local database.
-- SECURITY INVOKER (default) is stated explicitly per project convention.
-- ---------------------------------------------------------------------------

create or replace function public.current_restaurant_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_rid text;
begin
  if v_claims is null or v_claims = '' then
    return null;
  end if;
  begin
    v_rid := (v_claims::jsonb) ->> 'restaurant_id';
  exception when others then
    return null;
  end;
  if v_rid is null or v_rid = '' then
    return null;
  end if;
  begin
    return v_rid::uuid;
  exception when others then
    return null;
  end;
end;
$$;

comment on function public.current_restaurant_id() is
  'Restaurant of the caller from the JWT claims. Null when unauthenticated or malformed — never raises.';

create or replace function public.has_role(p_required text)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_role text;
begin
  if v_claims is null or v_claims = '' or p_required is null then
    return false;
  end if;
  begin
    v_role := (v_claims::jsonb) ->> 'role';
  exception when others then
    return false;
  end;
  return v_role = p_required;
end;
$$;

comment on function public.has_role(text) is
  'Exact role match against the JWT claims (owner/manager/staff). Combine with OR for multi-role policies.';

-- ---------------------------------------------------------------------------
-- Grants (PostgREST roles)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.restaurants to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.item_categories to authenticated;
grant select, insert, update, delete on public.storage_locations to authenticated;
grant select, insert, update, delete on public.units to authenticated;
grant execute on function public.current_restaurant_id() to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.set_updated_at() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- RLS is the authority; role-aware UI hiding is not enforcement.
-- ---------------------------------------------------------------------------

alter table public.restaurants enable row level security;
alter table public.profiles enable row level security;
alter table public.item_categories enable row level security;
alter table public.storage_locations enable row level security;
alter table public.units enable row level security;

-- restaurants: anyone in the restaurant reads it; only the owner renames it.
create policy restaurants_select_own on public.restaurants
  for select to authenticated
  using (id = public.current_restaurant_id());

create policy restaurants_update_owner on public.restaurants
  for update to authenticated
  using (id = public.current_restaurant_id() and public.has_role('owner'))
  with check (id = public.current_restaurant_id() and public.has_role('owner'));

-- profiles: everyone reads colleagues in their restaurant; only the owner
-- manages users (invite / change role / deactivate come in P5-06).
create policy profiles_select_same_restaurant on public.profiles
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

create policy profiles_write_owner on public.profiles
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role('owner'))
  with check (restaurant_id = public.current_restaurant_id() and public.has_role('owner'));

-- Master data (categories, locations, units): everyone reads; only
-- owner/manager write. Staff need read access for usage/wastage logging.
create policy item_categories_select_same_restaurant on public.item_categories
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

create policy item_categories_write_manager on public.item_categories
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

create policy storage_locations_select_same_restaurant on public.storage_locations
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

create policy storage_locations_write_manager on public.storage_locations
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

create policy units_select_same_restaurant on public.units
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

create policy units_write_manager on public.units
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));
