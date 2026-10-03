begin;

do $$
declare
  game constant uuid := '6dc12d01-5760-4123-832f-6d0bd305404a';
  wallet uuid;
begin
  if exists(select 1 from public.games where id=game or slug='baccarat') then
    raise exception 'BACCARAT_ALREADY_REGISTERED';
  end if;
  select id into strict wallet from public.joy8_wallet_policies where currency='POINT' and enabled;
  insert into public.games(id,name,slug,type,published,launch_url,thumbnail)
    values(game,'電子百家樂','baccarat','card',false,'https://baccarat-87d.pages.dev/','/games/baccarat/cover.webp');
  insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,min_bet_amount,max_bet_amount,
    max_payout_amount,max_participants,funding_mode,reservation_mode,product_adapter)
    values(game,wallet,true,10,10000,210000,1,'platform','capped',null);
  insert into public.joy8_private_entries(game_id,entry_origin,launch_url,enabled)
    values(game,'https://joy8.cc','https://baccarat-87d.pages.dev/',true);
end;
$$;

select public.joy8_validate_product_adapters();
commit;
