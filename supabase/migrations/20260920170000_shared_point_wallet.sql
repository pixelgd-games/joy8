begin;

lock table public.wallet_accounts, public.wallet_transactions, public.game_sessions,
  public.joy8_wallet_policies, public.joy8_game_policies, public.joy8_matches,
  public.joy8_match_participants, public.joy8_settlements,
  public.joy8_settlement_entries, public.joy8_fee_accounts in access exclusive mode;

do $$
declare
  v_policy_count integer;
begin
  if exists(select 1 from public.wallet_accounts)
    or exists(select 1 from public.wallet_transactions)
    or exists(select 1 from public.game_sessions)
    or exists(select 1 from public.joy8_matches)
    or exists(select 1 from public.joy8_match_participants)
    or exists(select 1 from public.joy8_settlements)
    or exists(select 1 from public.joy8_settlement_entries)
    or exists(select 1 from public.joy8_fee_accounts) then
    raise exception 'JOY8_SHARED_WALLET_REQUIRES_EMPTY_ACCOUNTING' using errcode='55000';
  end if;
  select count(*) into v_policy_count from public.joy8_wallet_policies;
  if v_policy_count > 1 then
    raise exception 'JOY8_SHARED_WALLET_POLICY_REVIEW_REQUIRED' using errcode='55000';
  end if;
  if exists(select 1 from public.joy8_wallet_policies where currency <> 'POINT' or initial_credit <> 0) then
    raise exception 'JOY8_SHARED_WALLET_POLICY_REVIEW_REQUIRED' using errcode='55000';
  end if;
end;
$$;

insert into public.joy8_wallet_policies(currency, initial_credit, enabled)
select 'POINT', 0, true
where not exists(select 1 from public.joy8_wallet_policies);

update public.joy8_wallet_policies
set game_id = null, initial_credit = 0, enabled = true;

update public.joy8_game_policies
set wallet_policy_id = (select id from public.joy8_wallet_policies);

drop function public.joy8_provision_wallet(uuid,uuid);
drop function public.joy8_server_session_v1(text,text,jsonb);
drop function public.joy8_open_match_v1(text,jsonb);

alter table public.joy8_wallet_policies
  drop constraint joy8_wallet_policies_game_id_currency_key,
  drop column game_id,
  add constraint joy8_wallet_policies_currency_key unique(currency);

alter table public.wallet_transactions
  drop constraint wallet_transactions_game_id_fkey,
  alter column game_id set not null,
  add constraint wallet_transactions_game_id_fkey foreign key(game_id)
    references public.games(id) on delete restrict;

drop index public.wallet_accounts_identity_key;
create unique index wallet_accounts_identity_key on public.wallet_accounts(player_account_id,currency);

