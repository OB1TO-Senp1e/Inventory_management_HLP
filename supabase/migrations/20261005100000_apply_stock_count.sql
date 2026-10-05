-- ============================================================================
-- P5-02 — Variance review and approval: apply_stock_count RPC.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- Status machine grows by one terminal state: submitted → applied.
-- `applied` marks a count whose variances were reviewed and posted to the
-- ledger. It is terminal, like `submitted` was before — P5-01's migration
-- explicitly reserved statuses beyond `submitted` for this task.
--
-- `apply_stock_count(p_count_id uuid)` — SECURITY DEFINER (it writes the
-- ledger and the audit log, which have no direct-write policies — the
-- record_sales P4-03 precedent):
--   1. Tenant + role from JWT claims: owner/manager only (staff cannot
--      approve — the RPC raises; the status trigger below also rejects a
--      direct table-level submitted → applied move by non-managers).
--   2. The session must exist, belong to the caller's restaurant, and be
--      `submitted`. Re-applying an `applied` session raises — idempotency
--      is "apply twice = error, no double post" rather than a silent
--      no-op, so a repeated tap is loud instead of silently dropping.
--   3. Every line must be counted (counted_qty NOT NULL); otherwise the
--      variance is meaningless and the RPC raises.
--   4. variance = counted_qty − expected_qty (frozen snapshot from P5-01).
--      One `count_adjustment` movement per line with variance ≠ 0
--      (quantity is SIGNED: positive = found more than expected,
--      negative = found less); zero-variance lines post nothing.
--      Movements carry reference_type 'stock_count' + reference_id so the
--      ledger rows are traceable back to the session.
--   5. One `audit_log` row (action 'stock_count_applied', entity
--      'stock_count') with the per-line variances — the audit screen
--      (P5-05) reads these.
--
-- The per-line variance DISPLAY is client-side math (frozen expected +
-- counted are already on the sheet); only the posting is DB-side. The
-- ledger stays append-only: this RPC only INSERTs movements, and a new
-- count — not an edit — is how a re-count happens.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Status machine: add 'applied' (terminal). The check constraint gets an
-- explicit re-add; the guard trigger learns the new transitions.
-- ---------------------------------------------------------------------------

alter table public.stock_counts
  drop constraint if exists stock_counts_status_check;

alter table public.stock_counts
  add constraint stock_counts_status_check
  check (status in ('draft', 'in_progress', 'submitted', 'applied'));

comment on column public.stock_counts.status is
  'draft → in_progress → submitted → applied. submitted is the reviewed queue; applied is terminal (variances posted to the ledger by apply_stock_count).';

-- The status guard is replaced (not edited in place) so the migration is
-- self-contained: draft → in_progress → submitted → applied; applied is
-- terminal. submitted → applied requires owner/manager — staff move status
-- on their own assigned sessions, but only through review, never by
-- approving it themselves (a direct UPDATE to 'applied' by staff raises).
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
    if old.status = 'applied' then
      raise exception 'stock_counts: an applied count is final.';
    end if;
    if old.status = 'submitted' then
      if new.status <> 'applied' then
        raise exception 'stock_counts: a submitted count can only be applied (variance review).';
      end if;
      -- P5-02: staff cannot approve — approval is the owner/manager act.
      -- apply_stock_count (SECURITY DEFINER) enforces this first; the
      -- trigger closes the direct-UPDATE path for staff on their own
      -- assigned sessions.
      if not v_is_manager then
        raise exception 'stock_counts: only owner/manager may apply a submitted count.';
      end if;
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

comment on function public.stock_count_status_guard() is
  'P5-02: status machine draft → in_progress → submitted → applied; applied terminal; submitted → applied is owner/manager only.';

-- Lines freeze on submitted AND applied (was: submitted only).
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

    if v_parent_status in ('submitted', 'applied') then
      raise exception 'stock_count_lines: the count is % — lines are frozen.', v_parent_status;
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
    if v_parent_status in ('submitted', 'applied') then
      raise exception 'stock_count_lines: the count is % — lines cannot be removed.', v_parent_status;
    end if;
    return old;
  end if;

  return new;
end;
$$;

comment on function public.stock_count_lines_guard() is
  'P5-02: line freeze extended to applied sessions (was: submitted only).';

-- ---------------------------------------------------------------------------
-- apply_stock_count: review + approve a submitted count, post adjustments.
-- ---------------------------------------------------------------------------

create or replace function public.apply_stock_count(
  p_count_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_count public.stock_counts;
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
      restaurant_id, item_id, movement_type, quantity,
      reference_type, reference_id, notes, created_by
    ) values (
      v_restaurant_id, v_line.item_id, 'count_adjustment', v_variance,
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
  'Review + approve a submitted stock count: posts one signed count_adjustment movement per non-zero variance (counted − expected), marks the session applied, writes one audit_log row. Owner/manager only; re-applying raises.';

grant execute on function public.apply_stock_count(uuid) to authenticated;
