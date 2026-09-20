begin;

create function public.joy8_resolve_branded_entry(p_game_slug text,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_entry record;
begin
  select g.id,g.name,e.launch_url into v_entry
  from public.games g
  join public.joy8_private_entries e on e.game_id=g.id
  where g.slug=btrim(p_game_slug) and not g.published and e.enabled
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

commit;
