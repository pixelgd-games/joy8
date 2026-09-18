begin;

create role mahjong_clash_accounting_owner nologin noinherit nosuperuser nobypassrls;
grant usage on schema mahjong_clash to mahjong_clash_accounting_owner;
grant mahjong_clash_accounting_owner to current_user with set true;
grant mahjong_clash_accounting_owner to current_user with inherit true;
grant create on schema mahjong_clash to mahjong_clash_accounting_owner;
create policy accounting_owner on mahjong_clash.matches to mahjong_clash_accounting_owner using(true) with check(true);
create policy accounting_owner on mahjong_clash.match_players to mahjong_clash_accounting_owner using(true) with check(true);
create policy accounting_owner on mahjong_clash.hands to mahjong_clash_accounting_owner using(true) with check(true);
create policy accounting_owner on mahjong_clash.ai_accounts to mahjong_clash_accounting_owner using(true) with check(true);

create table mahjong_clash.platform_matches (
  match_id uuid primary key references mahjong_clash.matches(id),
  platform_match_id uuid not null unique,
  status text not null check(status in ('open','settled','cancelled')),
  settlement_count integer not null default 0
);
create table mahjong_clash.accounting_requests (
  match_id uuid not null,
  hand_serial integer not null,
  request jsonb not null,
  result_hash text not null,
  primary key(match_id,hand_serial),
  foreign key(match_id,hand_serial) references mahjong_clash.hands(match_id,hand_serial)
);
create table mahjong_clash.accounting_commits (
  match_id uuid not null,
  hand_serial integer not null,
  platform_settlement_id uuid not null unique,
  platform_request_hash text not null,
  primary key(match_id,hand_serial),
  foreign key(match_id,hand_serial) references mahjong_clash.accounting_requests(match_id,hand_serial)
);
create table mahjong_clash.player_profiles (
  player_account_id uuid primary key,
  hands bigint not null default 0,
  matches bigint not null default 0,
  wins bigint not null default 0,
  self_draws bigint not null default 0,
  deal_ins bigint not null default 0,
  draws bigint not null default 0,
  net_points bigint not null default 0,
  last_settled_at timestamptz not null
);
create trigger immutable_accounting_requests before update or delete on mahjong_clash.accounting_requests
  for each row execute function mahjong_clash.immutable_record();
create trigger immutable_accounting_commits before update or delete on mahjong_clash.accounting_commits
  for each row execute function mahjong_clash.immutable_record();

create function mahjong_clash.guard_posted_hand() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status in ('settled','voided') and (tg_op='DELETE' or new is distinct from old) then raise exception 'MAHJONG_RECORD_IMMUTABLE'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger immutable_posted_hand before update or delete on mahjong_clash.hands
  for each row execute function mahjong_clash.guard_posted_hand();

