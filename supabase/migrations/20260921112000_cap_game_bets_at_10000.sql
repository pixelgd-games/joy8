begin;

lock table public.joy8_game_policies, public.joy8_matches in access exclusive mode;

do $$
begin
  if exists(select 1 from public.joy8_game_policies where max_bet_amount>10000)
    or exists(select 1 from public.joy8_matches where max_bet_amount>10000) then
    raise exception 'JOY8_BET_CAP_CONFLICT' using errcode='23514';
  end if;
end;
$$;

alter table public.joy8_game_policies
  add constraint joy8_game_policies_max_bet_cap_check
  check(max_bet_amount<=10000);

alter table public.joy8_matches
  add constraint joy8_matches_max_bet_cap_check
  check(max_bet_amount<=10000);

commit;
