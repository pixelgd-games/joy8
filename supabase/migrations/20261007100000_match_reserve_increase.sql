begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.joy8_game_policies
  add column reserve_increase_enabled boolean not null default false,
  add constraint joy8_game_policies_reserve_increase_check check(not reserve_increase_enabled
    or (funding_mode='platform' and reservation_mode='capped' and product_adapter is null));

alter table public.joy8_matches
  add column reserve_increase_enabled boolean not null default false,
  add constraint joy8_matches_reserve_increase_check check(not reserve_increase_enabled
    or (funding_mode='platform' and reservation_mode='capped' and product_adapter is null));

alter table public.joy8_backend_keys drop constraint joy8_backend_keys_scopes_check;
alter table public.joy8_backend_keys add constraint joy8_backend_keys_scopes_check check(cardinality(scopes)>0
  and scopes <@ array['exchange','renew','open','settle','status','cancel','reserve']::text[]);

create table public.joy8_reserve_operations (
  game_id uuid not null,
  operation_key text not null check(length(operation_key) between 1 and 180),
  match_id uuid not null references public.joy8_matches(id) on delete restrict,
  player_account_id uuid,
  amount numeric(18,2) check(amount>0),
  request_hash text check(length(request_hash)=64),
  state text not null check(state in ('applied','cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  primary key(game_id,operation_key),
  foreign key(match_id,player_account_id) references public.joy8_match_participants(match_id,player_account_id) on delete restrict,
  check((player_account_id is null)=(amount is null) and (amount is null)=(request_hash is null)),
  check(amount is not null or state='cancelled'),
  check((state='cancelled')=(cancelled_at is not null))
);
create index joy8_reserve_operations_match on public.joy8_reserve_operations(match_id);
alter table public.joy8_reserve_operations enable row level security;
revoke all on public.joy8_reserve_operations from public,anon,authenticated,service_role;

create function public.joy8_guard_reserve_operation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or old.state<>'applied' or new.state<>'cancelled' or new.cancelled_at is null
    or (to_jsonb(new)-array['state','cancelled_at'])<>(to_jsonb(old)-array['state','cancelled_at']) then
    raise exception 'JOY8_RESERVE_OPERATION_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger joy8_reserve_operations_guard before update or delete on public.joy8_reserve_operations
  for each row execute function public.joy8_guard_reserve_operation();
revoke all on function public.joy8_guard_reserve_operation() from public,anon,authenticated,service_role;

create or replace function public.joy8_open_match_v1(p_secret text,p_request jsonb)
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
  if v_config.funding_mode='platform' and jsonb_array_length(v_products)>0 then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_count:=jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count+jsonb_array_length(v_products)>v_config.max_participants then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_request->'participants') loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['session_id','reserve'])<>'{}'::jsonb
      or (v_item->>'session_id') is null then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_amount<=0 or (v_config.reservation_mode='capped'
        and (v_amount<v_config.min_bet_amount or v_amount>v_config.max_bet_amount))
      or (v_config.reservation_mode='full_balance' and v_config.max_reserve_amount is not null
        and v_amount>v_config.max_reserve_amount) then
      raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023';
    end if;
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
    if v_amount<=0 or v_amount>v_config.max_payout_amount then raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023'; end if;
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
    max_bet_amount,max_payout_amount,funding_mode,product_adapter,product_participants,
    reservation_mode,max_reserve_amount,reserve_increase_enabled)
  values(v_game,p_request->>'match_ref',p_request->>'rule_version',v_hash,v_config.wallet_policy_id,
    v_config.max_bet_amount,v_config.max_payout_amount,v_config.funding_mode,v_config.product_adapter,v_products,
    v_config.reservation_mode,v_config.max_reserve_amount,v_config.reserve_increase_enabled)
  returning * into v_match;
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
    if v_config.reservation_mode='full_balance' and v_wallet.balance-v_wallet.locked_balance<>v_amount then
      raise exception 'JOY8_INVALID_AMOUNT' using errcode='22023';
    end if;
    if v_config.reservation_mode='full_balance' and v_amount<v_config.min_bet_amount then
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

