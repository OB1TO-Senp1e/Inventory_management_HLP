-- ============================================================================
-- V2-07: Multi-outlet support.
--
-- Tenancy model change: stock becomes outlet-scoped. Catalog (items,
-- suppliers, menu items, recipes, purchase orders) stays restaurant-shared.
--
-- Design (see ARCHITECTURE.md §11):
--   * `outlets` under each restaurant; exactly one default ("Main outlet").
--   * `stock_movements.outlet_id` NOT NULL; `current_stock` groups by outlet.
--   * Outlet context = `profiles.current_outlet_id`, written only via the
--     `switch_outlet()` RPC (validated: same restaurant, active).
--   * `my_current_outlet()` (pure: validated pin → default outlet → null)
--     is what RLS uses — outlet A can never read outlet B's rows, for any
--     role, via any path. No owner bypass: owners switch outlets to inspect
--     each one (the "all outlets" view was deemed not cheap — documented).
--   * `effective_outlet_id()` (SECURITY DEFINER) is what stock-writing RPCs
--     use: falls back to provisioning the default outlet and pins the
--     profile, so RPCs stay total (this also keeps pre-V2-07 DB fixtures
--     working: their first RPC call provisions + pins).
--   * A BEFORE INSERT backstop resolves a null outlet_id to the default
--     outlet (provisioning when the restaurant has none) — covers direct
--     inserts (fixtures, old clients). RLS still rejects forged outlet_ids.
--   * Costing stays restaurant-wide: `items.avg_unit_cost` is unchanged by
--     outlets; `receive_goods` averages across all outlets; transfers carry
--     the current avg as informational unit_cost but never move it.
--   * `transfer_stock()` posts paired transfer_out/transfer_in movements
--     atomically; over-transfer raises (strict); audit_log 'stock_transfer'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. outlets table
-- ---------------------------------------------------------------------------

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  address text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.outlets is
  'V2-07: physical outlets (stores/kitchens) under a restaurant. Stock is scoped per outlet; catalog stays restaurant-shared. Exactly one default per restaurant (partial unique index). Deactivation — never deletion — is guarded by outlet_deactivation_guard.';

create unique index outlets_default_unique on public.outlets (restaurant_id) where is_default;
create unique index outlets_name_unique on public.outlets (restaurant_id, lower(name));
create index outlets_restaurant_idx on public.outlets (restaurant_id);

alter table public.outlets enable row level security;

-- Everyone in the restaurant reads the outlet list (the switcher needs it).
create policy outlets_select_same_restaurant on public.outlets
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- Only the owner manages outlets. No delete policy: deactivation is the path.
create policy outlets_insert_owner on public.outlets
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('owner')
  );

create policy outlets_update_owner on public.outlets
  for update to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('owner')
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('owner')
  );

-- Owner-only delete. The RESTRICT FK from stock_movements blocks deleting an
-- outlet with ledger history; empty outlets can be removed outright.
create policy outlets_delete_owner on public.outlets
  for delete to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('owner')
  );

create trigger outlets_set_updated_at
  before update on public.outlets
  for each row execute function public.set_updated_at();

-- ACL: RLS is the authority (policies above); grants just open the door.
grant select, insert, update, delete on public.outlets to authenticated;

-- ---------------------------------------------------------------------------
-- 2. profiles.current_outlet_id — the outlet context
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column current_outlet_id uuid references public.outlets(id) on delete set null;

create index profiles_current_outlet_idx on public.profiles (current_outlet_id);

comment on column public.profiles.current_outlet_id is
  'V2-07: the user''s current outlet (written only via switch_outlet()). RLS on stock tables pins reads/writes to the effective outlet. Null for users who never switched — my_current_outlet() falls back to the default outlet.';

-- ---------------------------------------------------------------------------
-- 3. Outlet context helpers
-- ---------------------------------------------------------------------------

-- Pure outlet resolution for RLS: validated profile pin → default active
-- outlet → null. Never raises, never writes (safe inside RLS policies).
-- VOLATILE, not STABLE: the pin can change mid-statement (backstop triggers
-- pin it before the RLS WITH CHECK runs), and STABLE would let Postgres
-- reuse the pre-trigger value and wrongly reject the row.
create or replace function public.my_current_outlet()
returns uuid
language plpgsql volatile set search_path to 'public'
as $$
declare
  v_uid uuid := public.current_user_id();
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet uuid;
begin
  if v_uid is null or v_restaurant_id is null then
    return null;
  end if;
  -- Validated pin: must be active and in the caller's restaurant.
  select o.id into v_outlet
    from public.profiles p
    join public.outlets o on o.id = p.current_outlet_id
   where p.id = v_uid
     and o.restaurant_id = v_restaurant_id
     and o.is_active;
  if v_outlet is not null then
    return v_outlet;
  end if;
  -- Fallback: the default active outlet (else oldest active).
  select o.id into v_outlet
    from public.outlets o
   where o.restaurant_id = v_restaurant_id
     and o.is_active
   order by o.is_default desc, o.created_at asc
   limit 1;
  return v_outlet;
end;
$$;

comment on function public.my_current_outlet() is
  'V2-07: the caller''s effective outlet for RLS. Pure (no writes): validated profile pin, else the default active outlet, else null.';

-- Total outlet resolution for stock-writing RPCs (SECURITY DEFINER): never
-- returns null for a valid restaurant session — provisions the default
-- "Main outlet" when the restaurant has none, and pins the caller's
-- profile so RLS (which uses the pure my_current_outlet()) agrees with
-- what the RPCs write.
create or replace function public.effective_outlet_id()
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_uid uuid := public.current_user_id();
  v_outlet uuid := public.my_current_outlet();
begin
  if v_restaurant_id is null then
    return null;
  end if;
  if v_outlet is not null then
    return v_outlet;
  end if;
  if exists (select 1 from public.outlets o where o.restaurant_id = v_restaurant_id) then
    -- Outlets exist but none is active/selectable: honest null, don't invent one.
    return null;
  end if;
  insert into public.outlets (restaurant_id, name, is_default)
  values (v_restaurant_id, 'Main outlet', true)
  on conflict (restaurant_id) where is_default do nothing
  returning id into v_outlet;
  if v_outlet is null then
    select o.id into v_outlet
      from public.outlets o
     where o.restaurant_id = v_restaurant_id and o.is_default;
  end if;
  if v_outlet is not null and v_uid is not null then
    update public.profiles
       set current_outlet_id = v_outlet, updated_at = now()
     where id = v_uid
       and current_outlet_id is distinct from v_outlet;
  end if;
  return v_outlet;
end;
$$;

comment on function public.effective_outlet_id() is
  'V2-07: total outlet resolution for stock-writing RPCs. Falls back to provisioning the default outlet and pins the caller''s profile.';

-- switch_outlet: the only writer of profiles.current_outlet_id.
create or replace function public.switch_outlet(p_outlet_id uuid)
returns public.outlets
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_uid uuid := public.current_user_id();
  v_outlet public.outlets;
