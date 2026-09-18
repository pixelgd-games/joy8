begin;

create or replace function public.looty_active_session(p_gateway_token text,p_required_scope text default 'balance')
returns table (
  session_id uuid,player_account_id uuid,wallet_account_id uuid,game_id uuid,
  account_type text,currency text,gateway_token_scopes text[]
)
language sql stable security definer set search_path = '' as $$
  select s.id,s.player_account_id,s.wallet_account_id,s.game_id,
    s.account_type,s.currency,s.gateway_token_scopes
  from public.game_sessions s
  join public.player_accounts p on p.id=s.player_account_id
  join public.wallet_accounts w on w.id=s.wallet_account_id
  where s.gateway_token_hash=public.looty_hash_secret(p_gateway_token)
    and s.gateway_token_expires_at>now() and s.expires_at>now() and s.status='active'
    and p.status='active' and w.status='active'
    and p_required_scope='balance'
    and 'balance'=any(s.gateway_token_scopes);
$$;

revoke all on function public.looty_active_session(text,text) from public,anon,authenticated,service_role;

commit;
