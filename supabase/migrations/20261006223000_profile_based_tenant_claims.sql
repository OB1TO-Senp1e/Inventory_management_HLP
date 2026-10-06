-- Resolve tenant and role from the authenticated user's profile rather than
-- requiring custom restaurant_id/role claims that Supabase does not emit by default.

create or replace function public.current_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select p.restaurant_id
    from public.profiles p
   where p.id = public.current_user_id()
$$;

comment on function public.current_restaurant_id() is
  'Restaurant of the authenticated user, resolved from their profile by JWT subject.';

create or replace function public.has_role(p_required text)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce((
    select p.role = p_required
      from public.profiles p
     where p.id = public.current_user_id()
  ), false)
$$;

comment on function public.has_role(text) is
  'Exact role match against the authenticated user''s profile (owner/manager/staff).';

grant execute on function public.current_restaurant_id() to authenticated;
grant execute on function public.has_role(text) to authenticated;
