begin;

create or replace function mahjong_clash.resolve_joy8_session(p_session uuid,p_player uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare binding record; seat record;
begin
  select s.id session_id,s.game_id,s.player_account_id,s.wallet_account_id into binding
    from public.game_sessions s
    join mahjong_clash.lifecycle_config c on c.singleton and c.game_id=s.game_id
    join public.wallet_accounts w on w.id=s.wallet_account_id and w.player_account_id=s.player_account_id
    join public.joy8_game_policies g on g.game_id=c.game_id and g.wallet_policy_id=w.wallet_policy_id and g.enabled
    join public.joy8_wallet_policies p on p.id=w.wallet_policy_id and p.enabled
    where s.id=p_session and s.player_account_id=p_player and s.currency='POINT' and w.currency='POINT'
      and s.status='active' and s.expires_at>clock_timestamp() and s.launch_code_used_at is not null
      and s.gateway_token_hash is not null and s.gateway_token_scopes=array['balance']::text[] and w.status='active';
  if not found then raise exception 'MAHJONG_SESSION_BINDING_INVALID'; end if;
  perform public.joy8_assert_player(p_player);
  select match_id,seat_index,wallet_account_id into seat from mahjong_clash.match_players
    where player_account_id=p_player and occupied;
  if found and seat.wallet_account_id<>binding.wallet_account_id then
    raise exception 'MAHJONG_SESSION_BINDING_INVALID';
  end if;
  return jsonb_build_object('session_id',binding.session_id,'player_id',binding.player_account_id,
    'game_id',binding.game_id,'wallet_id',binding.wallet_account_id,
    'active_seat',case when seat.match_id is null then null else jsonb_build_object(
      'match_id',seat.match_id,'seat_index',seat.seat_index) end);
end;
$$;

create or replace function mahjong_clash.runtime_balance(p_player uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('balance',(w.balance-w.locked_balance)::text,
      'total_balance',w.balance::text,'locked_balance',w.locked_balance::text,
      'match_id',case when r.match_id is not null then seat.match_id end,
      'reserved_balance',coalesce(r.reserved_amount,0)::text)
    from mahjong_clash.integration_players b
    join public.wallet_accounts w on w.id=b.wallet_id and w.player_account_id=b.player_id
    join mahjong_clash.lifecycle_config c on c.singleton
    join public.joy8_game_policies g on g.game_id=c.game_id and g.wallet_policy_id=w.wallet_policy_id and g.enabled
    join public.joy8_wallet_policies p on p.id=w.wallet_policy_id and p.enabled
    left join mahjong_clash.match_players seat on seat.player_account_id=b.player_id
      and seat.wallet_account_id=w.id and seat.occupied
    left join mahjong_clash.platform_matches m on m.match_id=seat.match_id and m.status='open'
    left join public.joy8_match_participants r on r.match_id=m.platform_match_id
      and r.player_account_id=b.player_id and r.wallet_account_id=w.id and r.released_at is null
    where b.player_id=p_player and w.currency='POINT' and w.status='active';
$$;

create or replace function mahjong_clash.runtime_readiness()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',2,'game_id',c.game_id,'environment',e.environment,
    'continuous',exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='joy8_matches' and column_name='settlement_count'),
    'wallet_enabled',w.enabled,'initial_credit',w.initial_credit,
    'game_enabled',p.enabled,'adapter',p.product_adapter::text,
    'pending',exists(select 1 from mahjong_clash.integration_pending))
  from mahjong_clash.lifecycle_config c cross join mahjong_clash.economy_state e
    join public.joy8_game_policies p on true
    join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
  where c.singleton and e.singleton and p.game_id=c.game_id;
$$;

select public.joy8_validate_product_adapters();

commit;
