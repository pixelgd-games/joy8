begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $$
declare
  game constant uuid := '6dc12d01-5760-4123-832f-6d0bd305404a';
  keys integer;
begin
  update public.joy8_game_policies set reserve_increase_enabled = true
    where game_id = game and enabled and funding_mode = 'platform' and reservation_mode = 'capped'
      and product_adapter is null and min_bet_amount = 10 and max_bet_amount = 10000
      and max_payout_amount = 210000 and max_participants = 1 and not reserve_increase_enabled;
  if not found then raise exception 'BACCARAT_RESERVE_POLICY_CHANGED'; end if;
  update public.joy8_backend_keys set scopes = scopes || array['reserve']::text[]
    where game_id = game and revoked_at is null
      and scopes @> array['exchange','renew','open','settle','status','cancel']::text[]
      and not 'reserve' = any(scopes);
  get diagnostics keys = row_count;
  if keys <> 1 or (select count(*) from public.joy8_backend_keys where game_id = game and revoked_at is null) <> 1 then
    raise exception 'BACCARAT_RESERVE_KEY_CHANGED';
  end if;
end;
$$;

commit;
