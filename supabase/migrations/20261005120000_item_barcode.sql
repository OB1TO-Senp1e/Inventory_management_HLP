-- ============================================================================
-- V2-01 — Barcode scanning: `items.barcode` + tenant-scoped lookup RPC.
--
-- `barcode` is an optional product identifier (EAN-13, UPC, Code 128, or any
-- supplier label code). Uniqueness is per restaurant: a partial unique index
-- on (restaurant_id, barcode) WHERE barcode IS NOT NULL, so many items can
-- share "no barcode" but no two active items in one restaurant collide.
--
-- `find_item_by_barcode(p_barcode)` follows the `list_receivable_items`
-- precedent (20261004174710): a SECURITY DEFINER function returning exactly
-- (item_id, item_name, unit_symbol) — no cost columns — with the tenant +
-- owner/manager/staff role check inside, so staff can resolve barcodes on
-- /receiving and the count sheet without ever reading `items` directly.
-- Returns zero rows for unknown/blank codes (the client distinguishes "not
-- found" from an error).
-- ============================================================================

alter table public.items add column barcode text;

create unique index items_barcode_restaurant_unique
  on public.items (restaurant_id, barcode)
  where barcode is not null;

comment on column public.items.barcode is
  'Optional product barcode (EAN-13, UPC, Code 128, supplier label). Unique per restaurant; null means "no barcode".';

create function public.find_item_by_barcode(p_barcode text)
returns table(item_id uuid, item_name text, unit_symbol text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_code text := nullif(trim(coalesce(p_barcode, '')), '');
begin
  if not (
    public.has_role('owner')
    or public.has_role('manager')
    or public.has_role('staff')
  ) then
    raise exception 'Only signed-in restaurant users can look up barcodes.';
  end if;

  if v_code is null then
    return;
  end if;

  return query
    select i.id, i.name, u.symbol
    from public.items i
    join public.units u on u.id = i.unit_id
    where i.restaurant_id = v_restaurant_id
      and i.active = true
      and i.barcode = v_code;
end;
$$;

comment on function public.find_item_by_barcode(text) is
  'Tenant-scoped barcode lookup for receiving and count sheets: id + name + unit symbol only, so staff never see cost columns. SECURITY DEFINER — same pattern as list_receivable_items.';

grant execute on function public.find_item_by_barcode(text) to authenticated;
