begin;

alter table public.player_accounts
  add column member_enrolled_at timestamptz;

create or replace function public.looty_resolve_member(
  p_auth_user_id uuid,
  p_enroll boolean default false
)
returns table (player_account_id uuid, account_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth auth.users%rowtype;
  v_player public.player_accounts%rowtype;
  v_type text;
begin
  if p_auth_user_id is null then
    raise exception 'verified member identity is required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text, 0));

  select u.* into v_auth from auth.users u where u.id = p_auth_user_id for share;
  if not found or v_auth.deleted_at is not null or v_auth.banned_until > now() then
    raise exception 'verified member identity is required' using errcode = '42501';
  end if;
  if v_auth.is_anonymous is true then
    v_type := 'guest';
  elsif v_auth.is_anonymous is false and v_auth.email_confirmed_at is not null then
    v_type := 'registered';
  else
    raise exception 'verified member identity is required' using errcode = '42501';
  end if;

  select p.* into v_player from public.player_accounts p
  where p.auth_user_id = p_auth_user_id for update;
  if found then
    if v_player.status <> 'active' then
      raise exception 'player account is not active' using errcode = '42501';
    end if;
    if v_player.account_type = 'registered' and v_type = 'guest' then
      raise exception 'verified member identity is required' using errcode = '42501';
    end if;
    if v_player.member_enrolled_at is null and p_enroll is not true then
      return;
    end if;
    update public.player_accounts p
    set account_type = v_type,
        member_enrolled_at = coalesce(p.member_enrolled_at, now()),
        upgraded_at = case when p.account_type = 'guest' and v_type = 'registered'
          then coalesce(p.upgraded_at, now()) else p.upgraded_at end
    where p.id = v_player.id;
  else
    if p_enroll is not true then return; end if;
    insert into public.player_accounts (auth_user_id, account_type, member_enrolled_at)
    values (p_auth_user_id, v_type, now()) returning * into v_player;
  end if;

  return query select v_player.id, v_type;
end;
$$;

revoke all on function public.looty_resolve_member(uuid, boolean) from public, anon, authenticated;
grant execute on function public.looty_resolve_member(uuid, boolean) to service_role;

commit;