begin
  if v_restaurant_id is null then
    raise exception 'switch_outlet: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager') or public.has_role('staff')) then
    raise exception 'switch_outlet: your role cannot switch outlets.';
  end if;
  if p_outlet_id is null then
    raise exception 'switch_outlet: outlet is required.';
  end if;
  select * into v_outlet from public.outlets where id = p_outlet_id;
  if not found then
    raise exception 'switch_outlet: outlet not found.';
  end if;
  if v_outlet.restaurant_id is distinct from v_restaurant_id then
    raise exception 'switch_outlet: outlet belongs to another restaurant.';
  end if;
  if not v_outlet.is_active then
    raise exception 'switch_outlet: outlet "%" is deactivated.', v_outlet.name;
  end if;
  update public.profiles
     set current_outlet_id = v_outlet.id, updated_at = now()
   where id = v_uid;
  if not found then
    raise exception 'switch_outlet: no profile for the current user.';
  end if;
  return v_outlet;
end;
$$;

comment on function public.switch_outlet(uuid) is
  'V2-07: pin the caller''s outlet context (profiles.current_outlet_id). Validates same-restaurant + active. Any signed-in role may switch; only the owner manages outlets.';

-- ensure_current_outlet: repair + return the effective outlet (called at login).
create or replace function public.ensure_current_outlet()
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_outlet uuid := public.effective_outlet_id();
begin
  -- effective_outlet_id already pins the profile when it provisions.
  -- Re-pin here too when the stored pin went stale (deactivated outlet).
  if v_outlet is not null then
    update public.profiles
       set current_outlet_id = v_outlet, updated_at = now()
     where id = public.current_user_id()
       and current_outlet_id is distinct from v_outlet;
  end if;
  return v_outlet;
end;
$$;

comment on function public.ensure_current_outlet() is
  'V2-07: repair the caller''s outlet pin (stale/deactivated → default) and return the effective outlet id. Called at profile load; null only when the restaurant has no active outlet at all.';

-- ---------------------------------------------------------------------------
-- 4. Default outlets for existing restaurants + outlet_id on the ledger
-- ---------------------------------------------------------------------------

-- Every existing restaurant gets its "Main outlet" (idempotent).
insert into public.outlets (restaurant_id, name, is_default)
select r.id, 'Main outlet', true
  from public.restaurants r
 where not exists (select 1 from public.outlets o where o.restaurant_id = r.id);

alter table public.stock_movements
  add column outlet_id uuid references public.outlets(id) on delete restrict;

-- Backfill: all existing rows belong to the default outlet.
update public.stock_movements sm
   set outlet_id = o.id
  from public.outlets o
 where sm.outlet_id is null
   and o.restaurant_id = sm.restaurant_id
   and o.is_default;

alter table public.stock_movements alter column outlet_id set not null;

comment on column public.stock_movements.outlet_id is
  'V2-07: the outlet whose shelf this movement affects. NOT NULL; backfilled to each restaurant''s default outlet. A null on insert is resolved by the stock_movement_outlet_backstop trigger; RLS rejects forged outlet_ids.';

-- Pin existing users to their default outlet.
update public.profiles p
   set current_outlet_id = o.id
  from public.outlets o
 where p.current_outlet_id is null
   and o.restaurant_id = p.restaurant_id
   and o.is_default;

-- ---------------------------------------------------------------------------
-- 5. Backstop: direct inserts without outlet_id land in the default outlet
-- ---------------------------------------------------------------------------

create or replace function public.stock_movement_outlet_backstop()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.outlet_id is null then
    select o.id into new.outlet_id
      from public.outlets o
     where o.restaurant_id = new.restaurant_id
       and o.is_active
     order by o.is_default desc, o.created_at asc
     limit 1;
    if new.outlet_id is null then
      insert into public.outlets (restaurant_id, name, is_default)
      values (new.restaurant_id, 'Main outlet', true)
      on conflict (restaurant_id) where is_default do nothing
      returning id into new.outlet_id;
      if new.outlet_id is null then
        select o.id into new.outlet_id
          from public.outlets o
         where o.restaurant_id = new.restaurant_id and o.is_default;
      end if;
    end if;
    if new.outlet_id is null then
      raise exception 'stock_movement_outlet_backstop: restaurant % has no active outlet.', new.restaurant_id;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.stock_movement_outlet_backstop() is
  'V2-07: BEFORE INSERT backstop — a null outlet_id resolves to the default active outlet (provisioning it when the restaurant has none). All RPCs set outlet_id explicitly; this covers direct inserts (fixtures, old clients). RLS still rejects forged outlet_ids.';

create trigger stock_movements_outlet_backstop
  before insert on public.stock_movements
  for each row execute function public.stock_movement_outlet_backstop();

-- ---------------------------------------------------------------------------
-- 6. current_stock per outlet; outlet-pinned RLS; indexes
-- ---------------------------------------------------------------------------

drop view if exists public.current_stock;

create view public.current_stock as
select
  restaurant_id,
  outlet_id,
  item_id,
  sum(quantity) as quantity,
  max(created_at) as last_movement_at
from public.stock_movements
group by restaurant_id, outlet_id, item_id;

alter view public.current_stock set (security_invoker = true);

-- The DROP above wiped the P2-01 view grant; restore it.
grant select on public.current_stock to authenticated;

comment on view public.current_stock is
  'V2-07: derived stock per (restaurant, outlet, item). security_invoker so the caller''s RLS (outlet-pinned) applies.';

drop policy stock_movements_select_own on public.stock_movements;
create policy stock_movements_select_outlet on public.stock_movements
  for select to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and outlet_id = public.my_current_outlet()
  );

comment on policy stock_movements_select_outlet on public.stock_movements is
  'V2-07: outlet isolation — a role sees only its current outlet''s movements. No owner bypass (owners switch outlets).';

drop policy stock_movements_insert_roles on public.stock_movements;
create policy stock_movements_insert_outlet on public.stock_movements
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager') or public.has_role('staff'))
    and outlet_id = public.my_current_outlet()
  );

-- The P6-03 composite assumed restaurant-wide reads; every read is now
-- outlet-scoped, so replace it with the outlet-leading composite.
drop index public.stock_movements_restaurant_item_created_idx;
create index stock_movements_outlet_item_created_idx
  on public.stock_movements (restaurant_id, outlet_id, item_id, created_at desc, id desc);

comment on index public.stock_movements_outlet_item_created_idx is
  'V2-07: replaces the P6-03 composite; serves the outlet-pinned item-ledger page (listMovements) and listBatches.';

-- ---------------------------------------------------------------------------
-- 7. Outlet deactivation guard (SECURITY DEFINER: needs cross-outlet reads)
-- ---------------------------------------------------------------------------

create or replace function public.outlet_deactivation_guard()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_default uuid;
  v_net numeric;
begin
  if old.is_active and not new.is_active then
    -- A restaurant must keep at least one active outlet.
    if not exists (
      select 1 from public.outlets o
       where o.restaurant_id = old.restaurant_id
         and o.is_active
         and o.id <> old.id
    ) then
      raise exception 'outlet_deactivation_guard: "%" is the last active outlet — a restaurant must keep at least one active outlet.', old.name;
    end if;
    -- No stranded stock: net quantity across all items must be zero.
    select coalesce(sum(m.quantity), 0) into v_net
      from public.stock_movements m
     where m.outlet_id = old.id;
    if v_net <> 0 then
      raise exception 'outlet_deactivation_guard: "%" still holds stock (net %). Transfer it out before deactivating.', old.name, v_net;
    end if;
    -- Re-pin users of this outlet to the (new) default outlet.
    select o.id into v_default
      from public.outlets o
     where o.restaurant_id = old.restaurant_id
       and o.is_active
       and o.id <> old.id
     order by o.is_default desc, o.created_at asc
     limit 1;
    update public.profiles p
       set current_outlet_id = v_default, updated_at = now()
     where p.current_outlet_id = old.id;
    -- If the default is going away, clear its flag now; the AFTER trigger
    -- promotes the successor (it cannot be done here: the outer UPDATE
    -- hasn't written yet, so the partial unique index would see two
    -- defaults, and we may not UPDATE our own row from a BEFORE trigger).
    if old.is_default then
      new.is_default := false;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.outlet_deactivation_guard() is
  'V2-07: BEFORE UPDATE OF is_active on outlets. Blocks deactivating the last active outlet and deactivating with non-zero net stock; re-pins affected users; promotes a new default when the default is deactivated. SECURITY DEFINER so the stock check sees all outlets.';

