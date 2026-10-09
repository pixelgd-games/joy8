begin;
set local lock_timeout='5s';
do $$
declare
  affected integer;
begin
  update public.joy8_private_entries set enabled=false
    where game_id='6dc12d01-5760-4123-832f-6d0bd305404a' and enabled
      and entry_origin='https://joy8.cc' and launch_url='https://baccarat-87d.pages.dev/';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'BACCARAT_PRIVATE_ENTRY_CHANGED'; end if;
end;
$$;
commit;
