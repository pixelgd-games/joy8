begin read only;
select jsonb_build_object(
  'mailbox_migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20260926100000'),
  'messages_rls',(select relrowsecurity from pg_class where oid='public.joy8_mail_messages'::regclass),
  'recipients_rls',(select relrowsecurity from pg_class where oid='public.joy8_mail_recipients'::regclass),
  'member_rpc_service_only',has_function_privilege('service_role','public.joy8_member_mail(uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.joy8_member_mail(uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.joy8_member_mail(uuid,text,jsonb)','EXECUTE'),
  'admin_rpc_authenticated_only',has_function_privilege('authenticated','public.joy8_admin_mail(text,jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.joy8_admin_mail(text,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.joy8_admin_mail(text,jsonb)','EXECUTE'),
  'direct_table_access_blocked',not exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role_name)
    cross join unnest(array['public.joy8_mail_messages','public.joy8_mail_recipients']) t(table_name)
    where has_table_privilege(r.role_name,t.table_name,'SELECT,INSERT,UPDATE,DELETE')),
  'ledger_source_constraint',(select pg_get_constraintdef(oid) from pg_constraint where conname='wallet_transactions_game_source_check'
    and conrelid='public.wallet_transactions'::regclass),
  'messages',(select count(*) from public.joy8_mail_messages),
  'recipients',(select count(*) from public.joy8_mail_recipients),
  'claimed',(select count(*) from public.joy8_mail_recipients where claimed_at is not null),
  'mail_credits',(select count(*) from public.wallet_transactions where source_type in ('mail_reward','mail_compensation')),
  'receipt_mismatches',(select count(*) from public.joy8_mail_recipients r
    join public.joy8_mail_messages m on m.id=r.message_id
    left join public.wallet_transactions t on t.id=r.transaction_id
    left join public.wallet_accounts w on w.id=t.wallet_account_id
    where r.claimed_at is not null and (t.id is null or w.player_account_id<>r.player_account_id
      or t.amount<>m.amount or t.balance_after-t.balance_before<>m.amount
      or t.idempotency_key<>'mail:'||m.id::text||':'||r.player_account_id::text))
) as mailbox_status;
commit;
