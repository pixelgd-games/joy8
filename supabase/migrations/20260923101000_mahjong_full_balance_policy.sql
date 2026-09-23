begin;

do $$
declare v_game uuid;
begin
  select g.id into v_game
  from public.games g
  join public.joy8_game_policies p on p.game_id=g.id
  join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
  where g.slug='mahjong-clash' and not g.published and g.launch_url is null
    and p.enabled and p.reservation_mode='capped' and p.max_reserve_amount is null
    and p.max_bet_amount=1 and p.max_payout_amount=1
    and p.max_participants=4 and p.funding_mode='participants'
    and p.product_adapter='mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure
    and w.enabled and w.currency='POINT' and w.initial_credit=0;

  if v_game is null
    or exists(select 1 from public.joy8_matches where game_id=v_game and state='open')
    or exists(select 1 from public.joy8_backend_keys
      where game_id=v_game and revoked_at is null and expires_at>now()
        and scopes && array['open','settle','status','cancel']::text[]) then
    raise exception 'MAHJONG_FULL_BALANCE_POLICY_REQUIRES_IDENTITY_ONLY_STATE';
  end if;

  update public.joy8_game_policies
  set reservation_mode='full_balance',max_reserve_amount=1
  where game_id=v_game;
end;
$$;

commit;
