begin;

alter table public.joy8_game_policies
  add column min_bet_amount numeric(18,2) not null default 1,
  add constraint joy8_game_policies_min_bet_amount_check check(min_bet_amount>0),
  add constraint joy8_game_policies_min_bet_range_check
    check(reservation_mode='full_balance' or min_bet_amount<=max_bet_amount);

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
    reservation_mode,max_reserve_amount)
  values(v_game,p_request->>'match_ref',p_request->>'rule_version',v_hash,v_config.wallet_policy_id,
    v_config.max_bet_amount,v_config.max_payout_amount,v_config.funding_mode,v_config.product_adapter,v_products,
    v_config.reservation_mode,v_config.max_reserve_amount)
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


commit;
