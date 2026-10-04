-- ============================================================================
-- P2-02 security follow-up — staff item visibility via RPC, not RLS policy.
--
-- Replaces the `items_select_staff` RLS policy (added in
-- 20261004172000_receive_goods_definer) with a SECURITY DEFINER function
-- `list_receivable_items()`.
--
-- Why: the role matrix (ARCHITECTURE.md §7) says staff see NO costs, but
-- RLS policies are row-level — a staff SELECT policy on `items` exposes
-- every column, including `avg_unit_cost`, to direct SQL. Staff pickers
-- (receiving, usage/wastage, counts) need only id + name + unit symbol.
-- The definer function returns exactly those three columns, so the cost
-- columns are unreachable for staff at the SQL level. Tenant isolation and
-- the owner/manager/staff role check happen inside the function from the
-- JWT claims (same pattern as `receive_goods`); direct table access stays
-- RLS-governed, and staff again see zero rows on `items` itself (P1-01's
-- original rule, re-asserted in the updated DB tests).
-- ============================================================================

drop policy if exists items_select_staff on public.items;

create function public.list_receivable_items()
returns table(item_id uuid, item_name text, unit_symbol text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if not (
    public.has_role('owner')
    or public.has_role('manager')
    or public.has_role('staff')
  ) then
    raise exception 'Only signed-in restaurant users can list receivable items.';
  end if;

  return query
    select i.id, i.name, u.symbol
    from public.items i
    join public.units u on u.id = i.unit_id
    where i.restaurant_id = v_restaurant_id
      and i.active = true
    order by i.name asc;
end;
$$;

comment on function public.list_receivable_items() is
  'Narrow item picker for stock transactions (receiving, usage/wastage, counts): id + name + unit symbol only, so staff never see cost columns. SECURITY DEFINER — see migration header for the rationale.';

grant execute on function public.list_receivable_items() to authenticated;
