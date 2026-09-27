begin;

set local lock_timeout='5s';
set local statement_timeout='30s';
lock table auth.users,auth.identities,auth.sessions,auth.refresh_tokens,auth.flow_state,auth.mfa_amr_claims,
  public.admin_users,public.player_accounts,public.wallet_accounts,public.wallet_transactions,
  public.game_sessions,public.joy8_matches,public.joy8_match_participants,public.joy8_settlements,
  public.joy8_settlement_entries,public.joy8_match_recoveries,public.joy8_mail_messages,
  public.joy8_mail_recipients,public.joy8_fee_accounts in access exclusive mode;

do $cleanup$
declare
  retained uuid:='ac5cb167-7cdc-4e49-ba50-47a8a5220b88';
  expected jsonb:='[{"fingerprint":"e62479e6b7eb3932f6307bfbaa9cab24","rows":7,"table_name":"public.player_accounts"},{"fingerprint":"f085f25bd729b2d3f1c9f2fb0ec1b0b5","rows":7,"table_name":"public.wallet_accounts"},{"fingerprint":"1e53ffbdd2e022db2d32d5ff51992519","rows":443,"table_name":"public.wallet_transactions"},{"fingerprint":"d03d1e476a7cb215f1dc4c9b9fd701b2","rows":48,"table_name":"public.game_sessions"},{"fingerprint":"cb561db895ca303f0f579009d0c3120c","rows":384,"table_name":"public.joy8_matches"},{"fingerprint":"ad717d0efb4853081e3b2bd6d05393c3","rows":384,"table_name":"public.joy8_match_participants"},{"fingerprint":"1c91a52e2851fd4f7c12b3727d07146d","rows":458,"table_name":"public.joy8_settlements"},{"fingerprint":"be1f253b9c404b3e2419b51f2f0300db","rows":870,"table_name":"public.joy8_settlement_entries"},{"fingerprint":"d41d8cd98f00b204e9800998ecf8427e","rows":0,"table_name":"public.joy8_match_recoveries"},{"fingerprint":"d41d8cd98f00b204e9800998ecf8427e","rows":0,"table_name":"public.joy8_mail_messages"},{"fingerprint":"d41d8cd98f00b204e9800998ecf8427e","rows":0,"table_name":"public.joy8_mail_recipients"},{"fingerprint":"d41d8cd98f00b204e9800998ecf8427e","rows":0,"table_name":"public.joy8_fee_accounts"},{"fingerprint":"bf61742df9c120a095180f7a5eb99766","rows":7,"table_name":"auth.users"},{"fingerprint":"f6c45032210360cd09507af10a48baad","rows":2,"table_name":"auth.identities"},{"fingerprint":"ad16fe9aa49f35ba1e978de31eb51e4b","rows":9,"table_name":"auth.sessions"},{"fingerprint":"7edaa76b9c5712d402918b1c97e2477d","rows":139,"table_name":"auth.refresh_tokens"},{"fingerprint":"7587adf424c2c83c0ce9ad473e54bfb6","rows":2,"table_name":"auth.flow_state"},{"fingerprint":"aabb82d17e81cc7db9787fad33d477ab","rows":9,"table_name":"auth.mfa_amr_claims"}]'::jsonb;
  target record;
  predicate text;
  actual_count bigint;
  actual_hash text;