create trigger outlets_deactivation_guard
  before update of is_active on public.outlets
  for each row execute function public.outlet_deactivation_guard();

-- AFTER trigger: promote a new default when the default was deactivated.
-- Runs after the row is written, so the partial unique index never sees
-- two defaults.
create or replace function public.outlet_default_promotion()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_successor uuid;
begin
  if old.is_default and old.is_active and not new.is_active then
    select o.id into v_successor
      from public.outlets o
     where o.restaurant_id = old.restaurant_id
       and o.is_active
       and o.id <> old.id
     order by o.created_at asc
     limit 1;
    if v_successor is not null then
      update public.outlets set is_default = true where id = v_successor;
    end if;
  end if;
  return new;
end;
$$;

create trigger outlets_default_promotion
  after update of is_active on public.outlets
  for each row execute function public.outlet_default_promotion();

comment on function public.outlet_default_promotion() is
  'V2-07: AFTER trigger companion to outlet_deactivation_guard — promotes the oldest remaining active outlet to default when the default is deactivated.';

-- ---------------------------------------------------------------------------
-- 8. Outlet columns on stock_counts, notifications, pos_imports
-- ---------------------------------------------------------------------------

alter table public.stock_counts
  add column outlet_id uuid references public.outlets(id) on delete restrict;

update public.stock_counts sc
   set outlet_id = o.id
  from public.outlets o
 where sc.outlet_id is null
   and o.restaurant_id = sc.restaurant_id
   and o.is_default;

alter table public.stock_counts alter column outlet_id set not null;

comment on column public.stock_counts.outlet_id is
  'V2-07: the outlet being counted. Set by create_stock_count from the caller''s effective outlet.';

alter table public.notifications
  add column outlet_id uuid references public.outlets(id) on delete restrict;

update public.notifications n
   set outlet_id = o.id
  from public.outlets o
 where n.outlet_id is null
   and o.restaurant_id = n.restaurant_id
   and o.is_default;

alter table public.notifications alter column outlet_id set not null;

comment on column public.notifications.outlet_id is
  'V2-07: the outlet the alert was evaluated for. The alert engine tags new rows; the inbox is outlet-pinned by RLS.';

-- Dedupe is now per outlet.
drop index if exists public.notifications_dedupe_unique;
create unique index notifications_dedupe_unique
  on public.notifications (restaurant_id, outlet_id, type, item_id, coalesce(batch_no, ''));

alter table public.pos_imports
  add column outlet_id uuid references public.outlets(id) on delete restrict;

update public.pos_imports pi
   set outlet_id = o.id
  from public.outlets o
 where pi.outlet_id is null
   and o.restaurant_id = pi.restaurant_id
   and o.is_default;

alter table public.pos_imports alter column outlet_id set not null;

comment on column public.pos_imports.outlet_id is
  'V2-07: the outlet the imported sale was posted to (via record_sales → the importer''s effective outlet).';

-- ---------------------------------------------------------------------------
-- 8b. Context backstop for notifications (fills restaurant + outlet)
-- ---------------------------------------------------------------------------
-- The client alert engine inserts bare alert rows (type/title/item); the
-- tenant and outlet always come from the session, never the client. This
-- also repairs a V2-03 gap where createNotification() omitted restaurant_id.
create or replace function public.notification_context_backstop()
returns trigger
language plpgsql
as $$
begin
  if new.restaurant_id is null then
    new.restaurant_id := public.current_restaurant_id();
  end if;
  if new.outlet_id is null then
    new.outlet_id := public.effective_outlet_id();
  end if;
  return new;
end;
$$;

create trigger notifications_context_backstop
  before insert on public.notifications
  for each row execute function public.notification_context_backstop();

comment on function public.notification_context_backstop() is
  'V2-07: fills notifications.restaurant_id/outlet_id from the session when the inserter omits them (the client alert engine inserts bare rows). Context is unforgeable.';

-- pos_imports rows are written by import_pos_sales (which sets the outlet
-- explicitly), but a backstop keeps direct inserts / fixtures working.
create or replace function public.pos_import_outlet_backstop()
returns trigger
language plpgsql
as $$
begin
  if new.outlet_id is null then
    new.outlet_id := public.effective_outlet_id();
  end if;
  return new;
end;
$$;

create trigger pos_imports_outlet_backstop
  before insert on public.pos_imports
  for each row execute function public.pos_import_outlet_backstop();

-- ---------------------------------------------------------------------------
-- 9. RLS: outlet pin on stock_counts, notifications, pos_imports
-- ---------------------------------------------------------------------------

-- stock_counts: the outlet pin composes with the existing role rules.
-- (stock_count_lines stays parent-scoped via stock_count_visible(), which
-- now only finds counts in the caller's outlet.)
drop policy stock_counts_all_manager on public.stock_counts;
create policy stock_counts_all_manager on public.stock_counts
  to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager'))
    and outlet_id = public.my_current_outlet()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager'))
    and outlet_id = public.my_current_outlet()
  );

drop policy stock_counts_select_assigned on public.stock_counts;
create policy stock_counts_select_assigned on public.stock_counts
  for select to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('staff')
    and assigned_to = public.current_user_id()
    and outlet_id = public.my_current_outlet()
  );

drop policy stock_counts_update_assigned on public.stock_counts;
create policy stock_counts_update_assigned on public.stock_counts
  for update to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('staff')
    and assigned_to = public.current_user_id()
    and outlet_id = public.my_current_outlet()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.has_role('staff')
    and assigned_to = public.current_user_id()
    and outlet_id = public.my_current_outlet()
  );

drop policy notifications_owner_manager on public.notifications;
create policy notifications_owner_manager on public.notifications
  to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager'))
    and outlet_id = public.my_current_outlet()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager'))
    and outlet_id = public.my_current_outlet()
  );

drop policy pos_imports_owner_manager on public.pos_imports;
create policy pos_imports_owner_manager on public.pos_imports
  to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager'))
    and outlet_id = public.my_current_outlet()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and (public.has_role('owner') or public.has_role('manager'))
    and outlet_id = public.my_current_outlet()
  );

-- ---------------------------------------------------------------------------
-- 10. Stock-writing RPCs become outlet-aware
--
-- Every RPC resolves its outlet via effective_outlet_id() (the caller's
-- pinned/default outlet — never a client-supplied value, so it cannot be
-- forged). Costing stays restaurant-wide: receive_goods averages across
-- ALL outlets; only the over-sale/stock checks are outlet-scoped.
-- ---------------------------------------------------------------------------

