-- ============================================================================
-- P1-02: taxonomy management — active flag + RESTRICT deletes.
--
-- 1. `active` flag on item_categories and storage_locations. Archiving
--    (active=false) is the soft-delete path: archived rows stay for history
--    but are hidden from pickers (item form dropdowns).
-- 2. items.category_id / items.storage_location_id foreign keys change
--    ON DELETE SET NULL -> ON DELETE RESTRICT, so a hard delete of a
--    category/location that is still referenced by an item fails at the
--    database. The API maps the FK violation to a friendly
--    "in use by N items" message; archiving is always available instead.
-- ============================================================================

alter table public.item_categories
  add column if not exists active boolean not null default true;

alter table public.storage_locations
  add column if not exists active boolean not null default true;

-- The set_updated_at() triggers from the core schema migration already cover
-- these tables; no new triggers needed.

-- Postgres cannot ALTER a constraint's ON DELETE action in place: drop and
-- re-add with the same (conventional) constraint names.
alter table public.items drop constraint items_category_id_fkey;
alter table public.items
  add constraint items_category_id_fkey
  foreign key (category_id) references public.item_categories (id)
  on delete restrict;

alter table public.items drop constraint items_storage_location_id_fkey;
alter table public.items
  add constraint items_storage_location_id_fkey
  foreign key (storage_location_id) references public.storage_locations (id)
  on delete restrict;
