-- ============================================================================
-- V2-05 send POs via WhatsApp/email: record the send channel on the PO and
-- audit every send.
--
-- Supabase-pure: runs unchanged on Supabase cloud (re-verified there on
-- credential arrival). Interim verification: native PostgreSQL 16
-- (see BLOCKERS.md B-002).
--
-- Design (see ARCHITECTURE.md §11): the channel send itself is a client-side
-- deep link (wa.me / mailto:) — no API account needed — opened from the PO
-- detail page. The user confirms the send in the app, and the lifecycle
-- transition (draft → sent) records the channel. Fully automated sending
-- (no user tap) would need the WhatsApp Business API / an email service and
-- is a documented deployment follow-up, not faked here.
--
-- 1. `purchase_orders.sent_at` / `sent_via`: when + how the PO left draft.
--    Both nullable (pre-V2-05 sends have neither). sent_via is constrained
--    to whatsapp | email. Neither column is in the P3-02 frozen-columns
--    list, so the lifecycle guard needs no change.
-- 2. `send_purchase_order(p_po_id, p_channel default null)`: replaces the
--    P3-02 one-arg signature (dropped first; the default keeps old one-arg
--    calls working). Same validation as before, plus a channel check,
--    stamps sent_at/sent_via, and writes a `po_sent` audit_log row.
-- 3. `log_po_resend(p_po_id, p_channel)`: audit-only re-send record for
--    POs that already left draft (sent / partially_received). No status
--    change — the audit trail is the history.
--
-- RLS: no policy changes — the new columns ride on the existing
-- purchase_orders policies (owner/manager own-restaurant; staff see
-- nothing). audit_log rows are written by the SECURITY DEFINER RPCs only.
-- ============================================================================

alter table public.purchase_orders
  add column sent_at timestamptz,
  add column sent_via text check (sent_via is null or sent_via in ('whatsapp', 'email'));

comment on column public.purchase_orders.sent_at is
  'V2-05: when the PO was sent (set by send_purchase_order). Null for unsent and pre-V2-05 sends.';
comment on column public.purchase_orders.sent_via is
  'V2-05: channel used for the send: whatsapp | email. Null when sent without a channel (pre-V2-05).';

-- ---------------------------------------------------------------------------
-- 2. Channel-aware send_purchase_order (replaces the P3-02 signature)
-- ---------------------------------------------------------------------------

drop function if exists public.send_purchase_order(uuid);

create or replace function public.send_purchase_order(p_po_id uuid, p_channel text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_status text;
  v_line_count int;
begin
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'send_purchase_order: requires owner or manager role.';
  end if;
  if v_restaurant_id is null then
    raise exception 'send_purchase_order: no restaurant in session.';
  end if;
  if p_channel is not null and p_channel not in ('whatsapp', 'email') then
    raise exception 'send_purchase_order: unknown channel %.', p_channel;
  end if;

  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  select status into v_status
  from public.purchase_orders
  where id = p_po_id and restaurant_id = v_restaurant_id
  for update;
  if not found then
    raise exception 'send_purchase_order: purchase order not found in your restaurant.';
  end if;
  if v_status <> 'draft' then
    raise exception 'send_purchase_order: only draft purchase orders can be sent (status is %).',
      v_status;
  end if;

  select count(*) into v_line_count
  from public.purchase_order_lines
  where po_id = p_po_id;
  if v_line_count = 0 then
    raise exception 'send_purchase_order: cannot send a purchase order with no lines.';
  end if;

  update public.purchase_orders
  set status = 'sent',
      sent_at = now(),
      sent_via = p_channel
  where id = p_po_id;

  insert into public.audit_log (
    restaurant_id, action, entity_type, entity_id, details, created_by
  ) values (
    v_restaurant_id,
    'po_sent',
    'purchase_order',
    p_po_id,
    jsonb_build_object('channel', p_channel),
    v_created_by
  );
end;
$$;

comment on function public.send_purchase_order(uuid, text) is
  'V2-05: draft → sent (SECURITY DEFINER, owner/manager only). Requires at least one line. p_channel (whatsapp | email | null) is recorded in sent_via/sent_at and in the po_sent audit entry.';

-- ---------------------------------------------------------------------------
-- 3. Re-send audit (POs that already left draft)
-- ---------------------------------------------------------------------------

create or replace function public.log_po_resend(p_po_id uuid, p_channel text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_status text;
begin
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'log_po_resend: requires owner or manager role.';
  end if;
  if v_restaurant_id is null then
    raise exception 'log_po_resend: no restaurant in session.';
  end if;
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'log_po_resend: unknown channel %.', p_channel;
  end if;

  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  select status into v_status
  from public.purchase_orders
  where id = p_po_id and restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'log_po_resend: purchase order not found in your restaurant.';
  end if;
  if v_status not in ('sent', 'partially_received') then
    raise exception 'log_po_resend: only sent purchase orders can be re-sent (status is %).',
      v_status;
  end if;

  insert into public.audit_log (
    restaurant_id, action, entity_type, entity_id, details, created_by
  ) values (
    v_restaurant_id,
    'po_resent',
    'purchase_order',
    p_po_id,
    jsonb_build_object('channel', p_channel),
    v_created_by
  );
end;
$$;

comment on function public.log_po_resend(uuid, text) is
  'V2-05: audit-only re-send record for sent/partially_received POs (SECURITY DEFINER, owner/manager only). Writes a po_resent audit entry; the PO status is unchanged.';
