-- ============================================================================
-- INTERIM LOCAL ONLY — never applied to Supabase.
-- Minimal stand-ins for Supabase-managed objects so that migrations stay
-- production-faithful (they must also run unchanged on Supabase cloud).
-- Apply ONCE to the interim dev database:
--   su postgres -c "psql -d restaurant_inventory -f scripts/interim-db-setup.sql"
-- Supabase cloud already provides auth.users and the anon/authenticated roles.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

comment on table auth.users is
  'INTERIM stub mirroring Supabase auth.users(id). Production FK targets stay valid.';

-- ---------------------------------------------------------------------------
-- INTERIM ONLY — stub auth.users rows for the P0-07 seed profiles.
-- seed.sql (supabase/seed.sql) must stay auth-schema-free so it runs
-- unchanged on Supabase cloud; on cloud, create the real GoTrue users first
-- (README "Test users") and skip this section entirely.
-- Idempotent: safe to re-run (this whole file is re-applied if extended).
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'), -- owner (P0-07 seed)
  ('22222222-2222-4222-8222-222222222222'), -- manager (P0-07 seed)
  ('33333333-3333-4333-8333-333333333333')  -- staff (P0-07 seed)
on conflict (id) do nothing;

-- Mirror Supabase''s PostgREST roles so RLS policies (TO authenticated)
-- can be exercised locally via SET ROLE.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nosuperuser noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nosuperuser noinherit;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to authenticated;

-- Interim dev convenience: let the root OS user (which runs the build loop)
-- connect over the unix socket via peer auth, so project tooling such as
-- `supabase gen types --db-url` runs without embedding a password anywhere.
-- Local-only; Supabase cloud is unaffected.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'root') then
    create role root superuser login;
  end if;
end
$$;
