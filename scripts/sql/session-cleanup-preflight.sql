select jsonb_build_object(
  'display_names',(select count(*) from public.player_accounts where display_name is not null),
  'live_flags',(select count(*) from public.games where supports_live is true),
  'references',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'function',p.proname,'arguments',oidvectortypes(p.proargtypes))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','mahjong_clash') and p.prokind='f' and (p.prosrc ilike '%display_name%' or p.prosrc ilike '%supports_live%' or p.prosrc ilike '%issue_game_session%' or p.prosrc ilike '%create_game_session%')),
  'published_games',(select count(*) from public.games where published),
  'enabled_private_entries',(select count(*) from public.joy8_private_entries where enabled)
) as session_cleanup_preflight;
