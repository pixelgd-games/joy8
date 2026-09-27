begin;
set local lock_timeout='5s';

do $$
declare
  v_game_id constant uuid := 'faaa45eb-7d7d-40b5-9081-3dd73482adfa';
  affected integer;
begin
  perform 1 from public.joy8_game_policies p
    join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
    where p.game_id=v_game_id and p.enabled and w.enabled and w.currency='POINT'
      and p.reservation_mode='full_balance' and p.funding_mode='participants'
      and p.max_reserve_amount is null and p.max_payout_amount=100000000
      and p.product_adapter='mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure
    for share of p,w;
  if not found then raise exception 'JOY8_MAHJONG_RELEASE_POLICY_CHANGED'; end if;
  perform 1 from public.joy8_backend_keys
    where id='a2eeea4b-026b-4e32-bfd8-1d75223ad92b' and game_id=v_game_id
      and revoked_at is null
      and scopes=array['exchange','renew','open','settle','status','cancel']::text[]
    for share;
  if not found then raise exception 'JOY8_MAHJONG_RELEASE_KEY_CHANGED'; end if;
  update public.joy8_private_entries set enabled=false
    where game_id=v_game_id and not enabled
      and entry_origin='http://localhost:5173' and launch_url='http://localhost:4391/';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'JOY8_MAHJONG_PRIVATE_ENTRY_CHANGED'; end if;
  update public.games set published=true,launch_url='https://mahjong-clash.pages.dev/'
    where id=v_game_id and slug='mahjong-clash' and not published and launch_url is null;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'JOY8_MAHJONG_CATALOG_CHANGED'; end if;
end;
$$;
select public.joy8_validate_product_adapters();
commit;
