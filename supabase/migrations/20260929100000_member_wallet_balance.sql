begin;
set local lock_timeout='5s';
create function public.joy8_member_wallet_v1(p_auth_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_wallet public.wallet_accounts%rowtype;
begin
  select w.* into v_wallet from public.player_accounts p
  join auth.users u on u.id=p.auth_user_id
  join public.wallet_accounts w on w.player_account_id=p.id and w.currency='POINT'
  where p.auth_user_id=p_auth_user_id and p.status='active' and p.member_enrolled_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
  if not found then return jsonb_build_object('wallet',null); end if;
  return jsonb_build_object('wallet',jsonb_build_object(
    'currency',v_wallet.currency,
    'status',v_wallet.status,
    'balance',v_wallet.balance::numeric(18,2)::text,
    'available_balance',(v_wallet.balance-v_wallet.locked_balance)::numeric(18,2)::text));
end;
$$;
revoke all on function public.joy8_member_wallet_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.joy8_member_wallet_v1(uuid) to service_role;
commit;
