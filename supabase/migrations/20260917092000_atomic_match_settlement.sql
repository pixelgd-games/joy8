begin;

create function public.looty_point_amount(p_value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string'
    or (p_value #>> '{}') !~ '^-?(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$' then
    raise exception 'LOOTY_INVALID_AMOUNT' using errcode='22023';
  end if;
  return (p_value #>> '{}')::numeric;
end;
$$;

create function public.looty_product_adapter(
  p_adapter regprocedure,p_action text,p_match uuid,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_schema text; v_name text; v_result jsonb;
begin
  select n.nspname,p.proname into v_schema,v_name from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where p.oid=p_adapter::oid and p.proargtypes='25 2950 3802'::oidvector
    and p.prorettype='jsonb'::regtype and not p.proretset and p.prosecdef
    and not exists(select 1 from pg_catalog.pg_roles r where r.oid=p.proowner and (r.rolsuper or r.rolbypassrls))
    and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname in ('public','auth') and c.relkind in ('r','p')
        and (has_table_privilege(p.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          or (c.relname<>'games' and has_table_privilege(p.proowner,c.oid,'SELECT'))))
    and n.nspname not in ('public','auth','extensions','pg_catalog','information_schema');
  if not found then raise exception 'LOOTY_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
  execute format('select %I.%I($1,$2,$3)',v_schema,v_name) into v_result
    using p_action,p_match,p_payload;
  if v_result->>'committed' is distinct from 'true' then
    raise exception 'LOOTY_ADAPTER_REJECTED' using errcode='42501';
  end if;
  return v_result;
end;
$$;

create function public.looty_open_match_v1(p_secret text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_config record;
  v_match public.looty_matches%rowtype;
  v_hash text;
  v_item jsonb;
  v_player uuid;
  v_wallet public.wallet_accounts%rowtype;
  v_session public.game_sessions%rowtype;
  v_amount numeric;
  v_count integer;
  v_products jsonb:=coalesce(p_request->'product_participants','[]'::jsonb);
begin
  v_game:=public.looty_backend_game(p_secret,'open');
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref','rule_version','participants','product_participants'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or coalesce(length(p_request->>'rule_version'),0) not between 1 and 80
    or jsonb_typeof(p_request->'participants') is distinct from 'array'
    or jsonb_typeof(v_products) is distinct from 'array' then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.looty_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text || ':' || (p_request->>'match_ref'),1));
  select m.* into v_match from public.looty_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if found then
    if v_match.open_hash<>v_hash then raise exception 'LOOTY_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state);
  end if;
  select g.*,p.game_id as scope_game into v_config from public.looty_game_policies g
  join public.looty_wallet_policies p on p.id=g.wallet_policy_id
  where g.game_id=v_game and g.enabled and p.enabled and (p.game_id is null or p.game_id=v_game)
  for share of g,p;
  if not found then raise exception 'LOOTY_GAME_NOT_READY' using errcode='42501'; end if;
  v_count:=jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count+jsonb_array_length(v_products)>v_config.max_participants then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_request->'participants') loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['session_id','reserve'])<>'{}'::jsonb
      or (v_item->>'session_id') is null then raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023'; end if;
    v_amount:=public.looty_point_amount(v_item->'reserve');
    if v_amount<=0 or v_amount>v_config.max_entry_amount then raise exception 'LOOTY_LIMIT_EXCEEDED' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'session_id') from jsonb_array_elements(p_request->'participants'))<>v_count then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_products) loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['account_ref','reserve'])<>'{}'::jsonb
      or coalesce(length(v_item->>'account_ref'),0) not between 1 and 120 then
      raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
    end if;
    v_amount:=public.looty_point_amount(v_item->'reserve');
    if v_amount<=0 or v_amount>v_config.max_entry_amount then raise exception 'LOOTY_LIMIT_EXCEEDED' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'account_ref') from jsonb_array_elements(v_products))<>jsonb_array_length(v_products) then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_player in select distinct s.player_account_id from public.game_sessions s
    join jsonb_array_elements(p_request->'participants') e on s.id=(e.value->>'session_id')::uuid
    order by s.player_account_id loop
    perform public.looty_assert_player(v_player);
  end loop;
  perform w.id from public.wallet_accounts w join public.game_sessions s on s.wallet_account_id=w.id
    join jsonb_array_elements(p_request->'participants') e on s.id=(e.value->>'session_id')::uuid
    order by w.id for update of w;
  insert into public.looty_matches(game_id,match_ref,rule_version,open_hash,wallet_policy_id,
    max_entry_amount,product_adapter,product_participants)
  values(v_game,p_request->>'match_ref',p_request->>'rule_version',v_hash,v_config.wallet_policy_id,
    v_config.max_entry_amount,v_config.product_adapter,v_products) returning * into v_match;
  for v_item in select value from jsonb_array_elements(p_request->'participants') order by value->>'session_id' loop
    select s.* into v_session from public.game_sessions s where s.id=(v_item->>'session_id')::uuid
      and s.game_id=v_game and s.status='active' and s.expires_at>now()
      and s.launch_code_used_at is not null for share;
    if not found then raise exception 'LOOTY_SESSION_INVALID' using errcode='42501'; end if;
    select w.* into v_wallet from public.wallet_accounts w where w.id=v_session.wallet_account_id;
    v_amount:=public.looty_point_amount(v_item->'reserve');
    if v_wallet.status<>'active' or v_wallet.wallet_policy_id<>v_config.wallet_policy_id then
      raise exception 'LOOTY_WALLET_INACTIVE' using errcode='42501';
    end if;
    if exists(select 1 from public.looty_match_participants p where p.wallet_account_id=v_wallet.id and p.released_at is null) then
      raise exception 'LOOTY_WALLET_OCCUPIED' using errcode='55000';
    end if;
    if v_wallet.balance-v_wallet.locked_balance<v_amount then
      raise exception 'LOOTY_INSUFFICIENT_BALANCE' using errcode='22003';
    end if;
    insert into public.looty_match_participants(match_id,player_account_id,wallet_account_id,game_session_id,reserved_amount)
    values(v_match.id,v_session.player_account_id,v_wallet.id,v_session.id,v_amount);
    update public.wallet_accounts set locked_balance=locked_balance+v_amount,updated_at=now() where id=v_wallet.id;
  end loop;
  if v_config.product_adapter is not null then
    perform public.looty_product_adapter(v_config.product_adapter,'open',v_match.id,
      jsonb_build_object('version',1,'game_id',v_game,'request',p_request));
  elsif jsonb_array_length(v_products)>0 then
    raise exception 'LOOTY_ADAPTER_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('version',1,'match_id',v_match.id,'state','open');
