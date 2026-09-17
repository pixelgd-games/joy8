begin;

create or replace function public.create_game_session(
  p_game_slug text,
  p_currency text default 'POINT',
  p_expires_in_seconds integer default 3600,
  p_display_name text default null,
  p_auth_user_id uuid default null
)
returns table (
  session_id uuid,
  player_account_id uuid,
  wallet_account_id uuid,
  game_id uuid,
  launch_code text,
  launch_code_expires_at timestamptz,
  account_type text,
  currency text,
  wallet_mode text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text := upper(btrim(coalesce(p_currency, 'POINT')));
  v_seconds integer := coalesce(p_expires_in_seconds, 3600);
  v_game_id uuid;
  v_member record;
  v_wallet_id uuid;
  v_wallet_status text;
  v_wallet_count integer;
  v_code text;
  v_code_expires timestamptz;
  v_session_id uuid;
  v_expires timestamptz;
begin
  if p_game_slug is null or btrim(p_game_slug) = '' then
    raise exception 'game slug is required' using errcode = '22023';
  end if;
  if v_currency = '' then
    raise exception 'currency is required' using errcode = '22023';
  end if;
  if v_seconds < 60 or v_seconds > 86400 then
    raise exception 'expires_in_seconds must be between 60 and 86400' using errcode = '22023';
  end if;

  select g.id into v_game_id from public.games g
  where g.slug = btrim(p_game_slug) and g.published = true
    and g.launch_url is not null and btrim(g.launch_url) <> '';
  if v_game_id is null then
    raise exception 'game is not available' using errcode = 'P0002';
  end if;

  select m.* into v_member from public.looty_resolve_member(p_auth_user_id, false) m;
  if not found then
    raise exception 'player membership is required' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_display_name, ''))) > 120 then
    raise exception 'display name is too long' using errcode = '22023';
  end if;
  if nullif(btrim(p_display_name), '') is not null then
    update public.player_accounts p set display_name = nullif(btrim(p_display_name), '')
    where p.id = v_member.player_account_id and p.display_name is null;
  end if;

  select count(*) into v_wallet_count from public.wallet_accounts w
  where w.player_account_id = v_member.player_account_id and w.currency = v_currency;
  if v_wallet_count > 1 then
    raise exception 'wallet account is not active' using errcode = '42501';
  end if;
  select w.id, w.status into v_wallet_id, v_wallet_status from public.wallet_accounts w
  where w.player_account_id = v_member.player_account_id and w.currency = v_currency for update;
  if found then
    if v_wallet_status <> 'active' then
      raise exception 'wallet account is not active' using errcode = '42501';
    end if;
  else
    insert into public.wallet_accounts (player_account_id, currency)
    values (v_member.player_account_id, v_currency) returning id into v_wallet_id;
  end if;

  v_code := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + v_seconds * interval '1 second';
  v_code_expires := least(v_expires, now() + interval '2 minutes');
  insert into public.game_sessions (
    player_account_id, wallet_account_id, game_id, launch_code_hash,
    launch_code_expires_at, account_type, currency, wallet_mode, expires_at
  ) values (
    v_member.player_account_id, v_wallet_id, v_game_id, public.looty_hash_secret(v_code),
    v_code_expires, v_member.account_type, v_currency, 'demo', v_expires
  ) returning id into v_session_id;

  return query select v_session_id, v_member.player_account_id, v_wallet_id, v_game_id,
    v_code, v_code_expires, v_member.account_type, v_currency, 'demo'::text, v_expires;
end;
$$;

revoke all on function public.create_game_session(text, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.create_game_session(text, text, integer, text, uuid) to service_role;

commit;