begin
  if (select count(*) from public.admin_users)<>1
    or not exists(select 1 from public.admin_users a join auth.users u on lower(a.email)=lower(u.email)
      where u.id=retained and lower(a.email)='pixelgd.games@gmail.com' and not u.is_anonymous
        and u.email_confirmed_at is not null and u.deleted_at is null
        and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
    or exists(select 1 from public.player_accounts where auth_user_id=retained) then
    raise exception 'JOY8_CLEANUP_ADMIN_CHANGED';
  end if;
  if exists(select 1 from public.joy8_matches where state='open')
    or exists(select 1 from public.wallet_accounts where locked_balance<>0) then
    raise exception 'JOY8_CLEANUP_UNRESOLVED_MATCH';
  end if;
  for target in select * from jsonb_to_recordset(expected) as x(table_name text,rows bigint,fingerprint text) loop
    predicate:=case target.table_name
      when 'auth.users' then format('id<>%L::uuid',retained)
      when 'auth.identities' then format('user_id<>%L::uuid',retained)
      when 'auth.sessions' then format('user_id<>%L::uuid',retained)
      when 'auth.refresh_tokens' then format('user_id is distinct from %L',retained::text)
      when 'auth.flow_state' then format('user_id is distinct from %L::uuid',retained)
      when 'auth.mfa_amr_claims' then format('session_id in (select id from auth.sessions where user_id<>%L::uuid)',retained)
      else 'true' end;
    execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'','' order by md5(to_jsonb(t)::text)),'''')) from %s t where %s',target.table_name,predicate)
      into actual_count,actual_hash;
    if actual_count<>target.rows or actual_hash<>target.fingerprint then
      raise exception 'JOY8_CLEANUP_SNAPSHOT_CHANGED' using detail=target.table_name;
    end if;
  end loop;
  for target in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and ((n.nspname='mahjong_clash' and c.relname not in ('economy_state','economy_versions','lifecycle_config'))
      or (n.nspname='auth' and c.relname in ('mfa_factors','mfa_challenges','mfa_recovery_code_sets','mfa_recovery_codes',
        'oauth_authorizations','oauth_consents','one_time_tokens','scim_users','webauthn_credentials','webauthn_challenges','saml_relay_states')))
  loop
    execute format('lock table %I.%I in share row exclusive mode',target.nspname,target.relname);
    execute format('select count(*) from %I.%I',target.nspname,target.relname) into actual_count;
    if actual_count<>0 then raise exception 'JOY8_CLEANUP_UNREVIEWED_DATA' using detail=target.nspname||'.'||target.relname; end if;
  end loop;
end;
$cleanup$;

alter table public.wallet_transactions disable trigger joy8_wallet_transactions_immutable;
alter table public.joy8_settlement_entries disable trigger joy8_settlement_entries_immutable;
alter table public.joy8_settlements disable trigger joy8_settlements_immutable;

delete from public.joy8_settlement_entries;
delete from public.joy8_settlements;
delete from public.wallet_transactions;
delete from public.joy8_match_participants;
delete from public.joy8_matches;
delete from public.game_sessions;
delete from public.wallet_accounts;
delete from public.player_accounts;
delete from auth.flow_state where user_id is distinct from 'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid;
delete from auth.refresh_tokens where user_id is distinct from 'ac5cb167-7cdc-4e49-ba50-47a8a5220b88';
delete from auth.users where id<>'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid;

alter table public.wallet_transactions enable trigger joy8_wallet_transactions_immutable;
alter table public.joy8_settlement_entries enable trigger joy8_settlement_entries_immutable;
alter table public.joy8_settlements enable trigger joy8_settlements_immutable;

do $postflight$
begin
  if (select count(*) from auth.users)<>1
    or not exists(select 1 from auth.users where id='ac5cb167-7cdc-4e49-ba50-47a8a5220b88')
    or exists(select 1 from public.player_accounts)
    or exists(select 1 from public.wallet_accounts)
    or exists(select 1 from public.joy8_matches)
    or exists(select 1 from public.joy8_settlements)
    or exists(select 1 from public.joy8_settlement_entries)
    or exists(select 1 from public.wallet_transactions)
    or exists(select 1 from public.game_sessions)
    or exists(select 1 from pg_trigger where tgname in ('joy8_wallet_transactions_immutable','joy8_settlement_entries_immutable','joy8_settlements_immutable') and tgenabled<>'O') then
    raise exception 'JOY8_CLEANUP_POSTFLIGHT_FAILED';
  end if;
end;
$postflight$;
select public.joy8_validate_product_adapters();
commit;

