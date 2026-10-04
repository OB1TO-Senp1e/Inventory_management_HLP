-- ============================================================================
-- P2-03 — log_wastage / log_usage RPCs + reason_code on stock_movements.
--
-- Two single-line stock-out RPCs for kitchen staff (and managers/owners):
-- wastage (thrown away) and usage (consumed in prep, staff meals, tastings).
-- Both are SECURITY DEFINER with `set search_path = public` — the same
-- rationale as receive_goods: they must work for staff, who have no direct
-- item write access, so tenant + role are enforced from the JWT claims
-- inside the function and every write is pinned to the caller's restaurant.
--
-- Reason codes are a closed set per movement type (CHECK constraint on
-- the new `reason_code` column), so wastage-by-reason reports (P5-04) can
-- rely on them. Free-form detail goes in `notes`.
--
-- Insufficient-stock policy: logging MORE than current stock is PERMITTED
-- (the movement posts, stock goes negative). Kitchen reality: the count
-- that catches up comes later; the UI warns but does not block. This
-- matches the §8 record_sales "warn + allow" philosophy.
-- ============================================================================

-- Reason codes live on the ledger row so reports never need a join.
alter table public.stock_movements
  add column if not exists reason_code text;

alter table public.stock_movements
  drop constraint if exists stock_movements_reason_code_check;

alter table public.stock_movements
  add constraint stock_movements_reason_code_check
  check (
    reason_code is null
    or reason_code in (
      -- wastage codes
      'expired', 'spoiled', 'damaged', 'over_prepared', 'other_wastage',
      -- usage codes
      'kitchen_use', 'staff_meal', 'tasting', 'other_usage'
    )
  );

comment on column public.stock_movements.reason_code is
  'Closed-set reason code for wastage/usage movements (see CHECK constraint); null for all other movement types.';

-- ---------------------------------------------------------------------------
-- Shared validation block is inlined in each function (PL/pgSQL has no
-- cheap way to share a "validate + return item" snippet without a helper
-- function; two small duplications beat an extra public helper).
-- ---------------------------------------------------------------------------

create function public.log_wastage(
  p_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
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
    restaurant_id, item_id, movement_type, quantity,
    reason_code, notes, created_by
  ) values (
    v_restaurant_id, p_item_id, 'wastage', -p_quantity,
    v_reason, v_notes, v_created_by
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

comment on function public.log_wastage(uuid, numeric, text, text) is
  'Log wasted stock (negative-quantity wastage movement). Staff may call it; over-logging past zero stock is permitted (UI warns).';

create function public.log_usage(
  p_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
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
    restaurant_id, item_id, movement_type, quantity,
    reason_code, notes, created_by
  ) values (
    v_restaurant_id, p_item_id, 'usage', -p_quantity,
    v_reason, v_notes, v_created_by
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

comment on function public.log_usage(uuid, numeric, text, text) is
  'Log consumed stock (negative-quantity usage movement). Staff may call it; over-logging past zero stock is permitted (UI warns).';

grant execute on function public.log_wastage(uuid, numeric, text, text) to authenticated;
grant execute on function public.log_usage(uuid, numeric, text, text) to authenticated;
