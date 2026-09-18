begin;

do $$
declare game uuid; wallet uuid;
begin
  if exists(select 1 from public.games where slug='mahjong-clash')
    or exists(select 1 from mahjong_clash.lifecycle_config)
    or exists(select 1 from mahjong_clash.economy_state)
    or exists(select 1 from mahjong_clash.matches)
    or exists(select 1 from mahjong_clash.ai_accounts)
    or exists(select 1 from pg_roles where rolname='mahjong_clash_runtime') then
    raise exception 'MAHJONG_REGISTRATION_REQUIRES_UNCONFIGURED_PRODUCT';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='looty_matches' and column_name='settlement_count') then
    raise exception 'MAHJONG_CONTINUOUS_REQUIRED';
  end if;
  insert into public.games(name,slug,type,supports_live,published,launch_url)
    values('Mahjong Clash','mahjong-clash','card',false,false,null) returning id into game;
  insert into public.looty_wallet_policies(game_id,initial_credit,enabled)
    values(game,0,false) returning id into wallet;
  insert into mahjong_clash.lifecycle_config values(true,game,'rules-1');
  insert into mahjong_clash.economy_state(singleton,environment,version)
    values(true,'operational','economy-1');
  create role mahjong_clash_runtime nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
  grant mahjong_clash_server to mahjong_clash_runtime;
end;
$$;

commit;