create function mahjong_clash.opening_request(p_match uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare m mahjong_clash.matches%rowtype; humans jsonb; bots jsonb;
begin
  select * into strict m from mahjong_clash.matches where id=p_match;
  select coalesce(jsonb_agg(jsonb_build_object('session_id',game_session_id,'reserve',starting_points::text||'.00') order by seat_index),'[]')
    into humans from mahjong_clash.match_players where match_id=p_match and participant_kind='human';
  select coalesce(jsonb_agg(jsonb_build_object('account_ref',ai_account_id,'reserve',starting_points::text||'.00') order by seat_index),'[]')
    into bots from mahjong_clash.match_players where match_id=p_match and participant_kind='ai';
  return jsonb_build_object('version',1,'match_ref',p_match,'rule_version',m.rule_version,'participants',humans,'product_participants',bots);
end;
$$;

create function mahjong_clash.prepare_hand_posting(p_match uuid,p_hand integer) returns jsonb
language plpgsql set search_path='' as $$
declare m mahjong_clash.matches%rowtype; h mahjong_clash.hands%rowtype; e mahjong_clash.hand_economy%rowtype;
  saved mahjong_clash.accounting_requests%rowtype; normalized jsonb; answer jsonb; kinds jsonb; entries jsonb:='[]'; p record; delta bigint; reason text; request jsonb;
begin
  select * into strict m from mahjong_clash.matches where id=p_match;
  select * into strict h from mahjong_clash.hands where match_id=p_match and hand_serial=p_hand;
  select * into saved from mahjong_clash.accounting_requests where match_id=p_match and hand_serial=p_hand;
  if found then
    if saved.result_hash<>mahjong_clash.hash_json(h.result) then raise exception 'MAHJONG_RESULT_CHANGED'; end if;
    return saved.request;
  end if;
  select * into strict e from mahjong_clash.hand_economy where match_id=p_match and hand_serial=p_hand;
  if h.result is null or h.result->>'type' not in ('win','draw') then raise exception 'MAHJONG_RESULT_REQUIRED'; end if;
  normalized:=jsonb_build_object('type',h.result->>'type','payments',coalesce((select jsonb_agg(jsonb_build_object('payerIndex',item->'payerIndex','requiredAmount',item->'requiredAmount') order by n)
    from jsonb_array_elements(h.result->'settlement'->'payments') with ordinality t(item,n)),'[]'));
  if h.result->>'type'='win' then normalized:=normalized||jsonb_build_object('winnerIndex',h.result->'winnerIndex'); end if;
  select jsonb_agg(participant_kind order by seat_index) into kinds from mahjong_clash.match_players where match_id=p_match;
  answer:=mahjong_clash.calculate_hand_economy(e.opening_balances,kinds,normalized,e.version);
  if answer->'deltas' is distinct from h.result->'settlement'->'deltas'
    or answer->'winnerFee' is distinct from h.result->'settlement'->'fee'
    or answer->'grossWin' is distinct from h.result->'settlement'->'gain' then raise exception 'MAHJONG_RESULT_ACCOUNTING_MISMATCH'; end if;
  if exists(select 1 from jsonb_array_elements(h.result->'settlement'->'payments') with ordinality t(item,n)
    where item->'amount' is distinct from answer->'payments'->(n::integer-1)->'amount') then raise exception 'MAHJONG_PAYMENT_MISMATCH'; end if;
  reason:=case when m.match_format='hand' or h.dealer_step+case when (h.result->>'type'='draw' or (h.result->>'winnerIndex')::integer=h.dealer_seat) and h.repeats<9 then 0 else 1 end
    >=case m.match_format when 'round' then 4 else 16 end then 'format-complete'
    when exists(select 1 from jsonb_array_elements_text(answer->'balances') b where b::bigint<case m.stake_id when 'low' then 150 when 'medium' then 600 else 2000 end) then 'insufficient-balance' else '' end;
  if reason is distinct from h.result->>'endReason' then raise exception 'MAHJONG_END_REASON_MISMATCH'; end if;
  for p in select * from mahjong_clash.match_players where match_id=p_match order by seat_index loop
    delta:=(answer->'deltas'->>p.seat_index)::bigint;
    if delta=0 then continue; end if;
    entries:=entries||jsonb_build_array(jsonb_build_object('kind',case p.participant_kind when 'human' then 'player' else 'product' end,
      'account_ref',coalesce(p.player_account_id,p.ai_account_id),'amount',delta::text||'.00','source','gameplay'));
  end loop;
  if (answer->>'winnerFee')::bigint>0 then entries:=entries||jsonb_build_array(jsonb_build_object('kind','fee','account_ref',m.game_id,'amount',(answer->>'winnerFee')||'.00','source','fee')); end if;
  request:=jsonb_build_object('version',1,'match_ref',p_match,'rule_version',m.rule_version,'operation_key',p_match::text||':hand:'||p_hand,
    'settlement_no',p_hand,'final',reason<>'','entries',entries,'product_commit',jsonb_build_object('result_hash',mahjong_clash.hash_json(h.result),'result',normalized,'end_reason',reason));
  insert into mahjong_clash.accounting_requests values(p_match,p_hand,request,mahjong_clash.hash_json(h.result));
  return request;
end;
$$;

create function mahjong_clash.platform_accounting(p_action text,p_platform_match uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request jsonb:=p_payload->'request'; product_id uuid; m mahjong_clash.matches%rowtype;
  binding mahjong_clash.platform_matches%rowtype; saved mahjong_clash.accounting_requests%rowtype; h mahjong_clash.hands%rowtype;
  hand_no integer; answer jsonb; p record; expected_holds jsonb; delta bigint;
begin
  if p_payload->>'version' is distinct from '1' or p_action is null or p_action not in ('open','settle','cancel') then raise exception 'MAHJONG_ADAPTER_REQUEST'; end if;
  product_id:=(request->>'match_ref')::uuid;
  perform 1 from mahjong_clash.economy_state where singleton for update;
  select * into strict m from mahjong_clash.matches where matches.id=product_id for update;
  if m.game_id::text is distinct from p_payload->>'game_id' then raise exception 'MAHJONG_ADAPTER_GAME'; end if;
  if p_action='open' then
    if m.status<>'forming' or request is distinct from mahjong_clash.opening_request(product_id) then raise exception 'MAHJONG_ADAPTER_OPEN'; end if;
    perform mahjong_clash.reserve_match_ai(product_id);
    insert into mahjong_clash.platform_matches values(product_id,p_platform_match,'open',0);
    update mahjong_clash.matches set status='active' where matches.id=product_id;
    return jsonb_build_object('committed',true);
  end if;
  select * into strict binding from mahjong_clash.platform_matches where match_id=product_id for update;
  if binding.platform_match_id<>p_platform_match or binding.status<>'open' then raise exception 'MAHJONG_ADAPTER_BINDING'; end if;
  if p_action='settle' then
    hand_no:=(request->>'settlement_no')::integer;
    if hand_no<>binding.settlement_count+1 then raise exception 'MAHJONG_ADAPTER_SEQUENCE'; end if;
    select * into strict saved from mahjong_clash.accounting_requests where match_id=product_id and hand_serial=hand_no;
    select * into strict h from mahjong_clash.hands where match_id=product_id and hand_serial=hand_no;
    if request is distinct from saved.request or saved.result_hash<>mahjong_clash.hash_json(h.result) then raise exception 'MAHJONG_ADAPTER_RESULT'; end if;
    answer:=mahjong_clash.post_hand_economy(product_id,hand_no,request->>'operation_key',request->'product_commit'->'result',request->'product_commit'->>'end_reason');
    select coalesce(jsonb_agg(jsonb_build_object('account_ref',ai_account_id,'reserve',case when (request->>'final')::boolean then 0 else (answer->'balances'->>seat_index)::bigint end) order by seat_index),'[]')
      into expected_holds from mahjong_clash.match_players where match_id=product_id and participant_kind='ai';
    if (select jsonb_agg(jsonb_build_object('account_ref',item->>'account_ref','reserve',(item->>'reserve')::numeric) order by n)
      from jsonb_array_elements(p_payload->'next_product_participants') with ordinality t(item,n)) is distinct from nullif(expected_holds,'[]') then raise exception 'MAHJONG_ADAPTER_HOLDS'; end if;
    insert into mahjong_clash.accounting_commits values(product_id,hand_no,(p_payload->>'settlement_id')::uuid,p_payload->>'request_hash');
    update mahjong_clash.hands set status='settled' where match_id=product_id and hand_serial=hand_no;
    update mahjong_clash.platform_matches set settlement_count=hand_no,status=case when (request->>'final')::boolean then 'settled' else 'open' end where match_id=product_id;
    for p in select * from mahjong_clash.match_players where match_id=product_id and participant_kind='human' loop
      delta:=(answer->'deltas'->>p.seat_index)::bigint;
      insert into mahjong_clash.player_profiles values(p.player_account_id,1,case when (request->>'final')::boolean then 1 else 0 end,
        case when (h.result->>'winnerIndex')::integer=p.seat_index then 1 else 0 end,
        case when (h.result->>'winnerIndex')::integer=p.seat_index and (h.result->>'selfDraw')::boolean then 1 else 0 end,
        case when h.result->>'type'='win' and not (h.result->>'selfDraw')::boolean and (h.result->>'from')::integer=p.seat_index then 1 else 0 end,
        case when h.result->>'type'='draw' then 1 else 0 end,delta,clock_timestamp())
      on conflict(player_account_id) do update set hands=player_profiles.hands+excluded.hands,matches=player_profiles.matches+excluded.matches,
        wins=player_profiles.wins+excluded.wins,self_draws=player_profiles.self_draws+excluded.self_draws,deal_ins=player_profiles.deal_ins+excluded.deal_ins,
        draws=player_profiles.draws+excluded.draws,net_points=player_profiles.net_points+excluded.net_points,last_settled_at=excluded.last_settled_at;
    end loop;
    if not (request->>'final')::boolean then return jsonb_build_object('committed',true); end if;
    update mahjong_clash.matches set status='finished',finished_at=clock_timestamp() where matches.id=product_id;
    perform mahjong_clash.release_match_ai(product_id);
  else
    hand_no:=binding.settlement_count+1;
    select * into strict h from mahjong_clash.hands where match_id=product_id and hand_serial=hand_no;
    if h.result->>'type' is distinct from 'void' or h.result->>'endReason' is distinct from 'unrecoverable-hand' then raise exception 'MAHJONG_VOID_REQUIRED'; end if;
    perform mahjong_clash.post_hand_economy(product_id,hand_no,product_id::text||':void:'||hand_no,'{"type":"void","payments":[]}', 'unrecoverable-hand');
    update mahjong_clash.hands set status='voided' where match_id=product_id and hand_serial=hand_no;
    update mahjong_clash.matches set status='voided',finished_at=clock_timestamp() where matches.id=product_id;
    update mahjong_clash.platform_matches set status='cancelled' where match_id=product_id;
    perform mahjong_clash.release_match_ai(product_id);
    insert into mahjong_clash.player_profiles(player_account_id,matches,last_settled_at)
      select player_account_id,1,clock_timestamp() from mahjong_clash.match_players where match_id=product_id and participant_kind='human'
      on conflict(player_account_id) do update set matches=player_profiles.matches+1,last_settled_at=excluded.last_settled_at;
  end if;
  update mahjong_clash.match_players set occupied=false where match_id=product_id;
  return jsonb_build_object('committed',true);
end;
$$;
alter function mahjong_clash.platform_accounting(text,uuid,jsonb) owner to mahjong_clash_accounting_owner;
alter function mahjong_clash.check_economy_ledger() security definer;
alter function mahjong_clash.check_economy_ledger() owner to mahjong_clash_accounting_owner;
grant select,insert,update on mahjong_clash.ai_accounts,mahjong_clash.economy_state,mahjong_clash.matches,mahjong_clash.match_players,
  mahjong_clash.hands,mahjong_clash.ai_reservations,mahjong_clash.platform_matches,mahjong_clash.player_profiles to mahjong_clash_accounting_owner;
grant select,insert on mahjong_clash.economy_operations,mahjong_clash.economy_entries,mahjong_clash.economy_transfers,mahjong_clash.accounting_commits to mahjong_clash_accounting_owner;
grant select on mahjong_clash.economy_versions,mahjong_clash.hand_economy,mahjong_clash.accounting_requests to mahjong_clash_accounting_owner;
grant execute on function mahjong_clash.hash_json(jsonb),mahjong_clash.opening_request(uuid),mahjong_clash.reserve_match_ai(uuid),
  mahjong_clash.post_hand_economy(uuid,integer,text,jsonb,text),mahjong_clash.calculate_hand_economy(jsonb,jsonb,jsonb,text),
  mahjong_clash.next_ai_strength(bigint,text,text),mahjong_clash.entry_minimum(text),mahjong_clash.release_match_ai(uuid) to mahjong_clash_accounting_owner;
revoke all on mahjong_clash.platform_matches,mahjong_clash.accounting_requests,mahjong_clash.accounting_commits,mahjong_clash.player_profiles from public,anon,authenticated,service_role,mahjong_clash_server;
revoke execute on function mahjong_clash.platform_accounting(text,uuid,jsonb),mahjong_clash.opening_request(uuid),mahjong_clash.prepare_hand_posting(uuid,integer) from public,anon,authenticated,service_role,mahjong_clash_server;

grant execute on function mahjong_clash.platform_accounting(text,uuid,jsonb) to current_user;
revoke create on schema mahjong_clash from mahjong_clash_accounting_owner;
grant mahjong_clash_accounting_owner to current_user with inherit false;
grant mahjong_clash_accounting_owner to current_user with set false;

commit;
