begin;

do $$
declare
  target_count integer;
  deleted_count integer;
begin
  select count(*)
  into target_count
  from public.games
  where slug in ('monster-lab', 'lord-of-gomoku');

  if target_count <> 2 then
    raise exception 'JOY8_RETIRED_CATALOG_TARGET_MISMATCH';
  end if;

  if exists (
    select 1 from public.game_sessions where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_backend_keys where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_fee_accounts where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_game_policies where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_matches where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_private_entries where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_settlements where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.joy8_wallet_policies where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from public.wallet_transactions where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from mahjong_clash.lifecycle_config where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
    union all
    select 1 from mahjong_clash.matches where game_id in (
      select id from public.games where slug in ('monster-lab', 'lord-of-gomoku')
    )
  ) then
    raise exception 'JOY8_RETIRED_CATALOG_GAME_HAS_DEPENDENCIES';
  end if;

  delete from public.games
  where slug in ('monster-lab', 'lord-of-gomoku');

  get diagnostics deleted_count = row_count;
  if deleted_count <> 2 then
    raise exception 'JOY8_RETIRED_CATALOG_DELETE_MISMATCH';
  end if;
end;
$$;

commit;
