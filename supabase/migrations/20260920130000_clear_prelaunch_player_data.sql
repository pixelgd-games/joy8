begin;

set local lock_timeout='5s';
set local statement_timeout='30s';
lock table auth.users,public.player_accounts in access exclusive mode;

do $$
declare
  retained_users uuid[]:=array['8cd34776-7803-47a7-b0b8-1754eb9128f0','ac5cb167-7cdc-4e49-ba50-47a8a5220b88']::uuid[];
  target record;
  occupied boolean;
begin
  if (select count(*) from auth.users where id=any(retained_users))<>2
    or (select count(*) from auth.users)<>13
    or (select count(*) from public.player_accounts)<>1205
    or (select md5(string_agg(id::text||':'||public_id,',' order by id)) from public.player_accounts)
      is distinct from '60f2e0138b654acba091b9146f37b031' then
    raise exception 'JOY8_PLAYER_CLEANUP_TARGET_MISMATCH';
  end if;

  for target in
    select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and (
      (n.nspname='public' and c.relname in ('wallet_accounts','wallet_transactions','game_sessions',
        'joy8_match_participants','joy8_matches','joy8_settlements','joy8_settlement_entries','joy8_fee_accounts'))
      or (n.nspname='mahjong_clash' and c.relname not in
        ('economy_state','economy_versions','lifecycle_config','local_runtime'))
    ) order by n.nspname,c.relname
  loop
    execute format('lock table %I.%I in share row exclusive mode',target.nspname,target.relname);
    execute format('select exists(select 1 from %I.%I)',target.nspname,target.relname) into occupied;
    if occupied then
      raise exception 'JOY8_PLAYER_CLEANUP_HAS_GAME_DATA' using detail=target.nspname||'.'||target.relname;
    end if;
  end loop;

  delete from public.player_accounts;
  delete from auth.flow_state;
  delete from auth.refresh_tokens where user_id is null or user_id<>all(retained_users::text[]);
  delete from auth.scim_users where user_id is null or user_id<>all(retained_users);
  delete from auth.users where id<>all(retained_users);
  delete from public.gateway_rate_limits;

  if exists(select 1 from public.player_accounts)
    or (select count(*) from auth.users)<>2
    or exists(select 1 from auth.users where id<>all(retained_users)) then
    raise exception 'JOY8_PLAYER_CLEANUP_POSTCONDITION_FAILED';
  end if;
end;
$$;

commit;