end;
$$;

create function public.looty_settle_match_v1(p_secret text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_match public.looty_matches%rowtype;
  v_existing public.looty_settlements%rowtype;
  v_part public.looty_match_participants%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_item jsonb;
  v_amount numeric;
  v_total numeric:=0;
  v_fee numeric:=0;
  v_hash text;
  v_id uuid:=gen_random_uuid();
  v_index integer:=0;
  v_result jsonb;
  v_product jsonb;
begin
  v_game:=public.looty_backend_game(p_secret,'settle');
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref','rule_version','operation_key','entries','product_commit'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or coalesce(length(p_request->>'operation_key'),0) not between 1 and 180
    or jsonb_typeof(p_request->'entries') is distinct from 'array'
    or jsonb_typeof(coalesce(p_request->'product_commit','{}'::jsonb)) is distinct from 'object' then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  if jsonb_array_length(p_request->'entries') not between 0 and 65 then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.looty_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text || ':' || (p_request->>'match_ref'),1));
  perform pg_advisory_xact_lock(hashtextextended(v_game::text || ':' || (p_request->>'operation_key'),2));
  select s.* into v_existing from public.looty_settlements s
    where s.game_id=v_game and s.operation_key=p_request->>'operation_key';
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'LOOTY_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return v_existing.result;
  end if;
  select m.* into v_match from public.looty_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if not found then raise exception 'LOOTY_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  if v_match.state<>'open' then raise exception 'LOOTY_MATCH_FINALIZED' using errcode='55000'; end if;
  if p_request->>'rule_version' is distinct from v_match.rule_version then
    raise exception 'LOOTY_RULE_MISMATCH' using errcode='22023';
  end if;
  if (select count(distinct (value->>'kind',value->>'account_ref')) from jsonb_array_elements(p_request->'entries'))
    <>jsonb_array_length(p_request->'entries') then raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_request->'entries') loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['kind','account_ref','amount','source'])<>'{}'::jsonb
      or coalesce(v_item->>'kind','') not in ('player','product','fee')
      or coalesce(length(v_item->>'account_ref'),0) not between 1 and 120 then
      raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
    end if;
    v_amount:=public.looty_point_amount(v_item->'amount');
    if v_amount=0 or abs(v_amount)>v_match.max_entry_amount then
      raise exception 'LOOTY_LIMIT_EXCEEDED' using errcode='22023';
    end if;
    if v_item->>'kind'='fee' then
      if v_amount<0 or v_item->>'source' is distinct from 'fee' or v_item->>'account_ref'<>v_game::text then
        raise exception 'LOOTY_INVALID_ENTRY' using errcode='22023';
      end if;
      v_fee:=v_fee+v_amount;
    else
      if v_item->>'source' is distinct from 'gameplay' then raise exception 'LOOTY_INVALID_ENTRY' using errcode='22023'; end if;
      if v_item->>'kind'='player' then
        if v_item->>'account_ref' is distinct from ((v_item->>'account_ref')::uuid)::text then
          raise exception 'LOOTY_INVALID_ENTRY' using errcode='22023';
        end if;
        select p.* into v_part from public.looty_match_participants p
          where p.match_id=v_match.id and p.player_account_id=(v_item->>'account_ref')::uuid;
        if not found or v_part.released_at is not null or -v_amount>v_part.reserved_amount then
          raise exception 'LOOTY_INVALID_ENTRY' using errcode='22023';
        end if;
      else
        select value into v_product from jsonb_array_elements(v_match.product_participants)
          where value->>'account_ref'=v_item->>'account_ref';
        if not found or -v_amount>public.looty_point_amount(v_product->'reserve') then
          raise exception 'LOOTY_INVALID_ENTRY' using errcode='22023';
        end if;
      end if;
    end if;
    v_total:=v_total+v_amount;
  end loop;
  if v_total<>0 then raise exception 'LOOTY_UNBALANCED_SETTLEMENT' using errcode='22023'; end if;
  perform w.id from public.wallet_accounts w join public.looty_match_participants p on p.wallet_account_id=w.id
    where p.match_id=v_match.id order by w.id for update of w;
  for v_part in select * from public.looty_match_participants where match_id=v_match.id order by wallet_account_id loop
    select w.* into v_wallet from public.wallet_accounts w where w.id=v_part.wallet_account_id;
    if v_wallet.status<>'active'
      or v_wallet.wallet_policy_id<>v_match.wallet_policy_id or v_part.released_at is not null
      or v_wallet.locked_balance<v_part.reserved_amount then
      raise exception 'LOOTY_WALLET_INACTIVE' using errcode='42501';
    end if;
    select public.looty_point_amount(value->'amount') into v_amount from jsonb_array_elements(p_request->'entries')
      where value->>'kind'='player' and value->>'account_ref'=v_part.player_account_id::text;
    v_amount:=coalesce(v_amount,0);
    if v_wallet.balance+v_amount<0 then raise exception 'LOOTY_INSUFFICIENT_BALANCE' using errcode='22003'; end if;
    update public.wallet_accounts set balance=balance+v_amount,
      locked_balance=locked_balance-v_part.reserved_amount,updated_at=now() where id=v_wallet.id;
    if v_amount<>0 then
      insert into public.wallet_transactions(wallet_account_id,type,amount,balance_before,balance_after,
        game_id,round_id,game_session_id,idempotency_key,source_type,source_ref)
      values(v_wallet.id,case when v_amount<0 then 'bet' else 'payout' end,abs(v_amount),v_wallet.balance,
        v_wallet.balance+v_amount,v_game,v_match.match_ref,v_part.game_session_id,
        'settlement:'||v_id::text||':'||v_wallet.id::text,'gameplay',v_id::text);
    end if;
  end loop;
  if v_fee>0 then
    insert into public.looty_fee_accounts(game_id,balance) values(v_game,v_fee)
      on conflict(game_id) do update set balance=public.looty_fee_accounts.balance+excluded.balance;
  end if;
  if v_match.product_adapter is not null then
    perform public.looty_product_adapter(v_match.product_adapter,'settle',v_match.id,
      jsonb_build_object('version',1,'game_id',v_game,'settlement_id',v_id,'request_hash',v_hash,'request',p_request));
  elsif coalesce(p_request->'product_commit','{}'::jsonb)<>'{}'::jsonb then
    raise exception 'LOOTY_ADAPTER_UNAVAILABLE' using errcode='42501';
  end if;
  v_result:=jsonb_build_object('version',1,'settlement_id',v_id,'match_id',v_match.id,
    'state','settled','request_hash',v_hash,'settled_at',now());
  insert into public.looty_settlements(id,match_id,game_id,operation_key,request_hash,result)
    values(v_id,v_match.id,v_game,p_request->>'operation_key',v_hash,v_result);
  for v_item in select value from jsonb_array_elements(p_request->'entries') loop
    insert into public.looty_settlement_entries(settlement_id,entry_index,kind,account_ref,amount,source_type)
    values(v_id,v_index,v_item->>'kind',v_item->>'account_ref',public.looty_point_amount(v_item->'amount'),v_item->>'source');
    v_index:=v_index+1;
  end loop;
  update public.looty_match_participants set released_at=now() where match_id=v_match.id;
  update public.looty_matches set state='settled',finalized_at=now(),result=v_result where id=v_match.id;
  return v_result;
