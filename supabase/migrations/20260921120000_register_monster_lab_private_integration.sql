begin;

do $$
declare
  v_game_id constant uuid := '9f0df218-a0fd-40bc-a018-151fd7a1d996';
  v_wallet_policy_id uuid;
begin
  if exists (
    select 1 from public.games
    where id=v_game_id or slug='monster-lab'
  ) then
    raise exception 'JOY8_MONSTER_LAB_ALREADY_REGISTERED';
  end if;

  select id into v_wallet_policy_id
  from public.joy8_wallet_policies
  where currency='POINT' and enabled and initial_credit=0;

  if not found then
    raise exception 'JOY8_SHARED_POINT_POLICY_NOT_READY';
  end if;

  insert into public.games(
    id,name,slug,type,supports_live,published,launch_url
  ) values (
    v_game_id,'Monster Lab','monster-lab','slot',false,false,null
  );

  insert into public.joy8_game_policies(
    game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,
    max_participants,funding_mode,product_adapter
  ) values (
    v_game_id,v_wallet_policy_id,true,10000,1000000,1,'platform',null
  );

  insert into public.joy8_private_entries(
    game_id,entry_origin,launch_url,enabled
  ) values (
    v_game_id,'https://joy8.cc','https://monster-lab-7aj.pages.dev/client/',true
  );
end;
$$;

commit;
