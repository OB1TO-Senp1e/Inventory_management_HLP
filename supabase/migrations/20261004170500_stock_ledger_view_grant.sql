-- ============================================================================
-- P2-01 follow-up: missing SELECT grant on the current_stock view.
--
-- A security_invoker view still needs an explicit grant on the view itself;
-- the base migration granted table privileges but not the view. Caught by
-- the P2-01 DB tests (T4: permission denied for view current_stock).
-- ============================================================================

grant select on public.current_stock to authenticated;
