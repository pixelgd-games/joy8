begin isolation level read committed;
set local lock_timeout='5s';
create or replace function mahjong_clash.opening_request(p_match uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare m mahjong_clash.matches%rowtype; humans jsonb; bots jsonb;
begin
  select * into strict m from mahjong_clash.matches where id=p_match;
  select coalesce(jsonb_agg(jsonb_build_object('session_id',game_session_id,'reserve',least(starting_points,
      case m.stake_id when 'low' then 650 when 'medium' then 3300 when 'high' then 10000 end)::text||'.00') order by seat_index),'[]')
    into humans from mahjong_clash.match_players where match_id=p_match and participant_kind='human';
  select coalesce(jsonb_agg(jsonb_build_object('account_ref',ai_account_id,'reserve',starting_points::text||'.00') order by seat_index),'[]')
    into bots from mahjong_clash.match_players where match_id=p_match and participant_kind='ai';
  return jsonb_build_object('version',1,'match_ref',p_match,'rule_version',m.rule_version,'participants',humans,'product_participants',bots);
end;
$$;

create or replace function mahjong_clash.prepare_hand_posting(p_match uuid,p_hand integer) returns jsonb
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
    if p.participant_kind='human' and -delta>(case m.stake_id when 'low' then 650 when 'medium' then 3300 when 'high' then 10000 end)
      then raise exception 'MAHJONG_HAND_LOSS_LIMIT'; end if;
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

revoke execute on function mahjong_clash.guard_posted_hand() from public;
select public.joy8_validate_product_adapters();
commit;