-- receive_goods: movements carry the outlet; the weighted-average cost
-- still averages across all outlets (one shared cost book).
create or replace function public.receive_goods(p_lines jsonb, p_reference_type text DEFAULT 'ad_hoc'::text, p_reference_id uuid DEFAULT NULL::uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
  v_created_by uuid;
  v_line jsonb;
  v_idx int := 0;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_batch_no text;
  v_expiry date;
  v_notes text;
  v_old_avg numeric;
  v_active boolean;
  v_old_qty numeric;
  v_new_avg numeric;
  v_movement_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  -- Envelope validation ------------------------------------------------------
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'receive_goods: lines must be a JSON array of receipt lines.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'receive_goods: receipt must contain at least one line.';
  end if;
  if p_reference_type is null or btrim(p_reference_type) = '' then
    raise exception 'receive_goods: reference_type cannot be empty.';
  end if;

  -- Tenant + role (the function's own authority: it runs as definer, so
  -- these checks — not RLS — are what keep tenants and roles apart) --------
  if v_restaurant_id is null then
    raise exception 'receive_goods: no restaurant in session.';
  end if;
  if not (
    public.has_role('owner')
    or public.has_role('manager')
    or public.has_role('staff')
  ) then
    raise exception 'receive_goods: your role cannot receive stock.';
  end if;

  -- V2-07: the outlet comes from the caller's context, never the client.
  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'receive_goods: no active outlet in your restaurant.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Lines: validated and posted one by one inside this single transaction.
  -- Any exception below aborts the whole receipt (atomicity).
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;

    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'receive_goods: line % must be an object.', v_idx;
    end if;

    -- Per-line input validation ---------------------------------------------
    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
    exception when others then
      raise exception 'receive_goods: line %: item_id is not a valid UUID.', v_idx;
    end;
    if v_item_id is null then
      raise exception 'receive_goods: line %: item_id is required.', v_idx;
    end if;

    begin
      v_quantity := (v_line ->> 'quantity')::numeric;
    exception when others then
      raise exception 'receive_goods: line %: quantity must be a number.', v_idx;
    end;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'receive_goods: line %: quantity must be greater than zero (got %).', v_idx, v_quantity;
    end if;

    begin
      v_unit_cost := (v_line ->> 'unit_cost')::numeric;
    exception when others then
      raise exception 'receive_goods: line %: unit_cost must be a number.', v_idx;
    end;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'receive_goods: line %: unit cost cannot be negative (got %).', v_idx, v_unit_cost;
    end if;

    v_batch_no := nullif(trim(v_line ->> 'batch_no'), '');
    v_notes := nullif(trim(v_line ->> 'notes'), '');

    begin
      v_expiry := nullif(v_line ->> 'expiry_date', '')::date;
    exception when others then
      raise exception 'receive_goods: line %: expiry_date must be a valid date (YYYY-MM-DD).', v_idx;
    end;
    if v_expiry is not null and v_expiry < current_date then
      raise exception 'receive_goods: line %: expiry date % is in the past.', v_idx, v_expiry;
    end if;

    -- Item must exist, be active, and belong to the caller's restaurant -----
    select i.avg_unit_cost, i.active
      into v_old_avg, v_active
      from public.items i
     where i.id = v_item_id
       and i.restaurant_id = v_restaurant_id;
    if not found then
      raise exception 'receive_goods: line %: item % not found in your restaurant.', v_idx, v_item_id;
    end if;
    if not v_active then
      raise exception 'receive_goods: line %: item % is archived.', v_idx, v_item_id;
    end if;

    -- V2-07: the cost book is restaurant-wide — average across ALL outlets.
    -- current_stock has one row per (outlet, item); sum them.
    select coalesce(sum(cs.quantity), 0)
      into v_old_qty
      from public.current_stock cs
     where cs.restaurant_id = v_restaurant_id
       and cs.item_id = v_item_id;

    if v_old_qty > 0 then
      v_new_avg := (v_old_qty * v_old_avg + v_quantity * v_unit_cost)
                   / (v_old_qty + v_quantity);
    else
      v_new_avg := v_unit_cost;
    end if;

    -- Post the ledger row ----------------------------------------------------
    insert into public.stock_movements (
      restaurant_id, outlet_id, item_id, movement_type, quantity,
      batch_no, expiry_date, unit_cost, reference_type, reference_id,
      notes, created_by
    ) values (
      v_restaurant_id, v_outlet_id, v_item_id, 'receipt', v_quantity,
      v_batch_no, v_expiry, v_unit_cost, p_reference_type, p_reference_id,
      v_notes, v_created_by
    )
    returning id into v_movement_id;

    update public.items
       set avg_unit_cost = v_new_avg
     where id = v_item_id;

    v_results := v_results || jsonb_build_object(
      'movement_id', v_movement_id,
      'item_id', v_item_id,
      'quantity', v_quantity,
      'unit_cost', v_unit_cost,
      'old_avg_cost', v_old_avg,
      'new_avg_cost', v_new_avg
    );
  end loop;

  return v_results;
end;
$$;

comment on function public.receive_goods(jsonb, text, uuid) is
  'Ad hoc goods receiving (SECURITY DEFINER: staff may receive per the role matrix but RLS denies them item reads and the avg-cost update; the function enforces tenant+role itself and pins writes to the caller''s restaurant). Posts receipt movements with batch/expiry/unit-cost, recalculates weighted-average cost, atomic per call. Expiry optional; when provided it must be today or later. V2-07: movements carry the caller''s outlet; the cost book stays restaurant-wide (averaged across outlets).';

-- log_usage / log_wastage: outlet-aware (over-logging past zero still
-- permitted per outlet — same warn+allow philosophy as before).
create or replace function public.log_usage(p_item_id uuid, p_quantity numeric, p_reason text, p_notes text DEFAULT NULL::text)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
  v_created_by uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_active boolean;
  v_movement_id uuid;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'log_usage: no restaurant in session.';
  end if;
  if not (
    public.has_role('owner')
    or public.has_role('manager')
    or public.has_role('staff')
  ) then
    raise exception 'log_usage: your role cannot log usage.';
  end if;

  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'log_usage: no active outlet in your restaurant.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Input validation --------------------------------------------------------
  if p_item_id is null then
    raise exception 'log_usage: item is required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'log_usage: quantity must be greater than zero (got %).', p_quantity;
  end if;
  if v_reason is null then
    raise exception 'log_usage: a reason is required.';
  end if;
  if v_reason not in ('kitchen_use', 'staff_meal', 'tasting', 'other_usage') then
    raise exception 'log_usage: unknown reason code "%".', v_reason;
  end if;

  -- Item must exist, be active, and belong to the caller's restaurant --------
  select i.active into v_active
    from public.items i
   where i.id = p_item_id
     and i.restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'log_usage: item % not found in your restaurant.', p_item_id;
  end if;
  if not v_active then
    raise exception 'log_usage: item % is archived.', p_item_id;
  end if;

  -- Post the ledger row (negative quantity = stock out) ----------------------
  insert into public.stock_movements (
    restaurant_id, outlet_id, item_id, movement_type, quantity,
    reason_code, notes, created_by
  ) values (
    v_restaurant_id, v_outlet_id, p_item_id, 'usage', -p_quantity,
    v_reason, v_notes, v_created_by
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

comment on function public.log_usage(uuid, numeric, text, text) is
  'Log consumed stock (negative-quantity usage movement). Staff may call it; over-logging past zero stock is permitted (UI warns). V2-07: the movement carries the caller''s outlet.';

create or replace function public.log_wastage(p_item_id uuid, p_quantity numeric, p_reason text, p_notes text DEFAULT NULL::text)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
  v_created_by uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_active boolean;
  v_movement_id uuid;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'log_wastage: no restaurant in session.';
  end if;
  if not (
    public.has_role('owner')
    or public.has_role('manager')
    or public.has_role('staff')
  ) then
    raise exception 'log_wastage: your role cannot log wastage.';
  end if;

  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'log_wastage: no active outlet in your restaurant.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Input validation --------------------------------------------------------
  if p_item_id is null then
    raise exception 'log_wastage: item is required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'log_wastage: quantity must be greater than zero (got %).', p_quantity;
  end if;
  if v_reason is null then
    raise exception 'log_wastage: a reason is required.';
  end if;
  if v_reason not in ('expired', 'spoiled', 'damaged', 'over_prepared', 'other_wastage') then
    raise exception 'log_wastage: unknown reason code "%".', v_reason;
  end if;

  -- Item must exist, be active, and belong to the caller's restaurant --------
  select i.active into v_active
    from public.items i
   where i.id = p_item_id
     and i.restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'log_wastage: item % not found in your restaurant.', p_item_id;
  end if;
  if not v_active then
    raise exception 'log_wastage: item % is archived.', p_item_id;
  end if;

  -- Post the ledger row (negative quantity = stock out) ----------------------
  insert into public.stock_movements (
    restaurant_id, outlet_id, item_id, movement_type, quantity,
    reason_code, notes, created_by
  ) values (
    v_restaurant_id, v_outlet_id, p_item_id, 'wastage', -p_quantity,
    v_reason, v_notes, v_created_by
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

comment on function public.log_wastage(uuid, numeric, text, text) is
  'Log wasted stock (negative-quantity wastage movement). Staff may call it; over-logging past zero stock is permitted (UI warns). V2-07: the movement carries the caller''s outlet.';

-- create_opening_balance: outlet-aware; idempotency is now per (item, outlet).
create or replace function public.create_opening_balance(p_item_id uuid, p_quantity numeric, p_unit_cost numeric)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
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

  -- V2-07: outlet from the caller's context (SECURITY INVOKER — the
  -- effective_outlet_id() definer call enforces tenant internally).
  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'create_opening_balance: no active outlet in your restaurant.';
  end if;

  -- Idempotency: one opening balance per item per outlet ----------------------
  if exists (
    select 1 from public.stock_movements m
    where m.item_id = p_item_id
      and m.movement_type = 'opening_balance'
      and m.outlet_id = v_outlet_id
  ) then
    raise exception 'create_opening_balance: item % already has an opening balance at this outlet. Post a count adjustment instead.', p_item_id;
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  insert into public.stock_movements (
    restaurant_id, outlet_id, item_id, movement_type, quantity,
    unit_cost, created_by, notes
  ) values (
    v_restaurant_id, v_outlet_id, p_item_id, 'opening_balance', p_quantity,
    p_unit_cost, v_created_by, 'Opening balance'
  )
  returning id into v_movement_id;

  -- Seed the weighted-average cost: the first (and so far only) stock.
  -- (Restaurant-wide cost book: opening balances at any outlet seed it.)
  update public.items
    set avg_unit_cost = p_unit_cost
    where id = p_item_id;

  return v_movement_id;
end;
$$;

comment on function public.create_opening_balance(uuid, numeric, numeric) is
  'Posts the one-time opening-balance movement for an item and seeds avg_unit_cost. Owner/manager only. Raises (never silently succeeds) on duplicates. V2-07: the movement carries the caller''s outlet; idempotency is per (item, outlet).';

-- record_sales: deductions post to the caller's outlet; the over_sale flag
-- is computed against the OUTLET's live stock (not the restaurant total).
create or replace function public.record_sales(p_lines jsonb, p_sale_date date DEFAULT CURRENT_DATE)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $_$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
  v_created_by uuid;
  v_sale_date date := coalesce(p_sale_date, current_date);
  -- Accumulated deductions keyed by inventory item id.
  v_item_qty numeric[];
  v_item_ids uuid[];
  v_item_names text[];
  v_item_symbols text[];
  v_dish_notes text[];
  v_summary_ingredients jsonb := '[]'::jsonb;
  v_summary_lines jsonb := '[]'::jsonb;
  v_flagged_items jsonb := '[]'::jsonb;
  v_row record;
  v_seen_menu uuid[] := '{}';
  v_idx integer;
  v_item_id uuid;
  v_item_name text;
  v_current_qty numeric;
  v_over_sale boolean;
  v_any_over_sale boolean := false;
  v_notes text;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'record_sales: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'record_sales: your role cannot record sales.';
  end if;

  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'record_sales: no active outlet in your restaurant.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Shared recipe explosion (validates dishes, guards, conversion) ---------
  for v_row in select * from public.compute_sales_deductions(p_lines) loop
    v_idx := array_position(v_item_ids, v_row.item_id);
    if v_idx is null then
      v_item_ids := coalesce(v_item_ids, '{}') || v_row.item_id;
      v_item_qty := coalesce(v_item_qty, '{}') || v_row.deduction_base_qty;
      v_item_names := coalesce(v_item_names, '{}') || v_row.item_name;
      v_item_symbols := coalesce(v_item_symbols, '{}') || v_row.unit_symbol;
      v_dish_notes := coalesce(v_dish_notes, '{}')
        || format('%s x%s', v_row.menu_name, regexp_replace(to_char(v_row.dishes, 'FM999999999999990.099999'), '\.?0+$', ''));
    else
      v_item_qty[v_idx] := v_item_qty[v_idx] + v_row.deduction_base_qty;
      v_dish_notes[v_idx] := v_dish_notes[v_idx]
        || format(', %s x%s', v_row.menu_name, regexp_replace(to_char(v_row.dishes, 'FM999999999999990.099999'), '\.?0+$', ''));
    end if;

    -- Per-dish summary (one entry per dish, in first-seen order).
    if not (v_row.menu_item_id = any (v_seen_menu)) then
      v_seen_menu := v_seen_menu || v_row.menu_item_id;
      v_summary_lines := v_summary_lines || jsonb_build_object(
        'menu_item_id', v_row.menu_item_id,
        'name', v_row.menu_name,
        'dishes', v_row.dishes
      );
    end if;
  end loop;

  -- Post one aggregated movement per inventory item --------------------------
  if v_item_ids is null then
    raise exception 'record_sales: no ingredients to deduct.';
  end if;

  for v_idx in 1 .. array_length(v_item_ids, 1) loop
    v_item_id := v_item_ids[v_idx];
    v_item_name := v_item_names[v_idx];
    v_notes := format('Sale %s: %s', to_char(v_sale_date, 'YYYY-MM-DD'), v_dish_notes[v_idx]);

    -- The over_sale flag is computed here, at post time, from the live
    -- current stock of the OUTLET — never from the client's preview
    -- (transactions race).
    select coalesce(cs.quantity, 0) into v_current_qty
      from public.current_stock cs
     where cs.restaurant_id = v_restaurant_id
       and cs.outlet_id = v_outlet_id
       and cs.item_id = v_item_id;
    v_over_sale := (v_current_qty - v_item_qty[v_idx]) < 0;

    insert into public.stock_movements (
      restaurant_id, outlet_id, item_id, movement_type, quantity, notes, created_by, over_sale
    ) values (
      v_restaurant_id, v_outlet_id, v_item_id, 'sale_deduction', -v_item_qty[v_idx],
      v_notes, v_created_by, v_over_sale
    );

    if v_over_sale then
      v_any_over_sale := true;
      v_flagged_items := v_flagged_items || jsonb_build_object(
        'item_id', v_item_id,
        'name', v_item_name,
        'unit_symbol', v_item_symbols[v_idx],
        'current_quantity', v_current_qty,
        'deduction_quantity', v_item_qty[v_idx],
        'projected_quantity', v_current_qty - v_item_qty[v_idx]
      );
    end if;

    v_summary_ingredients := v_summary_ingredients || jsonb_build_object(
      'item_id', v_item_id,
      'name', v_item_name,
      'quantity', v_item_qty[v_idx],
      'unit_symbol', v_item_symbols[v_idx]
    );
  end loop;

  -- Audit: one entry per over-sale call (not per movement) -------------------
  if v_any_over_sale then
    insert into public.audit_log (
      restaurant_id, action, entity_type, details, created_by
    ) values (
      v_restaurant_id,
      'over_sale',
      'stock_movement',
      jsonb_build_object(
        'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
        'outlet_id', v_outlet_id,
        'lines', v_summary_lines,
        'flagged_items', v_flagged_items
      ),
      v_created_by
    );
  end if;

  return jsonb_build_object(
    'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
    'lines', v_summary_lines,
    'ingredients', v_summary_ingredients
  );
end;
$_$;

comment on function public.record_sales(jsonb, date) is
  'Record a day''s sales: explodes each dish''s recipe into per-ingredient sale_deduction movements (base units, aggregated per item). Owner/manager only. Movements that take stock below zero are flagged over_sale=true and one audit_log ''over_sale'' row is written per call. V2-07: deductions post to the caller''s outlet; the over_sale check is outlet-scoped.';

-- preview_sales_deductions: outlet-scoped preview.
create or replace function public.preview_sales_deductions(p_lines jsonb)
returns table(item_id uuid, item_name text, unit_symbol text, current_quantity numeric, deduction_quantity numeric, projected_quantity numeric, would_go_negative boolean)
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
begin
  if v_restaurant_id is null then
    raise exception 'preview_sales_deductions: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'preview_sales_deductions: your role cannot record sales.';
  end if;

  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'preview_sales_deductions: no active outlet in your restaurant.';
  end if;

  -- One row per inventory item (aggregated across dishes, exactly as
  -- record_sales will post it), with the live current stock of the outlet.
  return query
    select
      d.item_id,
      max(d.item_name),
      max(d.unit_symbol),
      coalesce(max(cs.quantity), 0),
      sum(d.deduction_base_qty),
      coalesce(max(cs.quantity), 0) - sum(d.deduction_base_qty),
      coalesce(max(cs.quantity), 0) - sum(d.deduction_base_qty) < 0
    from public.compute_sales_deductions(p_lines) d
    left join public.current_stock cs
      on cs.restaurant_id = v_restaurant_id
     and cs.outlet_id = v_outlet_id
     and cs.item_id = d.item_id
    group by d.item_id;
end;
$$;

comment on function public.preview_sales_deductions(jsonb) is
  'Pre-submit over-sale check: per-item deduction vs live current stock of the caller''s outlet. The UI shows the warning; record_sales still computes the flag itself at post time (separate transactions can race).';

-- create_stock_count: the session belongs to the caller's outlet; the
-- expected-qty snapshot comes from the outlet-pinned current_stock.
create or replace function public.create_stock_count(p_title text, p_assigned_to uuid DEFAULT NULL::uuid)
returns public.stock_counts
language plpgsql
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
  v_created_by uuid := public.current_user_id();
  v_count public.stock_counts;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if v_restaurant_id is null then
    raise exception 'create_stock_count: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'create_stock_count: your role cannot create stock counts.';
  end if;
  if v_title is null then
    raise exception 'create_stock_count: a title is required.';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'create_stock_count: title is too long (max 200 characters).';
  end if;

  -- V2-07: the count session belongs to the caller's outlet.
  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'create_stock_count: no active outlet in your restaurant.';
  end if;

  -- Assignee must be a profile of THIS restaurant (null = unassigned).
  if p_assigned_to is not null then
    if not exists (
      select 1 from public.profiles
       where id = p_assigned_to
         and restaurant_id = v_restaurant_id
    ) then
      raise exception 'create_stock_count: assignee is not a user of this restaurant.';
    end if;
  end if;

  insert into public.stock_counts
    (restaurant_id, outlet_id, title, assigned_to, created_by)
  values
    (v_restaurant_id, v_outlet_id, v_title, p_assigned_to, v_created_by)
  returning * into v_count;

  -- Snapshot: one line per ACTIVE item; expected = current_stock of the
  -- OUTLET (0 when the item has no movements yet). Archived items excluded.
  -- current_stock is security_invoker: the caller's outlet-pinned RLS applies.
  insert into public.stock_count_lines
    (count_id, restaurant_id, item_id, expected_qty)
  select
    v_count.id,
    v_restaurant_id,
    i.id,
    coalesce(cs.quantity, 0)
  from public.items i
  left join public.current_stock cs
    on cs.item_id = i.id
  where i.restaurant_id = v_restaurant_id
    and i.active = true
  on conflict (count_id, item_id) do nothing;

  return v_count;
end;
$$;

comment on function public.create_stock_count(text, uuid) is
  'Create a stock count session and snapshot one line per active item (expected_qty from current_stock). Owner/manager only; assignee must belong to the same restaurant. V2-07: the session and its snapshot belong to the caller''s outlet.';

-- apply_stock_count: adjustments post to the COUNT's outlet (not the
-- approver's current outlet — the count was performed there).
create or replace function public.apply_stock_count(p_count_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_count public.stock_counts;
  v_outlet_id uuid;
  v_total_lines integer;
  v_posted integer := 0;
  v_adjustments jsonb := '[]'::jsonb;
  v_line record;
  v_variance numeric;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'apply_stock_count: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'apply_stock_count: your role cannot apply stock counts.';
  end if;

  -- created_by from the JWT subject; null when the claim is absent/invalid.
  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  select * into v_count
    from public.stock_counts
   where id = p_count_id;
  if not found then
    raise exception 'apply_stock_count: stock count not found.';
  end if;
  if v_count.restaurant_id is distinct from v_restaurant_id then
    raise exception 'apply_stock_count: stock count belongs to another restaurant.';
  end if;
  if v_count.status = 'applied' then
    raise exception 'apply_stock_count: this count was already applied.';
  end if;
  if v_count.status <> 'submitted' then
    raise exception 'apply_stock_count: only a submitted count can be applied (current: %).', v_count.status;
  end if;

  -- V2-07: adjustments belong to the outlet that was counted.
  v_outlet_id := v_count.outlet_id;
  if v_outlet_id is null then
    raise exception 'apply_stock_count: stock count has no outlet.';
  end if;

  -- Every line must be counted — a null counted_qty makes the variance
  -- meaningless. (The UI only offers submit when every line is counted;
  -- this is the server-side backstop.)
  if exists (
    select 1 from public.stock_count_lines
     where count_id = v_count.id
       and counted_qty is null
  ) then
    raise exception 'apply_stock_count: every line must be counted before applying.';
  end if;

  select count(*) into v_total_lines
    from public.stock_count_lines
   where count_id = v_count.id;

  -- Post one signed movement per non-zero variance ----------------------------
  for v_line in
    select l.id, l.item_id, l.expected_qty, l.counted_qty,
           i.name as item_name, u.symbol as unit_symbol
      from public.stock_count_lines l
      join public.items i on i.id = l.item_id
      join public.units u on u.id = i.unit_id
     where l.count_id = v_count.id
     order by i.name
  loop
    v_variance := v_line.counted_qty - v_line.expected_qty;
    v_adjustments := v_adjustments || jsonb_build_object(
      'item_id', v_line.item_id,
      'name', v_line.item_name,
      'unit_symbol', v_line.unit_symbol,
      'expected_qty', v_line.expected_qty,
      'counted_qty', v_line.counted_qty,
      'variance', v_variance
    );
    if v_variance = 0 then
      continue;
    end if;
    insert into public.stock_movements (
      restaurant_id, outlet_id, item_id, movement_type, quantity,
      reference_type, reference_id, notes, created_by
    ) values (
      v_restaurant_id, v_outlet_id, v_line.item_id, 'count_adjustment', v_variance,
      'stock_count', v_count.id,
      format('Stock count "%s": counted %s vs expected %s (variance %s %s)',
        v_count.title,
        to_char(v_line.counted_qty, 'FM999999999999990.099999'),
        to_char(v_line.expected_qty, 'FM999999999999990.099999'),
        case when v_variance > 0 then '+' else '' end
          || to_char(v_variance, 'FM999999999999990.099999'),
        v_line.unit_symbol),
      v_created_by
    );
    v_posted := v_posted + 1;
  end loop;

  -- Mark applied (the status trigger is the machine's authority; the RPC
  -- runs as definer but the caller's claims still say owner/manager).
  update public.stock_counts
     set status = 'applied'
   where id = v_count.id;

  -- Audit: one entry per apply, with the full per-line variance payload.
  insert into public.audit_log (
    restaurant_id, action, entity_type, entity_id, details, created_by
  ) values (
    v_restaurant_id,
    'stock_count_applied',
    'stock_count',
    v_count.id,
    jsonb_build_object(
      'title', v_count.title,
      'outlet_id', v_outlet_id,
      'total_lines', v_total_lines,
      'posted_adjustments', v_posted,
      'adjustments', v_adjustments
    ),
    v_created_by
  );

  return jsonb_build_object(
    'count_id', v_count.id,
    'title', v_count.title,
    'status', 'applied',
    'total_lines', v_total_lines,
    'posted_adjustments', v_posted,
    'adjustments', v_adjustments
  );
end;
$$;

comment on function public.apply_stock_count(uuid) is
  'Review + approve a submitted stock count: posts one signed count_adjustment movement per non-zero variance (counted − expected), marks the session applied, writes one audit_log row. Owner/manager only; re-applying raises. V2-07: adjustments post to the count''s outlet.';

-- import_pos_sales: the import rows carry the outlet (inherited from
-- record_sales via the caller's effective outlet).
create or replace function public.import_pos_sales(p_provider text, p_sales jsonb, p_sale_date date DEFAULT CURRENT_DATE)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_outlet_id uuid;
  v_created_by uuid;
  v_sale_date date := coalesce(p_sale_date, current_date);
  v_sale record;
  v_agg_menu_ids uuid[];
  v_agg_dishes numeric[];
  v_idx integer;
  v_menu_id uuid;
  v_dishes numeric;
  v_lines jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_imported integer := 0;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'import_pos_sales: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'import_pos_sales: your role cannot import POS sales.';
  end if;

  v_outlet_id := public.effective_outlet_id();
  if v_outlet_id is null then
    raise exception 'import_pos_sales: no active outlet in your restaurant.';
  end if;

  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Input shape -------------------------------------------------------------
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'import_pos_sales: provider is required.';
  end if;
  if p_sales is null or jsonb_typeof(p_sales) <> 'array' then
    raise exception 'import_pos_sales: sales must be a JSON array.';
  end if;
  if jsonb_array_length(p_sales) = 0 then
    raise exception 'import_pos_sales: at least one sale is required.';
  end if;

  for v_sale in
    select
      btrim(line ->> 'external_sale_id') as external_sale_id,
      (line ->> 'menu_item_id')::uuid as menu_item_id,
      (line ->> 'dishes')::numeric as dishes,
      nullif(line ->> 'sold_at', '')::timestamptz as sold_at
    from jsonb_array_elements(p_sales) as line
  loop
    if v_sale.external_sale_id is null or v_sale.external_sale_id = '' then
      raise exception 'import_pos_sales: every sale needs an external_sale_id.';
    end if;
    if v_sale.menu_item_id is null then
      raise exception 'import_pos_sales: every sale needs a menu_item_id.';
    end if;
    if v_sale.dishes is null or v_sale.dishes <= 0 then
      raise exception 'import_pos_sales: dishes must be greater than zero (sale %).',
        v_sale.external_sale_id;
    end if;

    -- Dedupe backstop: the unique index enforces this too, but raising here
    -- gives a clear message naming the offending sale.
    if exists (
      select 1 from public.pos_imports pi
       where pi.restaurant_id = v_restaurant_id
         and pi.provider = btrim(p_provider)
         and pi.external_sale_id = v_sale.external_sale_id
    ) then
      raise exception 'import_pos_sales: sale % was already imported.',
        v_sale.external_sale_id;
    end if;

    -- Aggregate per dish: record_sales rejects duplicate dishes in one call.
    v_idx := array_position(v_agg_menu_ids, v_sale.menu_item_id);
    if v_idx is null then
      v_agg_menu_ids := coalesce(v_agg_menu_ids, '{}') || v_sale.menu_item_id;
      v_agg_dishes := coalesce(v_agg_dishes, '{}') || v_sale.dishes;
    else
      v_agg_dishes[v_idx] := v_agg_dishes[v_idx] + v_sale.dishes;
    end if;

    -- Record the import row per original POS line.
    insert into public.pos_imports
      (restaurant_id, outlet_id, provider, external_sale_id, menu_item_id,
       dishes, sold_at, sale_date, created_by)
    values
      (v_restaurant_id, v_outlet_id, btrim(p_provider), v_sale.external_sale_id,
       v_sale.menu_item_id, v_sale.dishes, v_sale.sold_at,
       v_sale_date, v_created_by);
    v_imported := v_imported + 1;
  end loop;

  -- Build the aggregated lines for record_sales -----------------------------
  for v_idx in 1 .. array_length(v_agg_menu_ids, 1) loop
    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_agg_menu_ids[v_idx],
      'dishes', v_agg_dishes[v_idx]
    );
  end loop;

  -- Post through record_sales: identical ledger effects, over_sale flags
  -- and audit entries to a manual sales entry. The nested SECURITY DEFINER
  -- call sees the same JWT claims; its own tenant/role guards re-apply, and
  -- it resolves the same effective outlet.
  v_summary := public.record_sales(v_lines, v_sale_date);

  return jsonb_build_object(
    'provider', btrim(p_provider),
    'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
    'imported', v_imported,
    'sales', v_summary
  );
end;
$$;

comment on function public.import_pos_sales(text, jsonb, date) is
  'Import POS sales atomically: aggregates lines per dish, posts via record_sales (same ledger/over_sale/audit behavior as manual entry), and records pos_imports rows. Re-importing an external sale raises. Owner/manager only. V2-07: rows carry the importer''s outlet.';

-- ---------------------------------------------------------------------------
-- 11. transfer_stock: atomic inter-outlet transfer
-- ---------------------------------------------------------------------------

create or replace function public.transfer_stock(
  p_to_outlet_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_batch_no text default null,
  p_notes text default null
)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_from_outlet_id uuid;
  v_created_by uuid;
  v_to_outlet public.outlets;
  v_from_name text;
  v_batch_no text := nullif(btrim(coalesce(p_batch_no, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_item_active boolean;
  v_unit_symbol text;
  v_item_name text;
  v_avg numeric;
  v_on_hand numeric;
  v_batch_on_hand numeric;
  v_batch_expiry date;
  v_group_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
begin
  -- Tenant + role ------------------------------------------------------------
  if v_restaurant_id is null then
    raise exception 'transfer_stock: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'transfer_stock: only owners and managers can transfer stock between outlets.';
  end if;

  -- The source outlet is the caller's context — never a client parameter.
  v_from_outlet_id := public.effective_outlet_id();
  if v_from_outlet_id is null then
    raise exception 'transfer_stock: no active outlet in your restaurant.';
  end if;

  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Destination validation ----------------------------------------------------
  if p_to_outlet_id is null then
    raise exception 'transfer_stock: destination outlet is required.';
  end if;
  if p_to_outlet_id = v_from_outlet_id then
    raise exception 'transfer_stock: source and destination outlets must differ.';
  end if;
  select * into v_to_outlet from public.outlets where id = p_to_outlet_id;
  if not found then
    raise exception 'transfer_stock: destination outlet not found.';
  end if;
  if v_to_outlet.restaurant_id is distinct from v_restaurant_id then
    raise exception 'transfer_stock: destination outlet belongs to another restaurant.';
  end if;
  if not v_to_outlet.is_active then
    raise exception 'transfer_stock: destination outlet "%" is deactivated.', v_to_outlet.name;
  end if;

  select o.name into v_from_name from public.outlets o where o.id = v_from_outlet_id;

  -- Item + quantity validation -------------------------------------------------
  if p_item_id is null then
    raise exception 'transfer_stock: item is required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'transfer_stock: quantity must be greater than zero (got %).', p_quantity;
  end if;
  select i.active, i.avg_unit_cost, i.name, u.symbol
    into v_item_active, v_avg, v_item_name, v_unit_symbol
    from public.items i
    join public.units u on u.id = i.unit_id
   where i.id = p_item_id
     and i.restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'transfer_stock: item % not found in your restaurant.', p_item_id;
  end if;
  if not v_item_active then
    raise exception 'transfer_stock: item "%" is archived.', v_item_name;
  end if;

  -- Strict on-hand check at the SOURCE outlet (transfers move physical
  -- stock — unlike wastage/usage, going negative is not permitted).
  if v_batch_no is not null then
    select coalesce(sum(m.quantity), 0), max(m.expiry_date)
      into v_batch_on_hand, v_batch_expiry
      from public.stock_movements m
     where m.restaurant_id = v_restaurant_id
       and m.outlet_id = v_from_outlet_id
       and m.item_id = p_item_id
       and m.batch_no = v_batch_no;
    if v_batch_on_hand <= 0 then
      raise exception 'transfer_stock: batch "%" holds no stock at "%".', v_batch_no, v_from_name;
    end if;
    if v_batch_on_hand < p_quantity then
      raise exception 'transfer_stock: batch "%" holds only % % at "%" (requested %).',
        v_batch_no, v_batch_on_hand, v_unit_symbol, v_from_name, p_quantity;
    end if;
  else
    select coalesce(sum(cs.quantity), 0) into v_on_hand
      from public.current_stock cs
     where cs.restaurant_id = v_restaurant_id
       and cs.outlet_id = v_from_outlet_id
       and cs.item_id = p_item_id;
    if v_on_hand < p_quantity then
      raise exception 'transfer_stock: "%" holds only % % at "%" (requested %).',
        v_item_name, v_on_hand, v_unit_symbol, v_from_name, p_quantity;
    end if;
  end if;

  -- Paired movements, one transaction: out of source, into destination.
  -- unit_cost carries the restaurant-wide average (informational); the
  -- transfer never moves avg_unit_cost.
  insert into public.stock_movements (
    restaurant_id, outlet_id, item_id, movement_type, quantity,
    batch_no, expiry_date, unit_cost,
    reference_type, reference_id, notes, created_by
  ) values (
    v_restaurant_id, v_from_outlet_id, p_item_id, 'transfer_out', -p_quantity,
    v_batch_no, v_batch_expiry, coalesce(v_avg, 0),
    'transfer', v_group_id,
    format('Transfer to %s: %s %s%s', v_to_outlet.name,
      to_char(p_quantity, 'FM999999999999990.099999'), v_unit_symbol,
      case when v_notes is not null then ' — ' || v_notes else '' end),
    v_created_by
  ) returning id into v_out_id;

  insert into public.stock_movements (
    restaurant_id, outlet_id, item_id, movement_type, quantity,
    batch_no, expiry_date, unit_cost,
    reference_type, reference_id, notes, created_by
  ) values (
    v_restaurant_id, p_to_outlet_id, p_item_id, 'transfer_in', p_quantity,
    v_batch_no, v_batch_expiry, coalesce(v_avg, 0),
    'transfer', v_group_id,
    format('Transfer from %s: %s %s%s', v_from_name,
      to_char(p_quantity, 'FM999999999999990.099999'), v_unit_symbol,
      case when v_notes is not null then ' — ' || v_notes else '' end),
    v_created_by
  ) returning id into v_in_id;

  -- Audit trail (owner-only reads, like all audit rows).
  insert into public.audit_log (
    restaurant_id, action, entity_type, entity_id, details, created_by
  ) values (
    v_restaurant_id,
    'stock_transfer',
    'stock_movement',
    v_group_id,
    jsonb_build_object(
      'from_outlet_id', v_from_outlet_id,
      'from_outlet_name', v_from_name,
      'to_outlet_id', p_to_outlet_id,
      'to_outlet_name', v_to_outlet.name,
      'item_id', p_item_id,
      'item_name', v_item_name,
      'quantity', p_quantity,
      'unit_symbol', v_unit_symbol,
      'batch_no', v_batch_no,
      'notes', v_notes
    ),
    v_created_by
  );

  return jsonb_build_object(
    'transfer_id', v_group_id,
    'from_outlet_id', v_from_outlet_id,
    'from_outlet_name', v_from_name,
    'to_outlet_id', p_to_outlet_id,
    'to_outlet_name', v_to_outlet.name,
    'item_id', p_item_id,
    'item_name', v_item_name,
    'quantity', p_quantity,
    'unit_symbol', v_unit_symbol,
    'batch_no', v_batch_no,
    'transfer_out_movement_id', v_out_id,
    'transfer_in_movement_id', v_in_id
  );
end;
$$;

comment on function public.transfer_stock(uuid, uuid, numeric, text, text) is
  'V2-07: atomic inter-outlet transfer. The source is the caller''s outlet (never client-supplied); the destination must be a different active outlet of the same restaurant. Posts paired transfer_out/transfer_in movements sharing one reference_id, with batch/expiry preserved when a batch is given. Over-transfer raises (strict). Owner/manager only. Writes one audit_log ''stock_transfer'' row.';

-- ---------------------------------------------------------------------------
-- 12. Execute grants (RLS stays the authority)
-- ---------------------------------------------------------------------------

grant execute on function public.my_current_outlet() to authenticated;
grant execute on function public.effective_outlet_id() to authenticated;
grant execute on function public.switch_outlet(uuid) to authenticated;
grant execute on function public.ensure_current_outlet() to authenticated;
grant execute on function public.transfer_stock(uuid, uuid, numeric, text, text) to authenticated;
