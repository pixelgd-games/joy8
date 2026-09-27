begin;
set local lock_timeout='5s';
do $$
declare affected integer;
begin
  update public.games set thumbnail='/games/mahjong-clash/cover.webp'
    where id='faaa45eb-7d7d-40b5-9081-3dd73482adfa' and slug='mahjong-clash' and published
      and launch_url='https://mahjong-clash.pages.dev/' and coalesce(thumbnail,'')='';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'JOY8_MAHJONG_CATALOG_CHANGED'; end if;
end;
$$;
commit;
