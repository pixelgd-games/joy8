begin;

do $$
declare
  target_slugs constant text[] := array[
    'arrgh-hoops',
    'color-guess',
    'dead-county',
    'ninja-four-elements',
    'ocean-battle',
    'speed-rush',
    'valkyrie-dragons-hoard'
  ];
  target_count integer;
  deleted_count integer;
begin
  select count(*)
  into target_count
  from public.games
  where slug = any(target_slugs);

  if target_count <> cardinality(target_slugs) then
    raise exception 'JOY8_INCOMPATIBLE_CATALOG_TARGET_MISMATCH';
  end if;

  if exists (
    select 1 from public.game_sessions where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.joy8_backend_keys where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.joy8_fee_accounts where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.joy8_game_policies where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.joy8_matches where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.joy8_private_entries where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.joy8_settlements where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from public.wallet_transactions where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from mahjong_clash.lifecycle_config where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
    union all
    select 1 from mahjong_clash.matches where game_id in (
      select id from public.games where slug = any(target_slugs)
    )
  ) then
    raise exception 'JOY8_INCOMPATIBLE_CATALOG_GAME_HAS_DEPENDENCIES';
  end if;

  delete from public.games
  where slug = any(target_slugs);

  get diagnostics deleted_count = row_count;

  if deleted_count <> cardinality(target_slugs) then
    raise exception 'JOY8_INCOMPATIBLE_CATALOG_DELETE_MISMATCH';
  end if;
end;
$$;

commit;
