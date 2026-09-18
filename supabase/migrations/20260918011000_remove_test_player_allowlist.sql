begin;

lock table public.looty_private_players in access exclusive mode;
do $$
begin
  if exists(select 1 from public.looty_private_players) then
    raise exception 'LOOTY_TEST_PLAYER_LIST_NOT_EMPTY';
  end if;
end;
$$;

create or replace function public.looty_create_private_session(p_game_slug text,p_auth_user_id uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record; v_entry record; v_session record;
begin
  select * into v_member from public.looty_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  select g.id,g.name,e.launch_url into v_entry from public.games g
    join public.looty_private_entries e on e.game_id=g.id
    where g.slug=btrim(p_game_slug) and not g.published and e.enabled
      and e.entry_origin=p_origin for share of g,e;
  if not found then raise exception 'LOOTY_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  select * into v_session from public.looty_issue_game_session(p_game_slug,'POINT',3600,null,p_auth_user_id);
  return (to_jsonb(v_session)-'player_account_id'-'wallet_account_id') ||
    jsonb_build_object('player_account_ref',v_member.player_account_id,'game_name',v_entry.name,'launch_url',v_entry.launch_url);
end;
$$;

revoke all on function public.looty_create_private_session(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.looty_create_private_session(text,uuid,text) to service_role;
drop table public.looty_private_players;

commit;
