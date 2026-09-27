begin;
set local lock_timeout='5s';
do $$
declare affected integer;
begin
  update public.joy8_game_policies p set max_reserve_amount=null
  from public.games g where g.id=p.game_id and g.id='faaa45eb-7d7d-40b5-9081-3dd73482adfa'
    and g.slug='mahjong-clash' and not g.published and p.enabled
    and p.reservation_mode='full_balance' and p.funding_mode='participants'
    and p.max_reserve_amount=1
    and p.product_adapter='mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'JOY8_MAHJONG_POLICY_CHANGED'; end if;
end;
$$;
select public.joy8_validate_product_adapters();
commit;
