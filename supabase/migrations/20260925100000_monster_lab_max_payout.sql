begin;

do $$
declare v_count integer;
begin
  update public.joy8_game_policies p set max_payout_amount=5000000
  from public.games g
  where g.id=p.game_id and g.slug='monster-lab'
    and p.funding_mode='platform' and p.max_bet_amount=10000 and p.max_payout_amount=1000000;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    raise exception 'JOY8_MONSTER_LAB_POLICY_NOT_READY' using errcode='55000';
  end if;
end;
$$;

commit;
