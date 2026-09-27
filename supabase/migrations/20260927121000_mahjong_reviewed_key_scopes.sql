begin;
set local lock_timeout='5s';
do $$
declare affected integer;
begin
  perform 1 from public.joy8_game_policies p join public.games g on g.id=p.game_id
    where g.id='faaa45eb-7d7d-40b5-9081-3dd73482adfa' and g.slug='mahjong-clash'
      and p.enabled and p.reservation_mode='full_balance' and p.max_reserve_amount is null
      and p.funding_mode='participants' and p.max_payout_amount=100000000
      and p.product_adapter='mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure
    for share of p,g;
  if not found then raise exception 'JOY8_MAHJONG_FUNDED_POLICY_REVIEW_REQUIRED'; end if;
  if (select count(*) from public.joy8_backend_keys
    where game_id='faaa45eb-7d7d-40b5-9081-3dd73482adfa' and revoked_at is null)<>1 then
    raise exception 'JOY8_MAHJONG_KEY_SET_CHANGED';
  end if;
  update public.joy8_backend_keys set scopes=array['exchange','renew','open','settle','status','cancel']::text[]
    where id='a2eeea4b-026b-4e32-bfd8-1d75223ad92b' and game_id='faaa45eb-7d7d-40b5-9081-3dd73482adfa'
      and revoked_at is null and scopes=array['exchange','renew']::text[];
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'JOY8_MAHJONG_KEY_CHANGED'; end if;
end;
$$;
select public.joy8_validate_product_adapters();
commit;
