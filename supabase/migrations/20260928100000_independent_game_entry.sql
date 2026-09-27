begin;

create or replace function public.joy8_resolve_branded_entry(p_game_slug text,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_entry record;
begin
  select g.id,g.name,e.launch_url into v_entry
  from public.games g
  join public.joy8_private_entries e on e.game_id=g.id
  where g.slug=btrim(p_game_slug) and e.enabled
    and e.entry_origin=p_origin
  for share of g,e;
  if not found then raise exception 'JOY8_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  return jsonb_build_object(
    'game_id',v_entry.id,
    'game_name',v_entry.name,
    'launch_url',v_entry.launch_url,
    'protocol','server-v1'
  );
end;
$$;

revoke all on function public.joy8_resolve_branded_entry(text,text) from public,anon,authenticated,service_role;
grant execute on function public.joy8_resolve_branded_entry(text,text) to service_role;

create or replace function public.joy8_create_private_session(p_game_slug text,p_auth_user_id uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record; v_entry record; v_session record;
begin
  select * into v_member from public.joy8_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  select g.id,g.name,e.launch_url into v_entry from public.games g
    join public.joy8_private_entries e on e.game_id=g.id
    where g.slug=btrim(p_game_slug) and e.enabled
      and e.entry_origin=p_origin for share of g,e;
  if not found then raise exception 'JOY8_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  select * into v_session from public.joy8_issue_game_session(p_game_slug,p_auth_user_id);
  return (to_jsonb(v_session)-'player_account_id'-'wallet_account_id') ||
    jsonb_build_object('player_account_ref',v_member.player_account_id,'game_name',v_entry.name,'launch_url',v_entry.launch_url);
end;
$$;

revoke all on function public.joy8_create_private_session(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.joy8_create_private_session(text,uuid,text) to service_role;



select public.joy8_validate_product_adapters();
commit;
