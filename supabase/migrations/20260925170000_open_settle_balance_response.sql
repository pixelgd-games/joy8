begin;

create function public.joy8_match_available_points_v1(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_balance text;
  v_balances jsonb;
begin
  select count(*), max((w.balance-w.locked_balance)::numeric(18,2)::text),
    jsonb_object_agg(p.player_account_id::text,(w.balance-w.locked_balance)::numeric(18,2)::text)
  into v_count,v_balance,v_balances
  from public.joy8_match_participants p
  join public.wallet_accounts w on w.id=p.wallet_account_id
  where p.match_id=p_match_id;
  if v_count=0 then raise exception 'JOY8_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  if v_count=1 then return jsonb_build_object('available_balance',v_balance); end if;
  return jsonb_build_object('available_balances',v_balances);
end;
$$;

create function public.joy8_open_with_settlement_v1(p_secret text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_hash text;
  v_match public.joy8_matches%rowtype;
  v_settlement jsonb:=p_request->'settlement';
  v_settle_request jsonb;
  v_settle_result jsonb;
  v_open_result jsonb;
begin
  v_game:=public.joy8_backend_game(p_secret,'open');
  perform public.joy8_backend_game(p_secret,'settle');
  if jsonb_typeof(p_request) is distinct from 'object'
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or jsonb_typeof(v_settlement) is distinct from 'object'
    or (v_settlement-array['operation_key','final','entries','product_commit'])<>'{}'::jsonb
    or not (v_settlement ?& array['operation_key','final','entries']) then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.joy8_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if found then
    if v_match.open_hash<>v_hash then raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    select s.result into v_settle_result from public.joy8_settlements s
      where s.match_id=v_match.id and s.settlement_no=1;
    if not found then raise exception 'JOY8_UPSTREAM_UNAVAILABLE' using errcode='55000'; end if;
    return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state,
      'settlement',v_settle_result);
  end if;
  v_open_result:=public.joy8_open_match_v1(p_secret,p_request-'settlement');
  update public.joy8_matches set open_hash=v_hash where id=(v_open_result->>'match_id')::uuid;
  v_settle_request:=jsonb_build_object('version',1,'match_ref',p_request->>'match_ref',
    'rule_version',p_request->>'rule_version','operation_key',v_settlement->'operation_key',
    'settlement_no',1,'final',v_settlement->'final','entries',v_settlement->'entries');
  if v_settlement ? 'product_commit' then
    v_settle_request:=v_settle_request||jsonb_build_object('product_commit',v_settlement->'product_commit');
  end if;
  v_settle_result:=public.joy8_settle_match_v1(p_secret,v_settle_request);
  return jsonb_build_object('version',1,'match_id',v_open_result->'match_id',
    'state',v_settle_result->>'state','settlement',v_settle_result);
end;
$$;

revoke all on function public.joy8_match_available_points_v1(uuid),
  public.joy8_open_with_settlement_v1(text,jsonb) from public,anon,authenticated,service_role;

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
    else
      return jsonb_build_object('admission_error','JOY8_INVALID_REQUEST');
    end if;
    if v_action in ('open','settle') then
      v_result:=v_result||public.joy8_match_available_points_v1((v_result->>'match_id')::uuid);
    end if;
  exception when others then
    return jsonb_build_object('error',jsonb_build_object('message',SQLERRM,'code',SQLSTATE));
  end;
  return jsonb_build_object('result',v_result);
end;
$$;

commit;
