-- ============================================================================
-- P4-01 menu items and recipes: schema, yield, unit conversions.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `menu_items` — one row per dish/recipe. `yield_quantity` + `yield_unit`
-- describe what one recipe batch makes (e.g. 4 servings); P4-03's
-- record_sales divides ingredient quantities by the yield when deducting.
--
-- `recipe_ingredients` — one row per (menu item, inventory item).
-- `quantity` is expressed in `unit_id` for the FULL recipe yield (not per
-- serving). The unit must be the item's base unit or directly convertible
-- to it (see `unit_conversions`); enforced by trigger.
--
-- `unit_conversions` — explicit conversion factors between units:
-- qty_in_to_unit = qty_in_from_unit * factor. Only DIRECT (one-hop)
-- conversions are supported in v1; the recipe builder offers an item's
-- base unit plus directly-convertible units. Seed data lives in
-- supabase/seed.sql (g<->kg, ml<->L).
--
-- Money is numeric, never float (ARCHITECTURE.md §5). Quantities are
-- numeric; P4-02 costs them via items.avg_unit_cost (per base unit).
--
-- RLS: owner/manager full access in their own restaurant on all three
-- tables. Staff have NO policies: every staff query is denied (per the
-- role matrix in ARCHITECTURE.md §7 — recipes will carry costs in P4-02
-- and staff cannot see costs).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) between 1 and 1000),
  yield_quantity numeric not null check (yield_quantity > 0),
  yield_unit text not null check (char_length(yield_unit) between 1 and 32),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

comment on table public.menu_items is
  'Menu items (dishes) with recipes. One recipe batch makes yield_quantity yield_unit (e.g. 4 servings).';
comment on column public.menu_items.yield_quantity is
  'How much one recipe batch makes, in yield_unit. P4-03 divides ingredient quantities by this on sale.';

create index menu_items_restaurant_id_idx on public.menu_items (restaurant_id);
create index menu_items_restaurant_active_idx on public.menu_items (restaurant_id, active);

create trigger trg_menu_items_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recipe_ingredients
-- ---------------------------------------------------------------------------

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_id uuid not null references public.units (id) on delete restrict,
  notes text check (notes is null or char_length(notes) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_item_id, item_id)
);

comment on table public.recipe_ingredients is
  'Recipe lines: quantity of an inventory item per FULL recipe yield, expressed in unit_id.';
comment on column public.recipe_ingredients.quantity is
  'Amount for the full recipe yield (not per serving), in unit_id. Must be convertible to the item base unit (trigger).';

create index recipe_ingredients_restaurant_id_idx on public.recipe_ingredients (restaurant_id);
create index recipe_ingredients_menu_item_id_idx on public.recipe_ingredients (menu_item_id);
create index recipe_ingredients_item_id_idx on public.recipe_ingredients (item_id);

create trigger trg_recipe_ingredients_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- unit_conversions
-- ---------------------------------------------------------------------------

create table public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  from_unit_id uuid not null references public.units (id) on delete cascade,
  to_unit_id uuid not null references public.units (id) on delete cascade,
  factor numeric not null check (factor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, from_unit_id, to_unit_id),
  check (from_unit_id <> to_unit_id)
);

comment on table public.unit_conversions is
  'Explicit unit conversion factors: qty_in_to_unit = qty_in_from_unit * factor. Only direct (one-hop) conversions; v1 seeds g<->kg and ml<->L.';
comment on column public.unit_conversions.factor is
  'Multiply a quantity in from_unit_id by this to get the quantity in to_unit_id.';

create index unit_conversions_restaurant_id_idx on public.unit_conversions (restaurant_id);

create trigger trg_unit_conversions_updated_at
  before update on public.unit_conversions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ingredient unit guard: the ingredient unit must be the item's base unit
-- or directly convertible to it via unit_conversions.
-- ---------------------------------------------------------------------------

create or replace function public.recipe_ingredient_unit_guard()
returns trigger
language plpgsql
as $$
declare
  v_base_unit_id uuid;
begin
  select unit_id into v_base_unit_id
  from public.items
  where id = NEW.item_id;

  if v_base_unit_id is null then
    raise exception 'recipe_ingredients: item % not found', NEW.item_id;
  end if;

  -- Same unit: always fine.
  if NEW.unit_id = v_base_unit_id then
    return NEW;
  end if;

  -- Direct conversion must exist (either direction is stored explicitly).
  if exists (
    select 1 from public.unit_conversions
    where restaurant_id = NEW.restaurant_id
      and from_unit_id = NEW.unit_id
      and to_unit_id = v_base_unit_id
  ) then
    return NEW;
  end if;

  raise exception 'recipe_ingredients: unit % is not convertible to the item base unit %',
    NEW.unit_id, v_base_unit_id;
end;
$$;

comment on function public.recipe_ingredient_unit_guard() is
  'P4-01: rejects recipe ingredients whose unit is neither the item base unit nor directly convertible to it.';

create trigger trg_recipe_ingredient_unit_guard
  before insert or update of item_id, unit_id on public.recipe_ingredients
  for each row execute function public.recipe_ingredient_unit_guard();

-- ---------------------------------------------------------------------------
-- RLS is the authority; role-aware UI hiding is not enforcement.
-- Staff have no policies on any of the three tables: every staff query
-- is denied.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.menu_items to authenticated;
grant select, insert, update, delete on public.recipe_ingredients to authenticated;
grant select, insert, update, delete on public.unit_conversions to authenticated;

alter table public.menu_items enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.unit_conversions enable row level security;

create policy menu_items_select_manager on public.menu_items
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

create policy menu_items_write_manager on public.menu_items
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

create policy recipe_ingredients_select_manager on public.recipe_ingredients
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

create policy recipe_ingredients_write_manager on public.recipe_ingredients
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

create policy unit_conversions_select_manager on public.unit_conversions
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));

create policy unit_conversions_write_manager on public.unit_conversions
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));
