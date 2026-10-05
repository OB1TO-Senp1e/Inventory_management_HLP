-- ============================================================================
-- V2-06 — POS integration: `pos_imports` + `import_pos_sales` RPC.
--
-- `pos_imports` records which external POS sales have already been
-- imported, so importing the same date range twice can never double-post:
-- the unique index on (restaurant_id, provider, external_sale_id) is the
-- server-side backstop; the client pre-filters via a plain SELECT and
-- shows "already imported" badges in the preview.
--
-- `import_pos_sales(p_provider, p_sales jsonb, p_sale_date date)` posts one
-- import atomically: it aggregates the lines per dish (record_sales
-- rejects duplicate dishes in one call), calls `record_sales` for the
-- ledger postings (identical over_sale flag/audit behavior to manual
-- entry — the nested SECURITY DEFINER call sees the same JWT claims), and
-- records one `pos_imports` row per original POS line with its
-- external_sale_id + sold_at timestamp. Any failure (duplicate external
-- id, archived dish, …) aborts the whole import — sales and import
-- tracking are never half-written.
--
-- RLS: owner/manager of the owning restaurant have full access; staff have
-- NO policies on `pos_imports` and therefore see zero rows (sales touch
-- costs indirectly; P4-03's role matrix holds).
-- ============================================================================

create table public.pos_imports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurants(id) on delete cascade,
  -- Provider id, e.g. 'stub'. Real POS providers plug into the
  -- PosProvider client interface later; the provider string keeps their
  -- external ids namespaced per integration.
  provider text not null check (char_length(provider) between 1 and 64),
  -- The POS-side sale identifier. Unique per (restaurant, provider): the
  -- dedupe backstop — a second import of the same sale raises 23505.
  external_sale_id text not null
    check (char_length(external_sale_id) between 1 and 128),
  menu_item_id uuid not null
    references public.menu_items(id) on delete cascade,
  dishes numeric not null check (dishes > 0),
  -- Original POS timestamp (informational); the ledger entry posts under
  -- p_sale_date, exactly like a manual sales entry.
  sold_at timestamptz,
  sale_date date not null,
  imported_at timestamptz not null default now(),
  created_by uuid
);

comment on table public.pos_imports is
  'POS sales import tracking (V2-06). One row per imported external sale; the unique (restaurant_id, provider, external_sale_id) index makes double-imports impossible. Owner/manager only.';

create unique index pos_imports_dedupe_unique
  on public.pos_imports (restaurant_id, provider, external_sale_id);

create index pos_imports_restaurant_provider_idx
  on public.pos_imports (restaurant_id, provider);

alter table public.pos_imports enable row level security;

-- Owner/manager: full access to their own restaurant's imports.
-- Staff have no policy → zero rows.
create policy pos_imports_owner_manager on public.pos_imports
  for all to authenticated
  using (restaurant_id = public.current_restaurant_id()
         and (public.has_role('owner') or public.has_role('manager')))
  with check (restaurant_id = public.current_restaurant_id()
              and (public.has_role('owner') or public.has_role('manager')));

grant select, insert, update, delete on public.pos_imports to authenticated;

-- ----------------------------------------------------------------------------
-- import_pos_sales(p_provider text, p_sales jsonb, p_sale_date date)
--
-- p_sales: JSON array of { external_sale_id, menu_item_id, dishes, sold_at? }.
-- Atomic: aggregates per dish, posts via record_sales, records pos_imports.
-- ----------------------------------------------------------------------------

