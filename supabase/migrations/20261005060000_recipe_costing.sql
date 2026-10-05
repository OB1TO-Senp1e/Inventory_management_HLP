-- ============================================================================
-- P4-02 recipe costing: selling price on menu_items + menu_item_costs view.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- `menu_items.selling_price` — the dish's selling price in INR. Nullable:
-- a recipe may exist before pricing is set. Must be > 0 when set (money is
-- numeric, never float — ARCHITECTURE.md §5). Editable like the other
-- header fields; the existing owner/manager RLS policies cover it (no new
-- policies — staff still have none on this table).
--
-- `menu_item_costs` — per menu item, the total ingredient cost for the FULL
-- recipe yield, computed LIVE from the current `items.avg_unit_cost`
-- (maintained by the receiving RPCs in P2-02) and the explicit
-- `unit_conversions` rows: qty_in_base_unit = quantity * factor, where the
-- factor is the direct conversion from the ingredient's unit to the item's
-- base unit (the same one-hop rule P4-01's trigger enforces). The client
-- divides by `yield_quantity` for cost per dish and divides by
-- `selling_price` for food-cost % — nothing is snapshotted, so the cost
-- updates automatically whenever ingredient costs change.
--
-- security_invoker = true (PG15+, same as `current_stock` in P2-01): the
-- view runs with the caller's permissions so the underlying tables' RLS
-- applies. Staff have no policies on menu_items/recipe_ingredients, so
-- they see zero rows — never costs.
-- ============================================================================

alter table public.menu_items
  add column selling_price numeric
    check (selling_price is null or selling_price > 0);

comment on column public.menu_items.selling_price is
  'P4-02: selling price in INR for one dish (one yield unit). Null = not set. Cost per dish is computed live from avg_unit_cost; food-cost % = cost per dish / selling_price.';

-- ---------------------------------------------------------------------------
-- menu_item_costs: live total ingredient cost (full yield) per menu item
-- ---------------------------------------------------------------------------

create view public.menu_item_costs
with (security_invoker = true) as
select
  mi.restaurant_id,
  mi.id as menu_item_id,
  coalesce(
    sum(
      ri.quantity
        * coalesce(uc.factor, 1)
        * i.avg_unit_cost
    ),
    0
  ) as ingredient_cost
from public.menu_items mi
left join public.recipe_ingredients ri
  on ri.menu_item_id = mi.id
left join public.items i
  on i.id = ri.item_id
left join public.unit_conversions uc
  on uc.restaurant_id = ri.restaurant_id
  and uc.from_unit_id = ri.unit_id
  and uc.to_unit_id = i.unit_id
group by mi.restaurant_id, mi.id;

comment on view public.menu_item_costs is
  'P4-02: total ingredient cost (INR) for the full recipe yield per menu item, computed live from items.avg_unit_cost and direct unit conversions. No factor row means the ingredient unit is the item base unit (factor 1).';

-- The view is read-only by construction; authenticated users may read it —
-- RLS on the underlying tables (security_invoker) decides which rows each
-- role actually sees.
grant select on public.menu_item_costs to authenticated;
