begin;
set local lock_timeout='5s';
lock table public.player_accounts,public.game_sessions,public.joy8_wallet_policies in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.player_accounts where account_type<>'registered')
    or exists(select 1 from public.game_sessions where account_type<>'registered') then
    raise exception 'JOY8_NONREGISTERED_DATA_REVIEW_REQUIRED';
  end if;
end; $$;
create or replace function public.joy8_resolve_member(p_auth_user_id uuid, p_enroll boolean default false)
returns table(player_account_id uuid, account_type text)
language plpgsql security definer set search_path='' as $$
declare
  v_player public.player_accounts%rowtype;
begin
  if p_enroll is true then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text,0));
    perform 1 from auth.users where id=p_auth_user_id for share;
  end if;
  if p_enroll is true then
    perform public.joy8_assert_play_access(p_auth_user_id);
  else
    if exists(select 1 from auth.users where id=p_auth_user_id and is_anonymous) then
      raise exception 'JOY8_GUEST_DISABLED' using errcode='42501';
    end if;
    if not exists(select 1 from auth.users u join public.joy8_email_allowlist a on a.email=lower(btrim(u.email))
      where u.id=p_auth_user_id and u.is_anonymous=false and u.email_confirmed_at is not null
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
        and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')) then
      raise exception 'JOY8_EMAIL_NOT_ALLOWED' using errcode='42501';
    end if;
  end if;
  if p_enroll is true then
    select p.* into v_player from public.player_accounts p where p.auth_user_id=p_auth_user_id for update;
  else
    select p.* into v_player from public.player_accounts p where p.auth_user_id=p_auth_user_id;
  end if;
  if found then
    if v_player.status<>'active' then
      raise exception 'player account is not active' using errcode='42501';
    end if;
    if v_player.member_enrolled_at is null then
      if p_enroll is not true then return; end if;
      update public.player_accounts set member_enrolled_at=now() where id=v_player.id;
    end if;
  else
    if p_enroll is not true then return; end if;
    insert into public.player_accounts(auth_user_id,account_type,member_enrolled_at)
      values(p_auth_user_id,'registered',now()) returning * into v_player;
  end if;
  if p_enroll is true then perform public.joy8_grant_member_point(v_player.id); end if;
  return query select v_player.id,'registered'::text;
end;
$$;

create or replace function public.joy8_grant_member_point(p_player_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy public.joy8_wallet_policies%rowtype;
  v_player public.player_accounts%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_initial numeric;
begin
  select p.* into v_policy from public.joy8_wallet_policies p
    where p.currency = 'POINT' and p.enabled for share;
  if not found then return null; end if;
  select p.* into v_player from public.player_accounts p where p.id = p_player_id for update;
  if not found or v_player.status <> 'active' or v_player.member_enrolled_at is null then
    raise exception 'JOY8_PLAYER_INACTIVE' using errcode = '42501';
  end if;
  select w.* into v_wallet from public.wallet_accounts w
    where w.player_account_id = p_player_id and w.currency = 'POINT' for update;
  if not found then
    insert into public.wallet_accounts(player_account_id, currency, balance, wallet_policy_id)
      values (p_player_id, 'POINT', 0, v_policy.id) returning * into v_wallet;
  elsif v_wallet.status <> 'active' or v_wallet.wallet_policy_id <> v_policy.id then
    raise exception 'JOY8_WALLET_INACTIVE' using errcode = '42501';
  end if;

  select t.amount into v_initial from public.wallet_transactions t
    where t.idempotency_key = 'initial-grant:' || v_wallet.id::text;
  if not found then
    v_initial := v_policy.initial_credit;
    if v_initial > 0 then
      v_wallet := public.joy8_apply_point_grant(v_wallet, v_initial, 'initial_grant', v_policy.id);
    end if;
  end if;

  return v_wallet.id;
end;
$$;


alter table public.player_accounts drop constraint player_accounts_account_type_check,
  add constraint player_accounts_account_type_check check(account_type='registered'),
  drop column upgraded_at;
alter table public.game_sessions drop constraint game_sessions_account_type_check,
  add constraint game_sessions_account_type_check check(account_type='registered');
alter table public.joy8_wallet_policies drop column guest_initial_credit;
revoke all on function public.joy8_resolve_member(uuid,boolean) from public,anon,authenticated;
grant execute on function public.joy8_resolve_member(uuid,boolean) to service_role;
revoke all on function public.joy8_grant_member_point(uuid) from public,anon,authenticated,service_role;
select public.joy8_validate_product_adapters();
commit;
