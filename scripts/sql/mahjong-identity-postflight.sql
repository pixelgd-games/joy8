select jsonb_build_object(
  'catalog',(select jsonb_build_object('published',published,'launch_url',launch_url) from public.games where slug='mahjong-clash'),
  'entry',(select jsonb_build_object('origin',e.entry_origin,'launch_url',e.launch_url,'enabled',e.enabled)
    from public.joy8_private_entries e join public.games g on g.id=e.game_id where g.slug='mahjong-clash'),
  'policy',(select jsonb_build_object('game_enabled',p.enabled,'wallet_enabled',w.enabled,'initial_credit',w.initial_credit,
    'max_entry_amount',p.max_entry_amount,'max_participants',p.max_participants,'adapter',p.product_adapter::text)
    from public.joy8_game_policies p join public.games g on g.id=p.game_id join public.joy8_wallet_policies w on w.id=p.wallet_policy_id where g.slug='mahjong-clash'),
  'runtime',(select jsonb_build_object('login',rolcanlogin,'superuser',rolsuper,'bypass_rls',rolbypassrls,'inherit',rolinherit,'expires_at',rolvaliduntil)
    from pg_roles where rolname='mahjong_clash_runtime'),
  'keys',(select jsonb_agg(jsonb_build_object('scopes',k.scopes,'expires_at',k.expires_at,'revoked',k.revoked_at is not null))
    from public.joy8_backend_keys k join public.games g on g.id=k.game_id where g.slug='mahjong-clash'),
  'player_allowlist_removed',to_regclass('public.joy8_private_players') is null,
  'entry_uses_membership',strpos(pg_get_functiondef('public.joy8_create_private_session(text,uuid,text)'::regprocedure),'joy8_resolve_member(p_auth_user_id,false)')>0,
  'entry_has_no_player_allowlist',strpos(pg_get_functiondef('public.joy8_create_private_session(text,uuid,text)'::regprocedure),'joy8_private_players')=0,
  'ai_account_count',(select count(*) from mahjong_clash.ai_accounts),
  'product_match_count',(select count(*) from mahjong_clash.matches),
  'service_private_rpc',has_function_privilege('service_role','public.joy8_create_private_session(text,uuid,text)','EXECUTE'),
  'service_internal_issuer',has_function_privilege('service_role','public.joy8_issue_game_session(text,text,integer,text,uuid)','EXECUTE'),
  'browser_private_rpc',has_function_privilege('authenticated','public.joy8_create_private_session(text,uuid,text)','EXECUTE'),
  'browser_private_config',has_table_privilege('authenticated','public.joy8_private_entries','SELECT'),
  'game_wallet_access',has_table_privilege('mahjong_clash_server','public.wallet_accounts','SELECT'),
  'game_auth_access',has_table_privilege('mahjong_clash_server','auth.users','SELECT')
) as identity_activation;
