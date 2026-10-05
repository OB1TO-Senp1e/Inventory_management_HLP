-- ============================================================================
-- V2-03 — Smart alerts: `notifications` + `alert_preferences`.
--
-- `notifications` is a per-restaurant alert inbox. The client-side alert
-- engine (src/features/alerts) evaluates stock conditions (low stock vs
-- reorder point, batches expiring within the configured window) and
-- generates rows for NEW conditions only:
--
--   * one ACTIVE row per (type, item_id, batch_no) — enforced below by a
--     unique index as the server-side backstop for the client dedupe check;
--   * the engine DELETES a row when its condition clears, so every surviving
--     row is an active alert and a cleared-then-recurring condition
--     generates a fresh row;
--   * rows carry no cost columns (title/body reference names + quantities
--     only), so the owner/manager scope is about operational noise, not
--     cost secrecy.
--
-- `alert_preferences` is one row per restaurant (upserted by the client):
-- which alert types are enabled and the expiry window in days (default 7,
-- matching the `EXPIRY_SOON_DAYS` app constant used by the /stock filter).
--
-- RLS: owner/manager of the owning restaurant have full access; staff have
-- NO policies on either table and therefore see zero rows.
-- ============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  type text not null
    check (type in ('low_stock', 'expiring_soon')),
  title text not null,
  body text not null default '',
  -- Always set: low-stock alerts carry the item, expiry alerts carry the
  -- item + batch_no. NOT NULL also keeps the dedupe unique index sound
  -- (Postgres treats NULLs as distinct in unique indexes).
  item_id uuid not null
    references public.items(id) on delete cascade,
  batch_no text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per-restaurant smart-alert inbox (V2-03). One active row per (type, item, batch); the client engine inserts on new conditions and deletes when a condition clears. Owner/manager only.';

-- Dedupe backstop: a condition that is already alerting cannot produce a
-- second active row, even across racing clients. Resolved alerts are
-- deleted (not flagged), so the unique set is exactly the active set.
create unique index notifications_dedupe_unique
  on public.notifications (restaurant_id, type, item_id, coalesce(batch_no, ''));

create index notifications_restaurant_created_idx
  on public.notifications (restaurant_id, created_at desc);

create table public.alert_preferences (
  restaurant_id uuid primary key
    references public.restaurants(id) on delete cascade,
  low_stock_enabled boolean not null default true,
  expiry_enabled boolean not null default true,
  expiry_days_window integer not null default 7
    check (expiry_days_window > 0 and expiry_days_window <= 90),
  updated_at timestamptz not null default now()
);

comment on table public.alert_preferences is
  'Per-restaurant smart-alert preferences (V2-03). One row per restaurant, upserted by the client; absent row means all defaults. Owner/manager only.';

alter table public.notifications enable row level security;
alter table public.alert_preferences enable row level security;

-- Owner/manager: full access to their own restaurant's notifications.
-- Staff have no policy → zero rows.
create policy notifications_owner_manager on public.notifications
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

-- Owner/manager: full access to their own restaurant's preferences.
-- Staff have no policy → zero rows.
create policy alert_preferences_owner_manager on public.alert_preferences
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

grant select, insert, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.alert_preferences to authenticated;

-- The client upserts preferences through this RPC (not direct writes) so
-- it never needs to know its own restaurant_id: the tenant comes from the
-- JWT claims, exactly like the other SECURITY DEFINER writers
-- (`find_item_by_barcode`, `record_sales`, …). Role check is inside.
create function public.upsert_alert_preferences(
  p_low_stock_enabled boolean,
  p_expiry_enabled boolean,
  p_expiry_days_window integer
)
returns table(
  low_stock_enabled boolean,
  expiry_enabled boolean,
  expiry_days_window integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'Only owners and managers can change alert preferences.';
  end if;

  if p_expiry_days_window is null
     or p_expiry_days_window < 1
     or p_expiry_days_window > 90 then
    raise exception 'Expiry window must be between 1 and 90 days.';
  end if;

  return query
    insert into public.alert_preferences
      (restaurant_id, low_stock_enabled, expiry_enabled,
       expiry_days_window, updated_at)
    values
      (v_restaurant_id, p_low_stock_enabled, p_expiry_enabled,
       p_expiry_days_window, now())
    on conflict (restaurant_id) do update
      set low_stock_enabled = excluded.low_stock_enabled,
          expiry_enabled = excluded.expiry_enabled,
          expiry_days_window = excluded.expiry_days_window,
          updated_at = now()
    returning
      alert_preferences.low_stock_enabled,
      alert_preferences.expiry_enabled,
      alert_preferences.expiry_days_window;
end;
$$;

comment on function public.upsert_alert_preferences(boolean, boolean, integer) is
  'Owner/manager upsert of their restaurant''s alert preferences (V2-03). Tenant comes from JWT claims; SECURITY DEFINER like the other writers.';

grant execute on function public.upsert_alert_preferences(boolean, boolean, integer)
  to authenticated;
