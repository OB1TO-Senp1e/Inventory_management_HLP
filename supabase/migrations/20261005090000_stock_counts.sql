-- ============================================================================
-- P5-01 — Stock count sessions: create, count-sheet data model, save progress.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `stock_counts` (one row per count session):
--   title, status (draft / in_progress / submitted), assigned_to
--   (profiles.id = auth user id; null = unassigned). P5-02 owns the
--   variance review and apply_stock_count; statuses beyond `submitted`
--   land there.
--
-- `stock_count_lines` (one row per item in a session):
--   expected_qty is snapshotted from `current_stock` at creation time and
--   FROZEN afterwards (the trigger rejects changes); counted_qty starts
--   NULL and is filled in as the sheet is worked. Lines are working data —
--   they may be edited until the session is submitted, so the ledger's
--   append-only rule does NOT apply here (that rule covers
--   stock_movements only).
--
-- Creation goes through `create_stock_count(p_title, p_assigned_to)` —
-- SECURITY INVOKER (the caller's RLS applies, like P3-01's
-- `create_purchase_order`): it validates the assignee, inserts the session,
-- and snapshots one line per ACTIVE item with the expected quantity from
-- `current_stock` (missing row = 0). Archived items are excluded.
--
-- Role model (ARCHITECTURE.md §7): owner/manager create sessions and see
-- all of them; staff see and work ONLY their assigned sessions.
--   * stock_counts INSERT: owner/manager only.
--   * stock_counts SELECT: owner/manager (own restaurant) OR staff whose
--     user id = assigned_to.
--   * stock_counts UPDATE: owner/manager (any field) OR staff on their own
--     assigned sessions — but the trigger rejects non-manager changes to
--     title/assigned_to, so staff can only move status.
--   * stock_count_lines SELECT/INSERT/UPDATE/DELETE keyed off the same
--     visibility (line-level policies join back to stock_counts).
--
-- Status machine (trigger, not only UI): draft → in_progress →
-- submitted; draft → submitted is allowed (a fully-counted sheet can go
-- straight to review); submitted is terminal. Once submitted, the session
-- and its lines are frozen.
--
-- "Offline-tolerant" (acceptance): save-on-change with debounce and visible
-- retry feedback on the client — NOT a separate offline store. The real
-- offline queue is P6-02's scope.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- current_user_id(): the caller's auth user id from the JWT subject.
-- Mirrors current_restaurant_id()/has_role() (P0-03) — same mechanism
-- Supabase uses to populate auth.jwt() on cloud.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text;
begin
  if v_claims is null or v_claims = '' then
    return null;
  end if;
  begin
    v_sub := (v_claims::jsonb) ->> 'sub';
    if v_sub is null or v_sub = '' then
      return null;
    end if;
    return v_sub::uuid;
  exception when others then
    return null;
  end;
end;
$$;

comment on function public.current_user_id() is
  'The caller''s auth user id (JWT sub). SECURITY INVOKER — same claims mechanism as current_restaurant_id()/has_role().';

-- ---------------------------------------------------------------------------
-- stock_counts: count sessions
-- ---------------------------------------------------------------------------

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'submitted')),
  assigned_to uuid null references public.profiles (id) on delete set null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_counts is
  'Stock count sessions (P5-01). Owner/manager create and assign; staff work assigned sessions. P5-02 owns variance review/approval.';

comment on column public.stock_counts.assigned_to is
  'profiles.id (= auth user id) of the person assigned to count; null = unassigned.';

create index stock_counts_restaurant_id_idx on public.stock_counts (restaurant_id);
create index stock_counts_assigned_to_idx on public.stock_counts (assigned_to);
create index stock_counts_status_idx on public.stock_counts (status);

create trigger stock_counts_set_updated_at
  before update on public.stock_counts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- stock_count_lines: one row per item in a session
-- ---------------------------------------------------------------------------

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete restrict,
  expected_qty numeric not null check (expected_qty >= 0),
  counted_qty numeric null check (counted_qty is null or counted_qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (count_id, item_id)
);

comment on table public.stock_count_lines is
  'Count sheet rows (P5-01). expected_qty is a frozen snapshot taken at session creation; counted_qty is filled in as the sheet is worked.';

comment on column public.stock_count_lines.expected_qty is
  'Snapshot of current_stock at creation — frozen afterwards (trigger rejects changes).';

create index stock_count_lines_count_id_idx on public.stock_count_lines (count_id);
create index stock_count_lines_item_id_idx on public.stock_count_lines (item_id);

create trigger stock_count_lines_set_updated_at
  before update on public.stock_count_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Triggers: status machine, field freezing, role-scoped field rules
-- ---------------------------------------------------------------------------

-- stock_counts: enforce the status machine and keep staff from touching
-- title/assigned_to (staff may move status on their own assigned sessions).
create or replace function public.stock_count_status_guard()
returns trigger
language plpgsql
as $$
declare
  v_is_manager boolean :=
    public.has_role('owner') or public.has_role('manager');
