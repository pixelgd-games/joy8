begin;
set local lock_timeout='5s';
do $$
declare
  game constant uuid := '6dc12d01-5760-4123-832f-6d0bd305404a';
  affected integer;
begin
  perform 1 from public.joy8_game_policies p
    join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
    where p.game_id=game and p.enabled and w.enabled and w.currency='POINT'
      and p.funding_mode='platform' and p.reservation_mode='capped'
      and p.min_bet_amount=10 and p.max_bet_amount=10000
      and p.max_payout_amount=210000 and p.max_participants=1 and p.product_adapter is null
    for share of p,w;
  if not found then raise exception 'BACCARAT_RELEASE_POLICY_CHANGED'; end if;
  perform 1 from public.joy8_backend_keys where game_id=game
    and id='ac78abac-171d-4d62-b725-bd0cf160f35b' and revoked_at is null
    and scopes=array['exchange','renew','open','settle','status','cancel']::text[] for share;
  if not found then raise exception 'BACCARAT_RELEASE_KEY_CHANGED'; end if;
  update public.games set published=true where id=game and slug='baccarat' and not published
    and launch_url='https://baccarat-87d.pages.dev/' and thumbnail='/games/baccarat/cover.webp';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'BACCARAT_RELEASE_CATALOG_CHANGED'; end if;
end;
$$;
select public.joy8_validate_product_adapters();
commit;
