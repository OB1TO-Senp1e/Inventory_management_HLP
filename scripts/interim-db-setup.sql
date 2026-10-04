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