create function public.joy8_reserve_operation_v1(p_secret text,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_match public.joy8_matches%rowtype;
  v_operation public.joy8_reserve_operations%rowtype;
  v_part public.joy8_match_participants%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_hash text;
  v_amount numeric;
  v_count integer;
begin
  if p_action is null or p_action not in ('reserve','reserve-cancel','reserve-status') then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_game:=public.joy8_backend_game(p_secret,case when p_action='reserve-status' then 'status' else 'reserve' end);
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-case when p_action='reserve' then array['version','match_ref','operation_key','account_ref','amount']
      else array['version','match_ref','operation_key'] end)<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or coalesce(length(p_request->>'operation_key'),0) not between 1 and 180
    or (p_action='reserve' and coalesce(p_request->>'account_ref','')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  if p_action='reserve' then
    v_amount:=public.joy8_point_amount(p_request->'amount');
    v_hash:=public.joy8_hash_secret(p_request::text);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'operation_key'),3));
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if not found then raise exception 'JOY8_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  select o.* into v_operation from public.joy8_reserve_operations o
    where o.game_id=v_game and o.operation_key=p_request->>'operation_key';
  if v_operation.operation_key is not null and v_operation.match_id<>v_match.id then
    raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if p_action='reserve' then
    if v_operation.operation_key is not null then
      if v_operation.state='cancelled' then raise exception 'JOY8_RESERVE_CANCELLED' using errcode='55000'; end if;
      if v_operation.request_hash<>v_hash then raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
      return public.joy8_reserve_result(v_match,v_operation);
    end if;
    if v_match.state<>'open' then raise exception 'JOY8_MATCH_FINALIZED' using errcode='55000'; end if;
    if not v_match.reserve_increase_enabled or not exists(select 1 from public.joy8_game_policies g
      join public.joy8_wallet_policies p on p.id=g.wallet_policy_id
      where g.game_id=v_game and g.enabled and p.enabled) then
      raise exception 'JOY8_GAME_NOT_READY' using errcode='42501';
    end if;
    if v_match.settlement_count>0 then raise exception 'JOY8_RESERVE_CLOSED' using errcode='55000'; end if;
    select count(*) into v_count from public.joy8_reserve_operations where match_id=v_match.id;
    if v_amount<=0 or v_count>=50 then raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023'; end if;
    select p.* into v_part from public.joy8_match_participants p
      where p.match_id=v_match.id and p.player_account_id=(p_request->>'account_ref')::uuid;
    if not found or v_part.released_at is not null then
      raise exception 'JOY8_INVALID_ENTRY' using errcode='22023';
    end if;
    perform public.joy8_assert_player(v_part.player_account_id);
    perform 1 from public.game_sessions s where s.id=v_part.game_session_id and s.game_id=v_game
      and s.status='active' and s.expires_at>now() and s.launch_code_used_at is not null for share;
    if not found then raise exception 'JOY8_SESSION_INVALID' using errcode='42501'; end if;
    select w.* into v_wallet from public.wallet_accounts w where w.id=v_part.wallet_account_id for update;
    if v_wallet.status<>'active' or v_wallet.wallet_policy_id<>v_match.wallet_policy_id
      or v_wallet.locked_balance<v_part.reserved_amount then
      raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501';
    end if;
    if v_part.reserved_amount+v_amount>v_match.max_bet_amount
      or v_part.reserved_amount+v_amount>v_match.max_payout_amount then
      raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023';
    end if;
    if v_wallet.balance-v_wallet.locked_balance<v_amount then
      raise exception 'JOY8_INSUFFICIENT_BALANCE' using errcode='22003';
    end if;
    update public.wallet_accounts set locked_balance=locked_balance+v_amount,updated_at=now() where id=v_wallet.id;
    update public.joy8_match_participants set reserved_amount=reserved_amount+v_amount
      where match_id=v_match.id and player_account_id=v_part.player_account_id;
    insert into public.joy8_reserve_operations(game_id,operation_key,match_id,player_account_id,amount,request_hash,state)
      values(v_game,p_request->>'operation_key',v_match.id,v_part.player_account_id,v_amount,v_hash,'applied')
      returning * into v_operation;
    return public.joy8_reserve_result(v_match,v_operation);
  end if;

  if p_action='reserve-status' then
    if v_operation.operation_key is null then
      return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state,
        'operation_key',p_request->>'operation_key','operation_state','not_found','amount',null,'reserve',null);
    end if;
    return public.joy8_reserve_result(v_match,v_operation);
  end if;

  if v_operation.operation_key is null then
    select count(*) into v_count from public.joy8_reserve_operations where match_id=v_match.id;
    if v_count>=100 then raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023'; end if;
    insert into public.joy8_reserve_operations(game_id,operation_key,match_id,state,cancelled_at)
      values(v_game,p_request->>'operation_key',v_match.id,'cancelled',now())
      returning * into v_operation;
    return public.joy8_reserve_result(v_match,v_operation);
  end if;
  if v_operation.state='cancelled' or v_match.state='cancelled' then
    return public.joy8_reserve_result(v_match,v_operation);
  end if;
  if v_match.state<>'open' then raise exception 'JOY8_MATCH_FINALIZED' using errcode='55000'; end if;
  if v_match.settlement_count>0 then raise exception 'JOY8_RESERVE_CLOSED' using errcode='55000'; end if;
  select p.* into strict v_part from public.joy8_match_participants p
    where p.match_id=v_match.id and p.player_account_id=v_operation.player_account_id;
  select w.* into strict v_wallet from public.wallet_accounts w where w.id=v_part.wallet_account_id for update;
  if v_part.released_at is not null or v_part.reserved_amount-v_operation.amount<=0
    or v_wallet.locked_balance<v_operation.amount then
    raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501';
  end if;
  update public.wallet_accounts set locked_balance=locked_balance-v_operation.amount,updated_at=now() where id=v_wallet.id;
  update public.joy8_match_participants set reserved_amount=reserved_amount-v_operation.amount
    where match_id=v_match.id and player_account_id=v_part.player_account_id;
  update public.joy8_reserve_operations set state='cancelled',cancelled_at=now()
    where game_id=v_game and operation_key=v_operation.operation_key returning * into v_operation;
  return public.joy8_reserve_result(v_match,v_operation);
