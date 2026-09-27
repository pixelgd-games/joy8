begin;

set local lock_timeout='5s';

create table public.joy8_email_allowlist (
  email text primary key check(email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now()
);
alter table public.joy8_email_allowlist enable row level security;
revoke all on public.joy8_email_allowlist from public,anon,authenticated,service_role;
grant select,insert,delete on public.joy8_email_allowlist to authenticated;
grant select on public.joy8_email_allowlist to supabase_auth_admin;
create policy email_allowlist_admin_read on public.joy8_email_allowlist for select to authenticated using(public.is_joy8_admin());
create policy email_allowlist_admin_add on public.joy8_email_allowlist for insert to authenticated with check(public.is_joy8_admin());
create policy email_allowlist_admin_remove on public.joy8_email_allowlist for delete to authenticated using(public.is_joy8_admin());
create policy email_allowlist_auth_read on public.joy8_email_allowlist for select to supabase_auth_admin using(true);

insert into public.joy8_email_allowlist(email) select distinct lower(btrim(email)) from public.admin_users;

create function public.joy8_protect_admin_allowlist() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.admin_users where lower(btrim(email))=old.email) then
    raise exception 'JOY8_ADMIN_EMAIL_REQUIRED' using errcode='42501';
  end if;
  return old;
end;
$$;
create trigger protect_admin_allowlist before delete or update on public.joy8_email_allowlist
for each row execute function public.joy8_protect_admin_allowlist();
revoke all on function public.joy8_protect_admin_allowlist() from public,anon,authenticated,service_role;

create function public.joy8_before_user_created(event jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
  if coalesce((event->'user'->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','JOY8_GUEST_DISABLED'));
  end if;
  if event->'user'->'app_metadata'->>'provider' is distinct from 'google'
    or not exists(select 1 from public.joy8_email_allowlist where email=lower(btrim(event->'user'->>'email'))) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','JOY8_EMAIL_NOT_ALLOWED'));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.joy8_before_user_created(jsonb) from public,anon,authenticated,service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.joy8_before_user_created(jsonb) to supabase_auth_admin;

create function public.joy8_assert_play_access(p_auth_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_user auth.users%rowtype;
begin
  select * into v_user from auth.users where id=p_auth_user_id;
  if coalesce(v_user.is_anonymous,false) then
    raise exception 'JOY8_GUEST_DISABLED' using errcode='42501';
  end if;
  if v_user.id is null or v_user.email_confirmed_at is null or v_user.deleted_at is not null
    or v_user.banned_until>now()
    or not exists(select 1 from auth.identities where user_id=v_user.id and provider='google') then
    raise exception 'JOY8_EMAIL_NOT_ALLOWED' using errcode='42501';
  end if;
  perform 1 from public.joy8_email_allowlist where email=lower(btrim(v_user.email)) for share;
  if not found then raise exception 'JOY8_EMAIL_NOT_ALLOWED' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function public.joy8_assert_play_access(uuid) from public,anon,authenticated,service_role;
grant execute on function public.joy8_assert_play_access(uuid) to service_role;

create function public.joy8_guard_play_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_auth uuid;
begin
  if tg_table_name='player_accounts' then v_auth:=new.auth_user_id;
  else select auth_user_id into v_auth from public.player_accounts where id=new.player_account_id;
  end if;
  perform public.joy8_assert_play_access(v_auth);
  return new;
end;
$$;
revoke all on function public.joy8_guard_play_access() from public,anon,authenticated,service_role;
create trigger player_play_access before insert on public.player_accounts
for each row execute function public.joy8_guard_play_access();
create trigger session_play_access before insert on public.game_sessions
for each row execute function public.joy8_guard_play_access();

select public.joy8_validate_product_adapters();
commit;
