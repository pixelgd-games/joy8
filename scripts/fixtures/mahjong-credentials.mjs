const project = 'lsazydefvnuqglultqii'

export function credentialBundle({ gameId, dbHost, backendKey, password, expiresAt }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(gameId) || !/^[0-9a-f]{64}$/.test(backendKey) || !/^[0-9a-f]{64}$/.test(password)
    || (dbHost !== `db.${project}.supabase.co` && !/^aws-[0-9]+-ap-northeast-1\.pooler\.supabase\.com$/.test(dbHost))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)) throw new Error('Invalid restricted configuration')
  const sql = `do $$
declare v_game uuid; v_hash text:=public.joy8_hash_secret('${backendKey}');
begin
  select g.id into v_game from public.games g
    join public.joy8_private_entries e on e.game_id=g.id
    join public.joy8_game_policies p on p.game_id=g.id
    join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
    where g.id='${gameId}' and g.slug='mahjong-clash' and not g.published
      and g.launch_url is null and e.enabled and e.entry_origin='http://localhost:5173'
      and e.launch_url='http://localhost:4391/' and p.enabled and w.enabled
      and w.initial_credit=0 and p.max_bet_amount=1 and p.max_payout_amount=1
      and p.max_participants=4 and p.funding_mode='participants'
      and p.reservation_mode='full_balance' and p.max_reserve_amount=1;
  if v_game is null or '${expiresAt}'::timestamptz<=now()
    or exists(select 1 from public.joy8_backend_keys where game_id=v_game and (key_hash<>v_hash or revoked_at is not null))
    or not exists(select 1 from pg_roles where rolname='mahjong_clash_runtime' and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolinherit) then
    raise exception 'MAHJONG_CREDENTIAL_PREREQUISITES_FAILED';
  end if;
  if exists(select 1 from pg_roles where rolname='mahjong_clash_runtime' and rolcanlogin)
    and not exists(select 1 from public.joy8_backend_keys where game_id=v_game and key_hash=v_hash) then
    raise exception 'MAHJONG_RUNTIME_ALREADY_CONFIGURED';
  end if;
  insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at)
    values(v_game,v_hash,array['exchange','renew'],'${expiresAt}') on conflict(key_hash) do nothing;
  if not exists(select 1 from public.joy8_backend_keys where game_id=v_game and key_hash=v_hash
    and scopes=array['exchange','renew']::text[] and expires_at='${expiresAt}'::timestamptz) then
    raise exception 'MAHJONG_KEY_CONFIGURATION_MISMATCH';
  end if;
  alter role mahjong_clash_runtime login password '${password}' valid until '${expiresAt}';
end;
$$;
`
  const env = `MAHJONG_DB_HOST=${dbHost}\nMAHJONG_DB_PASSWORD=${password}\nMAHJONG_JOY8_GAME_ID=${gameId}\nMAHJONG_JOY8_BACKEND_KEY=${backendKey}\nMAHJONG_CONTINUOUS_READY=1\n`
  return { sql, env }
}
