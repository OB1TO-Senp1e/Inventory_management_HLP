-- ============================================================================
-- DEV ONLY — sample data for local development and UI work.
-- This file is NOT a migration: it only inserts rows and is safe to re-run
-- (every statement uses INSERT ... ON CONFLICT DO NOTHING).
--
-- Apply locally (interim DB):  pnpm db:seed
-- Apply on Supabase:          `supabase db reset` runs this automatically,
--                             or paste it into the SQL editor.
--
-- IMPORTANT for Supabase cloud: this file never writes to the auth schema.
-- The three profile rows reference auth.users UUIDs that must exist first:
-- on cloud, create the three GoTrue users (see README "Test users"), then
-- run this seed so the profiles match those user IDs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 restaurant (neutral placeholder — real name/branding arrives via B-001)
-- ---------------------------------------------------------------------------

insert into public.restaurants (id, name, created_by, created_at, updated_at)
values (
  'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
  'Demo Restaurant',
  '11111111-1111-4111-8111-111111111111',
  now(), now()
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3 profiles, one per role. UUIDs are fixed and documented in README
-- ("Test users") so e2e fixtures and GoTrue users can match them later.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, restaurant_id, role, created_by, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'owner',   '11111111-1111-4111-8111-111111111111', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'manager', '11111111-1111-4111-8111-111111111111', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'staff',   '11111111-1111-4111-8111-111111111111', now(), now())
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- V2-07: default "Main outlet" + pin all seed profiles to it, so a seeded
-- dev DB has a working outlet context out of the box.
-- ---------------------------------------------------------------------------

insert into public.outlets (id, restaurant_id, name, is_default)
values
  ('b1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d6', 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Main outlet', true)
on conflict (id) do nothing;

update public.profiles
   set current_outlet_id = 'b1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d6'
 where restaurant_id = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
   and current_outlet_id is null;

-- ---------------------------------------------------------------------------
-- Sample item categories (India kitchen defaults)
-- ---------------------------------------------------------------------------

insert into public.item_categories (restaurant_id, name, created_by, created_at, updated_at)
values
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Vegetables',                  '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Dairy',                       '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Spices & Masalas',            '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Grains & Pulses',             '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Meat & Poultry',              '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Beverages',                   '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Packaging & Housekeeping',    '11111111-1111-4111-8111-111111111111', now(), now())
on conflict (restaurant_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Sample storage locations
-- ---------------------------------------------------------------------------

insert into public.storage_locations (restaurant_id, name, created_by, created_at, updated_at)
values
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Dry Store',      '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Cold Room',      '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Freezer',        '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'Kitchen Counter','11111111-1111-4111-8111-111111111111', now(), now())
on conflict (restaurant_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Sample units (base units used by items)
-- ---------------------------------------------------------------------------

insert into public.units (restaurant_id, name, symbol, created_by, created_at, updated_at)
values
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'kilogram',   'kg',  '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'gram',       'g',   '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'litre',      'L',   '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'millilitre', 'ml',  '11111111-1111-4111-8111-111111111111', now(), now()),
  ('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', 'pieces',     'pcs', '11111111-1111-4111-8111-111111111111', now(), now())
on conflict (restaurant_id, symbol) do nothing;

-- ---------------------------------------------------------------------------
-- Sample unit conversions (P4-01; explicit factors, one-hop)
-- ---------------------------------------------------------------------------

insert into public.unit_conversions (restaurant_id, from_unit_id, to_unit_id, factor)
select
  'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
  f.id, t.id, v.factor
from (values
  ('g',  'kg', 0.001),
  ('kg', 'g',  1000),
  ('ml', 'L',  0.001),
  ('L',  'ml', 1000)
) as v(from_symbol, to_symbol, factor)
join public.units f
  on f.restaurant_id = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5' and f.symbol = v.from_symbol
join public.units t
  on t.restaurant_id = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5' and t.symbol = v.to_symbol
on conflict (restaurant_id, from_unit_id, to_unit_id) do nothing;

-- ---------------------------------------------------------------------------
-- Sanity check (visible in psql output; errors fail the run)
-- ---------------------------------------------------------------------------

do $$
declare
  v_restaurants int;
  v_profiles int;
  v_roles int;
begin
  select count(*) into v_restaurants from public.restaurants;
  select count(*) into v_profiles from public.profiles;
  select count(distinct role) into v_roles from public.profiles;
  if v_restaurants < 1 then raise exception 'seed: expected >= 1 restaurant, got %', v_restaurants; end if;
  if v_profiles < 3 then raise exception 'seed: expected >= 3 profiles, got %', v_profiles; end if;
  if v_roles < 3 then raise exception 'seed: expected 3 distinct roles, got %', v_roles; end if;
  raise notice 'seed ok: % restaurant(s), % profile(s), % distinct role(s)', v_restaurants, v_profiles, v_roles;
end
$$;