end;
$$;

create function public.looty_match_status_v1(p_secret text,p_request jsonb,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_game uuid; v_match public.looty_matches%rowtype; v_part record;
begin
  v_game:=public.looty_backend_game(p_secret,case when p_cancel then 'cancel' else 'status' end);
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120 then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  select m.* into v_match from public.looty_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if not found then raise exception 'LOOTY_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  if p_cancel and v_match.state='settled' then raise exception 'LOOTY_MATCH_FINALIZED' using errcode='55000'; end if;
  if p_cancel and v_match.state='open' then
    perform w.id from public.wallet_accounts w join public.looty_match_participants p on p.wallet_account_id=w.id
      where p.match_id=v_match.id order by w.id for update of w;
    for v_part in select * from public.looty_match_participants where match_id=v_match.id loop
      update public.wallet_accounts set locked_balance=locked_balance-v_part.reserved_amount,updated_at=now()
        where id=v_part.wallet_account_id;
    end loop;
    if v_match.product_adapter is not null then
      perform public.looty_product_adapter(v_match.product_adapter,'cancel',v_match.id,
        jsonb_build_object('version',1,'game_id',v_game,'request',p_request));
    end if;
    update public.looty_match_participants set released_at=now() where match_id=v_match.id;
    update public.looty_matches set state='cancelled',finalized_at=now() where id=v_match.id;
    v_match.state:='cancelled';
  end if;
  return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state,'result',v_match.result);
end;
$$;

create trigger looty_wallet_transactions_immutable before update or delete on public.wallet_transactions
for each row execute function public.looty_reject_accounting_change();

revoke all on function public.looty_point_amount(jsonb),public.looty_product_adapter(regprocedure,text,uuid,jsonb),
  public.looty_settle_match_v1(text,jsonb),public.looty_match_status_v1(text,jsonb,boolean),
  public.looty_open_match_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.looty_open_match_v1(text,jsonb),public.looty_settle_match_v1(text,jsonb),
  public.looty_match_status_v1(text,jsonb,boolean) to service_role;

commit;
