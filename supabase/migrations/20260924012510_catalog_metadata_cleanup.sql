begin;
lock table public.games in access exclusive mode;
do $$
begin
  if exists(select 1 from public.games where supports_live is true) then
    raise exception 'JOY8_LIVE_METADATA_IN_USE';
  end if;
end;
$$;
drop view public.public_games_v1;
drop function public.joy8_public_games_v1();
alter table public.games drop column supports_live;

create or replace function public.joy8_public_games_v1()
returns table (
  id uuid,
  slug text,
  name text,
  type text,
  thumbnail text,
  created_at timestamptz,
  launch_url text,
  sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.slug,
    g.name,
    g.type,
    g.thumbnail,
    g.created_at,
    g.launch_url,
    g.sort_order
  from public.games g
  where g.published = true
    and g.launch_url is not null
    and btrim(g.launch_url) <> ''
  order by g.sort_order, g.created_at desc;
$$;

revoke all on function public.joy8_public_games_v1() from public, anon, authenticated, service_role;
grant execute on function public.joy8_public_games_v1() to anon, authenticated, service_role;

create or replace view public.public_games_v1
with (security_invoker = true, security_barrier = true)
as
select *
from public.joy8_public_games_v1();

revoke all on table public.public_games_v1 from public, anon, authenticated, service_role;
grant select on table public.public_games_v1 to anon, authenticated, service_role;

select public.joy8_validate_product_adapters();
notify pgrst,'reload schema';
commit;
