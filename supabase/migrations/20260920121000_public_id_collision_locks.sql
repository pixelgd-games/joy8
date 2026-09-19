begin;

create or replace function public.joy8_allocate_public_player_id()
returns text language plpgsql volatile security definer set search_path='' as $$
declare v_public_id text; v_attempt integer;
begin
  for v_attempt in 1..128 loop
    v_public_id := (pg_catalog.floor(pg_catalog.random() * 900000) + 100000)::integer::text;
    if exists(select 1 from public.player_accounts p where p.public_id=v_public_id) then
      continue;
    end if;
    begin
      if pg_catalog.pg_try_advisory_xact_lock(75080002,v_public_id::integer) then
        if exists(select 1 from public.player_accounts p where p.public_id=v_public_id) then
          raise exception using errcode='J8001';
        end if;
        return v_public_id;
      end if;
    exception when sqlstate 'J8001' then
      null;
    end;
  end loop;
  raise exception 'JOY8_PUBLIC_PLAYER_ID_ALLOCATION_FAILED' using errcode='54000';
end;
$$;

revoke all on function public.joy8_allocate_public_player_id() from public,anon,authenticated;
grant execute on function public.joy8_allocate_public_player_id() to service_role;

commit;
