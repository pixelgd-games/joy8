begin read only;

do $$
declare
  v_policy uuid;
begin
  if exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='joy8_wallet_policies' and column_name='game_id') then
    raise exception 'JOY8_SHARED_WALLET_POLICY_SCOPE_REMAINS';
  end if;
  if (select count(*) from public.joy8_wallet_policies)<>1 then
    raise exception 'JOY8_SHARED_WALLET_POLICY_COUNT';
  end if;
  select id into v_policy from public.joy8_wallet_policies
    where currency='POINT' and enabled and initial_credit=0;
  if v_policy is null then raise exception 'JOY8_SHARED_WALLET_POLICY_INVALID'; end if;
  if exists(select 1 from public.joy8_game_policies where wallet_policy_id<>v_policy) then
    raise exception 'JOY8_SHARED_WALLET_GAME_MAPPING';
  end if;
  if exists(select 1 from public.wallet_accounts
    group by player_account_id,currency having count(*)>1) then
    raise exception 'JOY8_SHARED_WALLET_DUPLICATE';
  end if;
  if exists(select 1 from public.wallet_accounts where wallet_policy_id<>v_policy or currency<>'POINT') then
    raise exception 'JOY8_SHARED_WALLET_ACCOUNT_MAPPING';
  end if;
  if exists(select 1 from public.wallet_transactions where game_id is null) then
    raise exception 'JOY8_TRANSACTION_SOURCE_GAME_MISSING';
  end if;
  if exists(select 1 from public.wallet_accounts w where w.locked_balance<>coalesce((
    select sum(p.reserved_amount) from public.joy8_match_participants p
    where p.wallet_account_id=w.id and p.released_at is null),0)) then
    raise exception 'JOY8_SHARED_WALLET_RESERVATION_MISMATCH';
  end if;
  if strpos(pg_get_functiondef('public.joy8_server_session_v1(text,text,jsonb)'::regprocedure),
    '''wallet_scope'',''platform''')=0 then
    raise exception 'JOY8_SHARED_WALLET_SESSION_SCOPE';
  end if;
  if strpos(pg_get_functiondef('mahjong_clash.runtime_readiness()'::regprocedure),
    'join public.joy8_game_policies p on true')=0 or
    strpos(pg_get_functiondef('mahjong_clash.runtime_readiness()'::regprocedure),
    'join public.joy8_wallet_policies w on w.id=p.wallet_policy_id')=0 then
    raise exception 'JOY8_SHARED_WALLET_MAHJONG_READINESS';
  end if;
  if pg_get_indexdef('public.wallet_accounts_identity_key'::regclass)
    not like '%(player_account_id, currency)%' then
    raise exception 'JOY8_SHARED_WALLET_UNIQUE_INDEX';
  end if;
  if exists(select 1 from unnest(array['anon','authenticated']) role
    where has_function_privilege(role,'public.joy8_server_session_v1(text,text,jsonb)','EXECUTE')
      or has_function_privilege(role,'public.joy8_open_match_v1(text,jsonb)','EXECUTE')) then
    raise exception 'JOY8_SHARED_WALLET_BROWSER_AUTHORITY';
  end if;
end;
$$;

select jsonb_build_object(
  'players',(select count(*) from public.player_accounts),
  'wallets',(select count(*) from public.wallet_accounts),
  'balance',(select coalesce(sum(balance),0) from public.wallet_accounts),
  'locked',(select coalesce(sum(locked_balance),0) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'transaction_games',(select count(distinct game_id) from public.wallet_transactions),
  'sessions',(select count(*) from public.game_sessions),
  'platform_matches',(select count(*) from public.joy8_matches),
  'open_platform_matches',(select count(*) from public.joy8_matches where state='open'),
  'mahjong_matches',(select count(*) from mahjong_clash.matches),
  'mahjong_unfinished',(select count(*) from mahjong_clash.matches where status not in ('finished','voided')),
  'wallet_scope','platform',
  'runtime_readiness_contract','shared-policy'
) as shared_point_wallet_postflight;

commit;
