begin;

alter table public.player_accounts
  add column public_id text;

create function public.joy8_allocate_public_player_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_public_id text;
  v_attempt integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(75080001);

  if (select count(*) from public.player_accounts) >= 900000 then
    raise exception 'JOY8_PUBLIC_PLAYER_ID_EXHAUSTED' using errcode = '54000';
  end if;

  for v_attempt in 1..128 loop
    v_public_id := (pg_catalog.floor(pg_catalog.random() * 900000) + 100000)::integer::text;
    if not exists (
      select 1 from public.player_accounts p where p.public_id = v_public_id
    ) then
      return v_public_id;
    end if;
  end loop;

  raise exception 'JOY8_PUBLIC_PLAYER_ID_ALLOCATION_FAILED' using errcode = '54000';
end;
$$;

do $$
declare
  v_player_id uuid;
begin
  for v_player_id in
    select p.id from public.player_accounts p where p.public_id is null order by p.id
  loop
    update public.player_accounts p
    set public_id = public.joy8_allocate_public_player_id()
    where p.id = v_player_id;
  end loop;
end;
$$;

alter table public.player_accounts
  alter column public_id set default public.joy8_allocate_public_player_id(),
  alter column public_id set not null,
  add constraint player_accounts_public_id_format check (public_id ~ '^[1-9][0-9]{5}$'),
  add constraint player_accounts_public_id_key unique (public_id);

create function public.joy8_resolve_member_profile(
  p_auth_user_id uuid,
  p_enroll boolean default false
)
returns table (player_account_id uuid, account_type text, public_id text)
language sql
security definer
set search_path = ''
as $$
  select m.player_account_id, m.account_type, p.public_id
  from public.joy8_resolve_member(p_auth_user_id, p_enroll) m
  join public.player_accounts p on p.id = m.player_account_id;
$$;

revoke all on function public.joy8_allocate_public_player_id() from public, anon, authenticated;
grant execute on function public.joy8_allocate_public_player_id() to service_role;
revoke all on function public.joy8_resolve_member_profile(uuid, boolean) from public, anon, authenticated;
grant execute on function public.joy8_resolve_member_profile(uuid, boolean) to service_role;

commit;
