begin;

do $$
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('mahjong_clash.runtime_balance(uuid)') and prorettype='numeric'::regtype)
    then raise exception 'MAHJONG_RUNTIME_BALANCE_VERSION_MISMATCH'; end if;
end;
$$;

drop function mahjong_clash.runtime_balance(uuid);

create or replace function mahjong_clash.runtime_balance(p_player uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('balance',(w.balance-w.locked_balance)::text,
      'total_balance',w.balance::text,'locked_balance',w.locked_balance::text,
      'match_id',case when r.match_id is not null then seat.match_id end,
      'reserved_balance',coalesce(r.reserved_amount,0)::text)
    from mahjong_clash.integration_players b
    join public.wallet_accounts w on w.id=b.wallet_id and w.player_account_id=b.player_id
    join public.joy8_wallet_policies p on p.id=w.wallet_policy_id
    join mahjong_clash.lifecycle_config c on c.game_id=p.game_id and c.singleton
    left join mahjong_clash.match_players seat on seat.player_account_id=b.player_id
      and seat.wallet_account_id=w.id and seat.occupied
    left join mahjong_clash.platform_matches m on m.match_id=seat.match_id and m.status='open'
    left join public.joy8_match_participants r on r.match_id=m.platform_match_id
      and r.player_account_id=b.player_id and r.wallet_account_id=w.id and r.released_at is null
    where b.player_id=p_player and w.currency='POINT' and w.status='active';
$$;

create or replace function mahjong_clash.runtime_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',2,'game_id',c.game_id,'environment',e.environment,
    'continuous',exists(select 1 from information_schema.columns where table_schema='public' and table_name='joy8_matches' and column_name='settlement_count'),
    'wallet_enabled',w.enabled,'initial_credit',w.initial_credit,
    'game_enabled',p.enabled,'adapter',p.product_adapter::text,
    'pending',exists(select 1 from mahjong_clash.integration_pending))
  from mahjong_clash.lifecycle_config c cross join mahjong_clash.economy_state e
    join public.joy8_game_policies p on true
    join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
  where c.singleton and e.singleton and p.game_id=c.game_id and w.game_id=c.game_id;
$$;

create function mahjong_clash.lock_runtime_economy() returns text
language sql security definer set search_path='' as $$
  select version from mahjong_clash.economy_state where singleton for update;
$$;

revoke all on function mahjong_clash.runtime_balance(uuid),mahjong_clash.lock_runtime_economy() from public,anon,authenticated,service_role;
grant execute on function mahjong_clash.runtime_balance(uuid),mahjong_clash.lock_runtime_economy() to mahjong_clash_server;
select public.joy8_validate_product_adapters();

commit;
