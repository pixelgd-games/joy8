begin;

create function public.looty_platform_health_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select to_regprocedure('public.looty_resolve_member(uuid,boolean)') is not null
    and to_regprocedure('public.create_game_session(text,text,integer,text,uuid)') is not null
    and to_regprocedure('public.looty_settle_match_v1(text,jsonb)') is not null
    and (select count(*)>=0 from (select id from public.games limit 1) g);
$$;
revoke all on function public.looty_platform_health_v1() from public,anon,authenticated;
grant execute on function public.looty_platform_health_v1() to service_role;

commit;
