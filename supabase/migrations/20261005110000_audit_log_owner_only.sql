-- ============================================================================
-- P5-05: the audit log is owner-only to read.
--
-- The P4-04 table granted SELECT to owner/manager. P5-05's acceptance
-- requires staff AND manager to be blocked by RLS, so the manager policy
-- is replaced with an owner-only one. Writes remain RPC-only: no write
-- policies exist (direct writes denied), and the append-only trigger
-- rejects UPDATE/DELETE for everyone.
-- ============================================================================

comment on table public.audit_log is
  'Append-only audit trail. Rows are written only by SECURITY DEFINER RPCs (no write policies); the owner reads their own restaurant''s entries; managers and staff see nothing.';

drop policy if exists audit_log_select_manager on public.audit_log;

-- Owner only: read their own restaurant's entries. Managers and staff have
-- no policy, so every query from them returns zero rows.
create policy audit_log_select_owner on public.audit_log
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and public.has_role('owner'));
