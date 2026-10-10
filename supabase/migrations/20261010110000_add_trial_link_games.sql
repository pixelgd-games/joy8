begin;
set local lock_timeout='5s';
do $$
begin
  if exists(select 1 from public.games where slug in ('specimen-07','fishing-ace')) then
    raise exception 'JOY8_TRIAL_GAMES_EXIST';
  end if;
  insert into public.games(name,slug,type,published,launch_url,thumbnail,launch_mode,sort_order) values
    ('七號樣本','specimen-07','arcade',true,'https://specimen-07.pages.dev/','/games/specimen-07/cover.webp','trial',100),
    ('釣魚大亨','fishing-ace','fish',true,'https://genesis-style-injuries-synthesis.trycloudflare.com/','/games/fishing-ace/cover.webp','trial',100);
end;
$$;
commit;
