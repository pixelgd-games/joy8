begin;

lock table public.player_accounts in share row exclusive mode;

create or replace function public.joy8_allocate_public_player_id()
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
  for v_attempt in 1..128 loop
    v_public_id := (pg_catalog.floor(pg_catalog.random() * 900000) + 100000)::integer::text;
    if not exists (
      select 1 from public.player_accounts p where p.public_id = v_public_id
    ) and pg_catalog.pg_try_advisory_xact_lock(75080002, v_public_id::integer) then
      if not exists (
        select 1 from public.player_accounts p where p.public_id = v_public_id
      ) then
        return v_public_id;
      end if;
    end if;
  end loop;

  raise exception 'JOY8_PUBLIC_PLAYER_ID_ALLOCATION_FAILED' using errcode = '54000';
end;
$$;

revoke all on function public.joy8_allocate_public_player_id() from public, anon, authenticated;
grant execute on function public.joy8_allocate_public_player_id() to service_role;

create or replace function public.joy8_resolve_member_profile(
  p_auth_user_id uuid,
  p_enroll boolean default false
)
returns table (player_account_id uuid, account_type text, public_id text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member record;
begin
  select m.player_account_id,m.account_type into v_member
  from public.joy8_resolve_member(p_auth_user_id,p_enroll) m;
  if not found then return; end if;
  return query select v_member.player_account_id,v_member.account_type,p.public_id
  from public.player_accounts p where p.id=v_member.player_account_id;
end;
$$;

revoke all on function public.joy8_resolve_member_profile(uuid,boolean) from public,anon,authenticated;
grant execute on function public.joy8_resolve_member_profile(uuid,boolean) to service_role;

commit;
