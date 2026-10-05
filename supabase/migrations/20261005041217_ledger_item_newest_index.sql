-- P6-03 performance pass: composite index for per-item newest-first ledger reads.
--
-- `listMovements` (item detail page) and `listBatches` both run
--   WHERE restaurant_id = ? AND item_id = ?
--   ORDER BY created_at DESC, id DESC
-- The old (restaurant_id, item_id) index forced a separate sort node
-- (measured 0.91ms, 603 buffers at 120k rows / 200 items); the composite
-- below serves the equality prefix AND the ordering, eliminating the sort
-- (measured 0.19ms, 51 buffers). It is a strict superset of the old index,
-- so the old one is dropped — every query it served is served by the new
-- prefix (restaurant_id, item_id), including the current_stock GROUP BY.
drop index if exists public.stock_movements_restaurant_item_idx;

create index stock_movements_restaurant_item_created_idx
  on public.stock_movements (restaurant_id, item_id, created_at desc, id desc);