create function public.joy8_provision_wallet(p_player_id uuid, p_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy public.joy8_wallet_policies%rowtype;
  v_wallet public.wallet_accounts%rowtype;
begin
  select p.* into v_policy
  from public.joy8_game_policies g
  join public.joy8_wallet_policies p on p.id=g.wallet_policy_id
  where g.game_id=p_game_id and g.enabled and p.enabled
  for share of g,p;
  if not found then raise exception 'JOY8_GAME_NOT_READY' using errcode='42501'; end if;
  perform 1 from public.player_accounts p where p.id=p_player_id
    and p.status='active' and p.member_enrolled_at is not null for update;
  if not found then raise exception 'JOY8_PLAYER_INACTIVE' using errcode='42501'; end if;
  select w.* into v_wallet from public.wallet_accounts w
  where w.player_account_id=p_player_id and w.currency=v_policy.currency for update;
  if found then
    if v_wallet.status<>'active' or v_wallet.wallet_policy_id<>v_policy.id then
      raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501';
    end if;
    return v_wallet.id;
  end if;
  insert into public.wallet_accounts(player_account_id,currency,balance,wallet_policy_id)
  values(p_player_id,v_policy.currency,0,v_policy.id) returning * into v_wallet;
  if v_policy.initial_credit>0 then
    update public.wallet_accounts set balance=v_policy.initial_credit where id=v_wallet.id;
    insert into public.wallet_transactions(
      wallet_account_id,type,amount,balance_before,balance_after,game_id,
      idempotency_key,source_type,source_ref
    ) values(
      v_wallet.id,'deposit',v_policy.initial_credit,0,v_policy.initial_credit,p_game_id,
      'initial-grant:'||v_wallet.id::text,'initial_grant',v_policy.id::text
    );
  end if;
  return v_wallet.id;
end;
$$;

create function public.joy8_server_session_v1(p_secret text,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_session public.game_sessions%rowtype;
  v_token text;
  v_expiry timestamptz;
begin
  if p_action not in ('exchange','renew') or jsonb_typeof(p_request) is distinct from 'object'
    or p_request->>'version' is distinct from '1'
    or (p_request-array['version','launch_code','session_id'])<>'{}'::jsonb then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_game:=public.joy8_backend_game(p_secret,p_action);
  if p_action='exchange' then
    if p_request?'session_id' or coalesce(p_request->>'launch_code','')!~'^[a-f0-9]{64}$' then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    select s.* into v_session from public.game_sessions s
    where s.launch_code_hash=public.joy8_hash_secret(p_request->>'launch_code') and s.game_id=v_game;
  else
    if p_request?'launch_code' then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    select s.* into v_session from public.game_sessions s
    where s.id=(p_request->>'session_id')::uuid and s.game_id=v_game and s.launch_code_used_at is not null;
  end if;
  if not found then raise exception 'JOY8_SESSION_INVALID' using errcode='42501'; end if;
  perform public.joy8_assert_player(v_session.player_account_id);
  perform 1 from public.wallet_accounts w
    where w.id=v_session.wallet_account_id and w.status='active' for share;
  if not found then raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501'; end if;
  select s.* into v_session from public.game_sessions s where s.id=v_session.id for update;
  if v_session.status<>'active' or v_session.expires_at<=now()
    or (p_action='exchange' and (v_session.launch_code_used_at is not null or v_session.launch_code_expires_at<=now())) then
    raise exception 'JOY8_SESSION_INVALID' using errcode='42501';
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_expiry:=least(v_session.expires_at,now()+interval '15 minutes');
  update public.game_sessions set launch_code_used_at=coalesce(launch_code_used_at,now()),
    gateway_token_hash=public.joy8_hash_secret(v_token),gateway_token_expires_at=v_expiry,
    gateway_token_scopes=array['balance']::text[] where id=v_session.id;
  return jsonb_build_object('version',1,'session_id',v_session.id,'game_id',v_game,
    'player_account_ref',v_session.player_account_id,'account_type',v_session.account_type,
    'wallet_scope','platform','currency',v_session.currency,'gateway_token',v_token,
    'gateway_token_expires_at',v_expiry,'expires_at',v_session.expires_at,
    'scopes',jsonb_build_array('balance'));
end;
$$;

create function public.joy8_open_match_v1(p_secret text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_config record;
  v_match public.joy8_matches%rowtype;
  v_hash text;
  v_item jsonb;
  v_player uuid;
  v_wallet public.wallet_accounts%rowtype;
  v_session public.game_sessions%rowtype;
  v_amount numeric;
  v_count integer;
  v_products jsonb:=coalesce(p_request->'product_participants','[]'::jsonb);
begin
  v_game:=public.joy8_backend_game(p_secret,'open');
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref','rule_version','participants','product_participants'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or coalesce(length(p_request->>'rule_version'),0) not between 1 and 80
    or jsonb_typeof(p_request->'participants') is distinct from 'array'
    or jsonb_typeof(v_products) is distinct from 'array' then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.joy8_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if found then
    if v_match.open_hash<>v_hash then raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state);
  end if;
  select g.* into v_config from public.joy8_game_policies g
  join public.joy8_wallet_policies p on p.id=g.wallet_policy_id
  where g.game_id=v_game and g.enabled and p.enabled for share of g,p;
  if not found then raise exception 'JOY8_GAME_NOT_READY' using errcode='42501'; end if;
  v_count:=jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count+jsonb_array_length(v_products)>v_config.max_participants then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_request->'participants') loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['session_id','reserve'])<>'{}'::jsonb
      or (v_item->>'session_id') is null then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_amount<=0 or v_amount>v_config.max_entry_amount then raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'session_id') from jsonb_array_elements(p_request->'participants'))<>v_count then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_products) loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['account_ref','reserve'])<>'{}'::jsonb
      or coalesce(length(v_item->>'account_ref'),0) not between 1 and 120 then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_amount<=0 or v_amount>v_config.max_entry_amount then raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'account_ref') from jsonb_array_elements(v_products))<>jsonb_array_length(v_products) then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_player in select distinct s.player_account_id from public.game_sessions s
    join jsonb_array_elements(p_request->'participants') e on s.id=(e.value->>'session_id')::uuid
    order by s.player_account_id loop
    perform public.joy8_assert_player(v_player);
  end loop;
  perform w.id from public.wallet_accounts w join public.game_sessions s on s.wallet_account_id=w.id
    join jsonb_array_elements(p_request->'participants') e on s.id=(e.value->>'session_id')::uuid
    order by w.id for update of w;
  insert into public.joy8_matches(game_id,match_ref,rule_version,open_hash,wallet_policy_id,
    max_entry_amount,product_adapter,product_participants)
  values(v_game,p_request->>'match_ref',p_request->>'rule_version',v_hash,v_config.wallet_policy_id,
    v_config.max_entry_amount,v_config.product_adapter,v_products) returning * into v_match;
  for v_item in select value from jsonb_array_elements(p_request->'participants') order by value->>'session_id' loop
    select s.* into v_session from public.game_sessions s where s.id=(v_item->>'session_id')::uuid
      and s.game_id=v_game and s.status='active' and s.expires_at>now()
      and s.launch_code_used_at is not null for share;
    if not found then raise exception 'JOY8_SESSION_INVALID' using errcode='42501'; end if;
    select w.* into v_wallet from public.wallet_accounts w where w.id=v_session.wallet_account_id;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_wallet.status<>'active' or v_wallet.wallet_policy_id<>v_config.wallet_policy_id then
      raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501';
    end if;
    if exists(select 1 from public.joy8_match_participants p
      where p.wallet_account_id=v_wallet.id and p.released_at is null) then
      raise exception 'JOY8_WALLET_OCCUPIED' using errcode='55000';
    end if;
    if v_wallet.balance-v_wallet.locked_balance<v_amount then
      raise exception 'JOY8_INSUFFICIENT_BALANCE' using errcode='22003';
    end if;
    insert into public.joy8_match_participants(
      match_id,player_account_id,wallet_account_id,game_session_id,reserved_amount
    ) values(v_match.id,v_session.player_account_id,v_wallet.id,v_session.id,v_amount);
    update public.wallet_accounts set locked_balance=locked_balance+v_amount,updated_at=now()
      where id=v_wallet.id;
  end loop;
  if v_config.product_adapter is not null then
    perform public.joy8_product_adapter(v_config.product_adapter,'open',v_match.id,
      jsonb_build_object('version',1,'game_id',v_game,'request',p_request));
  elsif jsonb_array_length(v_products)>0 then
    raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('version',1,'match_id',v_match.id,'state','open');
end;
$$;

revoke all on function public.joy8_provision_wallet(uuid,uuid),
  public.joy8_server_session_v1(text,text,jsonb),public.joy8_open_match_v1(text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.joy8_server_session_v1(text,text,jsonb),
  public.joy8_open_match_v1(text,jsonb) to service_role;

commit;
