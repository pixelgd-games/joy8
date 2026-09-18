begin;

do $$
declare v_game uuid; v_wallet uuid;
begin
  select g.id,w.id into v_game,v_wallet from public.games g
    join public.looty_wallet_policies w on w.game_id=g.id
    join mahjong_clash.lifecycle_config c on c.game_id=g.id
    where g.slug='mahjong-clash' and not g.published and g.launch_url is null
      and not w.enabled and w.initial_credit=0;
  if v_game is null or exists(select 1 from public.looty_game_policies where game_id=v_game)
    or exists(select 1 from public.looty_backend_keys where game_id=v_game)
    or exists(select 1 from mahjong_clash.matches)
    or exists(select 1 from mahjong_clash.ai_accounts) then
    raise exception 'MAHJONG_IDENTITY_ACTIVATION_REQUIRES_INACTIVE_PRODUCT';
  end if;
  insert into public.looty_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount,max_participants,product_adapter)
    values(v_game,v_wallet,true,1,4,'mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure);
  update public.looty_wallet_policies set enabled=true where id=v_wallet;
  insert into public.looty_private_entries(game_id,entry_origin,launch_url,enabled)
    values(v_game,'http://localhost:5173','http://localhost:4391/',true);
end;
$$;

commit;
