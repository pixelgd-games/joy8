begin;

do $joy8$
declare v_rows integer;
begin
  if not exists (
    select 1 from public.games
    where id='9f0df218-a0fd-40bc-a018-151fd7a1d996'::uuid
      and slug='monster-lab' and not published and launch_url is null
  ) then
    raise exception 'JOY8_MONSTER_LAB_CATALOG_NOT_PRIVATE' using errcode='55000';
  end if;

  update public.joy8_private_entries
  set enabled=true
  where game_id='9f0df218-a0fd-40bc-a018-151fd7a1d996'::uuid
    and entry_origin='https://joy8.cc'
    and launch_url='https://monster-lab-7aj.pages.dev/client/'
    and not enabled;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'JOY8_MONSTER_LAB_ENTRY_NOT_READY' using errcode='55000';
  end if;
end
$joy8$;

commit;
