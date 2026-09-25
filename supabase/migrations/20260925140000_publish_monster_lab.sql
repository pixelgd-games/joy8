begin;

do $$
declare
  v_game_id constant uuid := '9f0df218-a0fd-40bc-a018-151fd7a1d996';
begin
  if not exists (
    select 1 from public.games
    where id=v_game_id and slug='monster-lab' and not published
  ) then
    raise exception 'JOY8_MONSTER_LAB_PUBLISH_STATE_MISMATCH';
  end if;

  if not exists (
    select 1 from public.joy8_game_policies gp
    join public.joy8_wallet_policies wp on wp.id=gp.wallet_policy_id
    where gp.game_id=v_game_id and gp.enabled and wp.enabled and wp.currency='POINT'
  ) then
    raise exception 'JOY8_MONSTER_LAB_POLICY_NOT_READY';
  end if;

  if not exists (
    select 1 from public.joy8_backend_keys
    where game_id=v_game_id and revoked_at is null
  ) then
    raise exception 'JOY8_MONSTER_LAB_BACKEND_KEY_MISSING';
  end if;
end;
$$;

update public.games
set published=true,
    launch_url='https://monster-lab-7aj.pages.dev/client/'
where id='9f0df218-a0fd-40bc-a018-151fd7a1d996'::uuid;

update public.joy8_private_entries
set enabled=false
where game_id='9f0df218-a0fd-40bc-a018-151fd7a1d996'::uuid;

commit;