begin
  -- Field scope: non-managers may only change status.
  if not v_is_manager then
    if new.title is distinct from old.title
       or new.assigned_to is distinct from old.assigned_to
       or new.restaurant_id is distinct from old.restaurant_id then
      raise exception 'stock_counts: only owner/manager may change title, assignment or restaurant.';
    end if;
  end if;

  -- Status machine.
  if new.status is distinct from old.status then
    if old.status = 'submitted' then
      raise exception 'stock_counts: a submitted count is final (variance review happens in P5-02).';
    end if;
    if old.status = 'draft'
       and new.status not in ('in_progress', 'submitted') then
      raise exception 'stock_counts: illegal status transition draft → %.', new.status;
    end if;
    if old.status = 'in_progress' and new.status <> 'submitted' then
      raise exception 'stock_counts: illegal status transition in_progress → %.', new.status;
    end if;
  end if;

  return new;
end;
$$;

create trigger stock_counts_status_guard
  before update on public.stock_counts
  for each row execute function public.stock_count_status_guard();

-- stock_count_lines: expected_qty is frozen after insert; identity columns
-- are immutable; nothing may change once the parent session is submitted.
create or replace function public.stock_count_lines_guard()
returns trigger
language plpgsql
as $$
declare
  v_parent_status text;
begin
  if TG_OP = 'UPDATE' then
    select status into v_parent_status
      from public.stock_counts
     where id = old.count_id;

    if v_parent_status = 'submitted' then
      raise exception 'stock_count_lines: the count is submitted — lines are frozen.';
    end if;
    if new.count_id is distinct from old.count_id
       or new.item_id is distinct from old.item_id
       or new.restaurant_id is distinct from old.restaurant_id then
      raise exception 'stock_count_lines: count_id, item_id and restaurant_id are immutable.';
    end if;
    if new.expected_qty is distinct from old.expected_qty then
      raise exception 'stock_count_lines: expected_qty is a frozen snapshot.';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    select status into v_parent_status
      from public.stock_counts
     where id = old.count_id;
    if v_parent_status = 'submitted' then
      raise exception 'stock_count_lines: the count is submitted — lines cannot be removed.';
    end if;
    return old;
  end if;

  return new;
end;
$$;

create trigger stock_count_lines_guard
  before update or delete on public.stock_count_lines
  for each row execute function public.stock_count_lines_guard();

-- ---------------------------------------------------------------------------
-- create_stock_count: create a session + snapshot one line per active item.
--
-- SECURITY INVOKER — the caller's RLS applies (P3-01 create_purchase_order
-- precedent). Owner/manager only (the INSERT policy enforces this; the
-- function also checks up front for a friendly error).
-- ---------------------------------------------------------------------------

create or replace function public.create_stock_count(
  p_title text,
  p_assigned_to uuid default null
)
returns public.stock_counts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
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
    (restaurant_id, title, assigned_to, created_by)
  values
    (v_restaurant_id, v_title, p_assigned_to, v_created_by)
  returning * into v_count;

  -- Snapshot: one line per ACTIVE item; expected = current_stock (0 when the
  -- item has no movements yet). Archived items are excluded.
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
  'Create a stock count session and snapshot one line per active item (expected_qty from current_stock). Owner/manager only; assignee must belong to the same restaurant.';

-- ---------------------------------------------------------------------------
-- RLS: every table gets policies, no exceptions (ARCHITECTURE.md §5).
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.stock_counts to authenticated;
grant select, insert, update, delete on public.stock_count_lines to authenticated;

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;

-- stock_counts ---------------------------------------------------------------
-- Owner/manager: full CRUD on their own restaurant's sessions.
create policy stock_counts_all_manager on public.stock_counts
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

-- Staff: read their own assigned sessions. (No staff SELECT on unassigned
-- or others' sessions.)
create policy stock_counts_select_assigned on public.stock_counts
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and public.has_role('staff')
         and assigned_to = public.current_user_id());

-- Staff: update their own assigned sessions (the status trigger rejects
-- title/assignment changes and illegal transitions).
create policy stock_counts_update_assigned on public.stock_counts
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and public.has_role('staff')
         and assigned_to = public.current_user_id())
  with check (restaurant_id = public.current_restaurant_id()
              and public.has_role('staff')
              and assigned_to = public.current_user_id());

-- Visibility of a count for line-level policies, expressed once so the
-- line policies can't drift: owner/manager (own restaurant) OR staff with
-- this session assigned to them.
create or replace function public.stock_count_visible(p_count_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_assigned_to uuid;
begin
  select sc.restaurant_id, sc.assigned_to
    into v_restaurant_id, v_assigned_to
    from public.stock_counts sc
   where sc.id = p_count_id;
  if not found then
    return false;
  end if;
  if v_restaurant_id is distinct from public.current_restaurant_id() then
    return false;
  end if;
  if public.has_role('owner') or public.has_role('manager') then
    return true;
  end if;
  return public.has_role('staff') and v_assigned_to = public.current_user_id();
end;
$$;

-- stock_count_lines ----------------------------------------------------------
create policy stock_count_lines_select_visible on public.stock_count_lines
  for select to authenticated
  using (public.stock_count_visible(count_id));

create policy stock_count_lines_insert_manager on public.stock_count_lines
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager'))
              and public.stock_count_visible(count_id));

create policy stock_count_lines_update_visible on public.stock_count_lines
  for update to authenticated
  using (public.stock_count_visible(count_id))
  with check (public.stock_count_visible(count_id));

create policy stock_count_lines_delete_manager on public.stock_count_lines
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')));
