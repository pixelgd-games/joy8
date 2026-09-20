begin read only;

do $$
declare v_function regprocedure;
begin
  v_function:=to_regprocedure('public.joy8_resolve_branded_entry(text,text)');
  if v_function is null then raise exception 'JOY8_BRANDED_ENTRY_RESOLVER_MISSING'; end if;
  if not exists(select 1 from pg_proc where oid=v_function and prosecdef
    and coalesce(proconfig,array[]::text[]) @> array['search_path=""']) then
    raise exception 'JOY8_BRANDED_ENTRY_RESOLVER_UNSAFE';
  end if;
  if not has_function_privilege('service_role',v_function,'EXECUTE')
    or has_function_privilege('anon',v_function,'EXECUTE')
    or has_function_privilege('authenticated',v_function,'EXECUTE') then
    raise exception 'JOY8_BRANDED_ENTRY_RESOLVER_GRANTS';
  end if;
end;
$$;

select jsonb_build_object(
  'resolver_installed',to_regprocedure('public.joy8_resolve_branded_entry(text,text)') is not null,
  'entries',(select jsonb_agg(jsonb_build_object(
    'slug',g.slug,'published',g.published,'enabled',e.enabled,
    'entry_origin',e.entry_origin,'launch_url',e.launch_url
  )) from public.games g join public.joy8_private_entries e on e.game_id=g.id),
  'players',(select count(*) from public.player_accounts),
  'wallets',(select count(*) from public.wallet_accounts),
  'balance',(select coalesce(sum(balance),0) from public.wallet_accounts),
  'locked',(select coalesce(sum(locked_balance),0) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'sessions',(select count(*) from public.game_sessions),
  'unfinished_matches',(select count(*) from public.joy8_matches where state not in ('settled','cancelled')),
  'unfinished_mahjong_matches',(select count(*) from mahjong_clash.matches where status not in ('finished','voided'))
) as branded_entry_postflight;

commit;
