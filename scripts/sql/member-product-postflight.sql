begin read only;

select jsonb_build_object(
  'players',(select count(*) from public.player_accounts),
  'public_ids',(select count(distinct public_id) from public.player_accounts),
  'invalid_public_ids',(select count(*) from public.player_accounts where public_id is null or public_id !~ '^[1-9][0-9]{5}$'),
  'player_id_snapshot',(select md5(coalesce(string_agg(id::text||':'||public_id,',' order by id),'')) from public.player_accounts),
  'wallets',(select count(*) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'matches',(select count(*) from public.joy8_matches),
  'settlements',(select count(*) from public.joy8_settlements),
  'registered_product_schemas',(select count(*) from public.joy8_product_schemas),
  'unregistered_adapters',(select count(*) from public.joy8_game_policies gp
    left join pg_proc p on p.oid=gp.product_adapter::oid
    left join pg_namespace n on n.oid=p.pronamespace
    left join public.joy8_product_schemas s on s.schema_name=n.nspname
    where gp.product_adapter is not null and s.schema_name is null),
  'registration_triggers',(select count(*) from pg_trigger where tgname in ('joy8_product_schema_registration','joy8_product_adapter_registration') and tgenabled='O'),
  'profile_service_execute',has_function_privilege('service_role','public.joy8_resolve_member_profile(uuid,boolean)','EXECUTE'),
  'profile_anon_execute',has_function_privilege('anon','public.joy8_resolve_member_profile(uuid,boolean)','EXECUTE'),
  'profile_authenticated_execute',has_function_privilege('authenticated','public.joy8_resolve_member_profile(uuid,boolean)','EXECUTE'),
  'registry_service_write',has_table_privilege('service_role','public.joy8_product_schemas','INSERT,UPDATE,DELETE,TRUNCATE'),
  'adapter_service_execute',has_function_privilege('service_role','public.joy8_product_adapter(regprocedure,text,uuid,jsonb)','EXECUTE'),
  'ddl_guard_enabled',(select evtenabled='O' and evtevent='ddl_command_end' from pg_event_trigger where evtname='joy8_product_ddl_guard'),
  'ddl_check_deferred',(select tgdeferrable and tginitdeferred and tgenabled='O' from pg_trigger where tgname='joy8_product_ddl_check'),
  'queued_ddl_checks',(select count(*) from public.joy8_product_ddl_checks),
  'ddl_queue_service_write',has_table_privilege('service_role','public.joy8_product_ddl_checks','INSERT,UPDATE,DELETE,TRUNCATE'),
  'ddl_helper_service_execute',has_function_privilege('service_role','public.joy8_check_product_ddl()','EXECUTE'),
  'hardened_functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'body_hash',md5(replace(p.prosrc,chr(13),'')),
    'security_definer',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner)) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
      ('joy8_allocate_public_player_id','joy8_validate_product_adapter','joy8_queue_product_ddl_check','joy8_check_product_ddl'))
) as review_corrections;

commit;