create function public.import_pos_sales(
  p_provider text,
  p_sales jsonb,
  p_sale_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_created_by uuid;
  v_sale_date date := coalesce(p_sale_date, current_date);
  v_sale record;
  v_agg_menu_ids uuid[];
  v_agg_dishes numeric[];
  v_idx integer;
  v_menu_id uuid;
  v_dishes numeric;
  v_lines jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_imported integer := 0;
begin
  -- Tenant + role (the function's own authority: it runs as definer) -------
  if v_restaurant_id is null then
    raise exception 'import_pos_sales: no restaurant in session.';
  end if;
  if not (public.has_role('owner') or public.has_role('manager')) then
    raise exception 'import_pos_sales: your role cannot import POS sales.';
  end if;

  begin
    v_created_by := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    v_created_by := null;
  end;

  -- Input shape -------------------------------------------------------------
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'import_pos_sales: provider is required.';
  end if;
  if p_sales is null or jsonb_typeof(p_sales) <> 'array' then
    raise exception 'import_pos_sales: sales must be a JSON array.';
  end if;
  if jsonb_array_length(p_sales) = 0 then
    raise exception 'import_pos_sales: at least one sale is required.';
  end if;

  for v_sale in
    select
      btrim(line ->> 'external_sale_id') as external_sale_id,
      (line ->> 'menu_item_id')::uuid as menu_item_id,
      (line ->> 'dishes')::numeric as dishes,
      nullif(line ->> 'sold_at', '')::timestamptz as sold_at
    from jsonb_array_elements(p_sales) as line
  loop
    if v_sale.external_sale_id is null or v_sale.external_sale_id = '' then
      raise exception 'import_pos_sales: every sale needs an external_sale_id.';
    end if;
    if v_sale.menu_item_id is null then
      raise exception 'import_pos_sales: every sale needs a menu_item_id.';
    end if;
    if v_sale.dishes is null or v_sale.dishes <= 0 then
      raise exception 'import_pos_sales: dishes must be greater than zero (sale %).',
        v_sale.external_sale_id;
    end if;

    -- Dedupe backstop: the unique index enforces this too, but raising here
    -- gives a clear message naming the offending sale.
    if exists (
      select 1 from public.pos_imports pi
       where pi.restaurant_id = v_restaurant_id
         and pi.provider = btrim(p_provider)
         and pi.external_sale_id = v_sale.external_sale_id
    ) then
      raise exception 'import_pos_sales: sale % was already imported.',
        v_sale.external_sale_id;
    end if;

    -- Aggregate per dish: record_sales rejects duplicate dishes in one call.
    v_idx := array_position(v_agg_menu_ids, v_sale.menu_item_id);
    if v_idx is null then
      v_agg_menu_ids := coalesce(v_agg_menu_ids, '{}') || v_sale.menu_item_id;
      v_agg_dishes := coalesce(v_agg_dishes, '{}') || v_sale.dishes;
    else
      v_agg_dishes[v_idx] := v_agg_dishes[v_idx] + v_sale.dishes;
    end if;

    -- Record the import row per original POS line.
    insert into public.pos_imports
      (restaurant_id, provider, external_sale_id, menu_item_id,
       dishes, sold_at, sale_date, created_by)
    values
      (v_restaurant_id, btrim(p_provider), v_sale.external_sale_id,
       v_sale.menu_item_id, v_sale.dishes, v_sale.sold_at,
       v_sale_date, v_created_by);
    v_imported := v_imported + 1;
  end loop;

  -- Build the aggregated lines for record_sales -----------------------------
  for v_idx in 1 .. array_length(v_agg_menu_ids, 1) loop
    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_agg_menu_ids[v_idx],
      'dishes', v_agg_dishes[v_idx]
    );
  end loop;

  -- Post through record_sales: identical ledger effects, over_sale flags
  -- and audit entries to a manual sales entry. The nested SECURITY DEFINER
  -- call sees the same JWT claims; its own tenant/role guards re-apply.
  v_summary := public.record_sales(v_lines, v_sale_date);

  return jsonb_build_object(
    'provider', btrim(p_provider),
    'sale_date', to_char(v_sale_date, 'YYYY-MM-DD'),
    'imported', v_imported,
    'sales', v_summary
  );
end;
$$;

comment on function public.import_pos_sales(text, jsonb, date) is
  'Import POS sales atomically: aggregates lines per dish, posts via record_sales (same ledger/over_sale/audit behavior as manual entry), and records pos_imports rows. Re-importing an external sale raises. Owner/manager only.';

grant execute on function public.import_pos_sales(text, jsonb, date) to authenticated;