end;
$$;

create function public.joy8_reserve_result(p_match public.joy8_matches,p_operation public.joy8_reserve_operations)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version',1,'match_id',p_match.id,'state',p_match.state,
    'operation_key',p_operation.operation_key,'operation_state',p_operation.state,
    'amount',p_operation.amount::numeric(18,2)::text,
    'reserve',(select p.reserved_amount::numeric(18,2)::text from public.joy8_match_participants p
      where p_match.state='open' and p.match_id=p_match.id and p.player_account_id=p_operation.player_account_id
        and p.released_at is null));
$$;

revoke all on function public.joy8_reserve_operation_v1(text,text,jsonb),
  public.joy8_reserve_result(public.joy8_matches,public.joy8_reserve_operations)
  from public,anon,authenticated,service_role;
grant execute on function public.joy8_reserve_operation_v1(text,text,jsonb) to service_role;

create or replace function public.joy8_admit_gateway_request(
  p_route text, p_request jsonb default '{}'::jsonb, p_secret text default null, p_auth_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_subject uuid;
  v_action text;
  v_key text;
  v_limit integer:=120;
  v_window integer:=60;
  v_session public.game_sessions%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    return jsonb_build_object('error','JOY8_INVALID_REQUEST');
  end if;
  if p_route in ('member','enroll-member','create-session','private-session') then
    if p_auth_user_id is null or not exists(select 1 from auth.users u where u.id=p_auth_user_id
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
      return jsonb_build_object('error','JOY8_PLAYER_INACTIVE');
    end if;
    v_key:='player:'||p_auth_user_id::text||':'||p_route;
    if p_route<>'member' then v_limit:=30; v_window:=300; end if;
  elsif p_route='balance' then
    select s.player_account_id into v_subject from public.joy8_active_session(p_request->>'gateway_token','balance') s;
    if not found then return jsonb_build_object('error','JOY8_SESSION_INVALID'); end if;
    select p.auth_user_id into v_subject from public.player_accounts p where p.id=v_subject;
    if v_subject is null then return jsonb_build_object('error','JOY8_PLAYER_INACTIVE'); end if;
    v_key:='player:'||v_subject::text||':balance';
  elsif p_route in ('server-exchange-v1','server-renew-v1','server-open-v1','server-settle-v1','server-status-v1',
    'server-cancel-v1','server-reserve-v1','server-reserve-cancel-v1','server-reserve-status-v1') then
    v_action:=substring(p_route from 8 for length(p_route)-10);
    begin
      v_game:=public.joy8_backend_game(p_secret,case v_action when 'reserve-cancel' then 'reserve'
        when 'reserve-status' then 'status' else v_action end);
    exception when invalid_authorization_specification then
      return jsonb_build_object('error','JOY8_BACKEND_UNAUTHORIZED');
    end;
    if not public.joy8_consume_gateway_rate_limit('backend:'||v_game::text,6000,60) then
      return jsonb_build_object('allowed',false,'retry_after',60);
    end if;
    if p_request->>'version' is distinct from '1' then
      return jsonb_build_object('error','JOY8_INVALID_REQUEST');
    end if;
    if v_action in ('exchange','renew') then
      if v_action='exchange' then
        if coalesce(p_request->>'launch_code','') !~ '^[a-f0-9]{64}$' then
          return jsonb_build_object('error','JOY8_INVALID_REQUEST');
        end if;
        select s.* into v_session from public.game_sessions s
          where s.launch_code_hash=public.joy8_hash_secret(p_request->>'launch_code') and s.game_id=v_game;
      else
        if coalesce(p_request->>'session_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
          return jsonb_build_object('error','JOY8_INVALID_REQUEST');
        end if;
        select s.* into v_session from public.game_sessions s
          where s.id=(p_request->>'session_id')::uuid and s.game_id=v_game and s.launch_code_used_at is not null;
      end if;
      if v_session.id is null or v_session.status<>'active' or v_session.expires_at<=now() then
        return jsonb_build_object('error','JOY8_SESSION_INVALID');
      end if;
      v_key:='session:'||v_session.id::text||':login';
      v_limit:=30;
    elsif v_action='open' then
      v_key:='backend:'||v_game::text||':open';
      v_limit:=120;
    else
      if coalesce(length(p_request->>'match_ref'),0) not between 1 and 120 then
        return jsonb_build_object('error','JOY8_INVALID_REQUEST');
      end if;
      select m.id into v_subject from public.joy8_matches m
        where m.game_id=v_game and m.match_ref=p_request->>'match_ref';
      if not found then return jsonb_build_object('error','JOY8_MATCH_NOT_FOUND'); end if;
      v_key:='match:'||v_subject::text||':'||case when v_action='reserve-cancel' then 'reserve' else v_action end;
      if v_action in ('settle','cancel','reserve','reserve-cancel') then v_limit:=30; end if;
    end if;
  else
    return jsonb_build_object('error','JOY8_INVALID_REQUEST');
  end if;
  return jsonb_build_object('allowed',public.joy8_consume_gateway_rate_limit(v_key,v_limit,v_window),'retry_after',v_window);
end;
$$;

create or replace function public.joy8_server_request_v1(
  p_route text, p_ingress_key text, p_ingress_limit integer, p_ingress_window integer,
  p_secret text, p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_admission jsonb;
  v_action text;
  v_result jsonb;
begin
  if not public.joy8_consume_gateway_rate_limit(p_ingress_key,p_ingress_limit,p_ingress_window) then
    return jsonb_build_object('limited',true,'retry_after',p_ingress_window);
  end if;
  if p_secret is null or p_request is null then
    return jsonb_build_object('precheck',true);
  end if;
  v_admission:=public.joy8_admit_gateway_request(p_route,p_request,p_secret,null);
  if v_admission ? 'error' then
    return jsonb_build_object('admission_error',v_admission->>'error');
  end if;
  if (v_admission->>'allowed')::boolean is distinct from true then
    return jsonb_build_object('limited',true,'retry_after',v_admission->'retry_after');
  end if;
  v_action:=substring(p_route from 8 for length(p_route)-10);
  begin
    if v_action in ('exchange','renew') then
      v_result:=public.joy8_server_session_v1(p_secret,v_action,p_request);
    elsif v_action='open' then
      if p_request ? 'settlement' then
        v_result:=public.joy8_open_with_settlement_v1(p_secret,p_request);
      else
        v_result:=public.joy8_open_match_v1(p_secret,p_request);
      end if;
    elsif v_action='settle' then
      v_result:=public.joy8_settle_match_v1(p_secret,p_request);
    elsif v_action in ('status','cancel') then
      v_result:=public.joy8_match_status_v1(p_secret,p_request,v_action='cancel');
    elsif v_action in ('reserve','reserve-cancel','reserve-status') then
      v_result:=public.joy8_reserve_operation_v1(p_secret,v_action,p_request);
    else
      return jsonb_build_object('admission_error','JOY8_INVALID_REQUEST');
    end if;
    if v_action in ('open','settle','reserve','reserve-cancel') then
      v_result:=v_result||public.joy8_match_available_points_v1((v_result->>'match_id')::uuid);
    end if;
  exception when others then
    return jsonb_build_object('error',jsonb_build_object('message',SQLERRM,'code',SQLSTATE));
  end;
  return jsonb_build_object('result',v_result);
end;
$$;

commit;
