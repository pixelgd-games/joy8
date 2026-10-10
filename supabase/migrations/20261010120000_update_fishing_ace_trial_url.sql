begin;
set local lock_timeout='5s';
do $$
declare
  affected integer;
begin
  update public.games set launch_url='https://scheduled-lung-centers-dicke.trycloudflare.com/'
    where slug='fishing-ace' and launch_mode='trial'
      and launch_url='https://genesis-style-injuries-synthesis.trycloudflare.com/';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'JOY8_FISHING_ACE_URL_CHANGED'; end if;
end;
$$;
commit;
