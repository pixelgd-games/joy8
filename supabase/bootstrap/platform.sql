BEGIN;
DO $$ BEGIN
  IF to_regclass('public.games') IS NOT NULL THEN RAISE EXCEPTION 'JOY8_BOOTSTRAP_REQUIRES_EMPTY_PROJECT'; END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.identities') IS NULL THEN RAISE EXCEPTION 'JOY8_SUPABASE_AUTH_REQUIRED'; END IF;
END; $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,supabase_auth_admin;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;





CREATE FUNCTION public.create_game_session(p_game_slug text, p_auth_user_id uuid) RETURNS TABLE(session_id uuid, player_account_id uuid, wallet_account_id uuid, game_id uuid, launch_code text, launch_code_expires_at timestamp with time zone, account_type text, currency text, expires_at timestamp with time zone, protocol text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform 1 from public.games g where g.slug=btrim(p_game_slug)
    and g.published and nullif(btrim(g.launch_url),'') is not null for share;
  if not found then raise exception 'game is not available' using errcode='P0002'; end if;
  return query select * from public.joy8_issue_game_session(p_game_slug,p_auth_user_id);
end;
$$;



CREATE FUNCTION public.is_joy8_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from auth.users u
    join public.admin_users a on lower(a.email)=lower(u.email)
    where u.id=auth.uid() and not coalesce(u.is_anonymous,false)
      and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and auth.jwt()->'app_metadata'->>'provider'='google'
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
  );
$$;



CREATE FUNCTION public.joy8_active_session(p_gateway_token text, p_required_scope text DEFAULT 'balance'::text) RETURNS TABLE(session_id uuid, player_account_id uuid, wallet_account_id uuid, game_id uuid, account_type text, currency text, gateway_token_scopes text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select s.id,s.player_account_id,s.wallet_account_id,s.game_id,
    s.account_type,s.currency,s.gateway_token_scopes
  from public.game_sessions s
  join public.player_accounts p on p.id=s.player_account_id
  join public.wallet_accounts w on w.id=s.wallet_account_id
  where s.gateway_token_hash=public.joy8_hash_secret(p_gateway_token)
    and s.gateway_token_expires_at>now() and s.expires_at>now() and s.status='active'
    and p.status='active' and w.status='active'
    and p_required_scope='balance'
    and 'balance'=any(s.gateway_token_scopes);
$$;



CREATE FUNCTION public.joy8_admin_mail(p_action text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_mail public.joy8_mail_messages%rowtype;
  v_id uuid;
  v_game uuid;
  v_amount numeric(18,2);
  v_count integer;
  v_offset integer;
  v_rows jsonb;
begin
  if not public.is_joy8_admin() then raise exception 'JOY8_MAIL_FORBIDDEN' using errcode='42501'; end if;
  if not public.joy8_consume_gateway_rate_limit('mail:admin-mailbox:'||auth.uid()::text,30,60) then
    perform set_config('response.status','429',true);
    perform set_config('response.headers','[{"Retry-After":"60"}]',true);
    return jsonb_build_object('error','JOY8_RATE_LIMITED','retry_after',60);
  end if;
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_action is null then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  if p_action='prepare' then
    if p_request-array['id','kind','title','body','audience','game_id','public_id','amount','source_ref']<>'{}'::jsonb
      or coalesce(p_request->>'kind','') not in ('announcement','notification','reward','compensation')
      or coalesce(p_request->>'audience','') not in ('all','game','player')
      or jsonb_typeof(p_request->'title') is distinct from 'string'
      or jsonb_typeof(p_request->'body') is distinct from 'string'
      or length(btrim(p_request->>'title')) not between 1 and 120
      or length(btrim(p_request->>'body')) not between 1 and 3000
      or coalesce(p_request->>'amount','') !~ '^(0|[1-9][0-9]{0,9})$'
      or jsonb_typeof(p_request->'amount') is distinct from 'string'
      or exists(select 1 from jsonb_each(p_request) x where jsonb_typeof(x.value)<>'string')
      or length(coalesce(p_request->>'source_ref',''))>200 then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    v_id := (p_request->>'id')::uuid;
    if v_id is null then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    v_game := nullif(p_request->>'game_id','')::uuid;
    v_amount := (p_request->>'amount')::numeric;
    if (p_request->>'kind' in ('reward','compensation') and (v_amount<=0 or length(btrim(coalesce(p_request->>'source_ref','')))=0))
      or (p_request->>'kind' in ('announcement','notification') and v_amount<>0)
      or (p_request->>'audience'='game' and v_game is null)
      or (p_request->>'audience'='player' and coalesce(p_request->>'public_id','') !~ '^[1-9][0-9]{5}$')
      or (p_request->>'audience'<>'player' and coalesce(p_request->>'public_id','')<>'')
      or (v_game is not null and not exists(select 1 from public.games where id=v_game)) then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    insert into public.joy8_mail_messages(id,created_by,request,kind,title,body,audience,game_id,source_ref,amount)
    values(v_id,auth.uid(),p_request,p_request->>'kind',btrim(p_request->>'title'),btrim(p_request->>'body'),
      p_request->>'audience',v_game,btrim(coalesce(p_request->>'source_ref','')),v_amount)
    on conflict(id) do nothing;
    if not found then
      select * into v_mail from public.joy8_mail_messages where id=v_id;
      if v_mail.created_by<>auth.uid() or v_mail.request<>p_request then
        raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='P0001';
      end if;
    else
      insert into public.joy8_mail_recipients(message_id,player_account_id)
      select v_id,p.id from public.player_accounts p
      where p.status='active' and p.member_enrolled_at is not null
        and (p_request->>'audience'='all'
          or (p_request->>'audience'='player' and p.public_id=p_request->>'public_id')
          or (p_request->>'audience'='game' and exists(select 1 from public.game_sessions s where s.player_account_id=p.id and s.game_id=v_game)))
      order by p.id limit 5001;
      get diagnostics v_count = row_count;
      if v_count=0 then raise exception 'JOY8_MAIL_NO_RECIPIENTS' using errcode='P0001'; end if;
      if v_count>5000 then raise exception 'JOY8_MAIL_AUDIENCE_LIMIT' using errcode='P0001'; end if;
      update public.joy8_mail_messages set recipient_count=v_count where id=v_id;
    end if;
    select * into v_mail from public.joy8_mail_messages where id=v_id;
    return to_jsonb(v_mail)-'request' || jsonb_build_object('public_id',v_mail.request->>'public_id','total_amount',(v_mail.amount*v_mail.recipient_count)::text);
  elsif p_action in ('send','cancel') then
    if p_request-array['id']<>'{}'::jsonb then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    select * into v_mail from public.joy8_mail_messages where id=(p_request->>'id')::uuid for update;
    if not found then raise exception 'JOY8_MAIL_NOT_FOUND' using errcode='P0002'; end if;
    if v_mail.status=(case when p_action='send' then 'sent' else 'cancelled' end) then
      return to_jsonb(v_mail)-'request';
    end if;
    if v_mail.status<>'draft' then raise exception 'JOY8_MAIL_STATE_CONFLICT' using errcode='P0001'; end if;
    if v_mail.created_by<>auth.uid() then raise exception 'JOY8_MAIL_FORBIDDEN' using errcode='42501'; end if;
    update public.joy8_mail_messages set status=case when p_action='send' then 'sent' else 'cancelled' end,
      sent_at=case when p_action='send' then clock_timestamp() else null end where id=v_mail.id returning * into v_mail;
    return to_jsonb(v_mail)-'request';
  elsif p_action in ('list','recipients') then
    if p_request-array['offset','id']<>'{}'::jsonb or coalesce(p_request->>'offset','0') !~ '^[0-9]{1,7}$' then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    v_offset := coalesce((p_request->>'offset')::integer,0);
    if p_action='list' then
      select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]') into v_rows from (
        select m.id,m.created_by,m.title,m.body,m.kind,m.audience,m.request->>'public_id' public_id,m.game_id,m.source_ref,m.amount::text,m.created_at,m.sent_at,m.status,m.recipient_count,
          (m.amount*m.recipient_count)::text total_amount,g.name game_name,
          (select count(*) from public.joy8_mail_recipients r where r.message_id=m.id and r.read_at is not null) read_count,
          (select count(*) from public.joy8_mail_recipients r where r.message_id=m.id and r.claimed_at is not null) claim_count
        from public.joy8_mail_messages m left join public.games g on g.id=m.game_id
        order by m.created_at desc,m.id desc limit 21 offset v_offset
      ) t;
    else
      v_id := (p_request->>'id')::uuid;
      if v_id is null then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
      select coalesce(jsonb_agg(to_jsonb(t) order by t.public_id),'[]') into v_rows from (
        select p.public_id,r.read_at,r.claimed_at,r.transaction_id
        from public.joy8_mail_recipients r join public.player_accounts p on p.id=r.player_account_id
        where r.message_id=v_id order by p.public_id limit 21 offset v_offset
      ) t;
    end if;
    return jsonb_build_object('items',v_rows,'offset',v_offset);
  end if;
  raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
end;
$_$;



CREATE FUNCTION public.joy8_admit_gateway_request(p_route text, p_request jsonb DEFAULT '{}'::jsonb, p_secret text DEFAULT NULL::text, p_auth_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_game uuid;
  v_subject uuid;
  v_action text;
  v_key text;
  v_limit integer:=120;
  v_window integer:=60;
  v_session public.game_sessions%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    return jsonb_build_object('error','JOY8_INVALID_REQUEST');
  end if;
  if p_route in ('member','enroll-member','create-session','private-session') then
    if p_auth_user_id is null or not exists(select 1 from auth.users u where u.id=p_auth_user_id
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
      return jsonb_build_object('error','JOY8_PLAYER_INACTIVE');
    end if;
    v_key:='player:'||p_auth_user_id::text||':'||p_route;
    if p_route<>'member' then v_limit:=30; v_window:=300; end if;
  elsif p_route='balance' then
    select s.player_account_id into v_subject from public.joy8_active_session(p_request->>'gateway_token','balance') s;
    if not found then return jsonb_build_object('error','JOY8_SESSION_INVALID'); end if;
    select p.auth_user_id into v_subject from public.player_accounts p where p.id=v_subject;
    if v_subject is null then return jsonb_build_object('error','JOY8_PLAYER_INACTIVE'); end if;
    v_key:='player:'||v_subject::text||':balance';
  elsif p_route in ('server-exchange-v1','server-renew-v1','server-open-v1','server-settle-v1','server-status-v1','server-cancel-v1') then
    v_action:=substring(p_route from 8 for length(p_route)-10);
    begin
      v_game:=public.joy8_backend_game(p_secret,v_action);
    exception when invalid_authorization_specification then
      return jsonb_build_object('error','JOY8_BACKEND_UNAUTHORIZED');
    end;
    if not public.joy8_consume_gateway_rate_limit('backend:'||v_game::text,6000,60) then
      return jsonb_build_object('allowed',false,'retry_after',60);
    end if;
    if p_request->>'version' is distinct from '1' then
      return jsonb_build_object('error','JOY8_INVALID_REQUEST');
    end if;
    if v_action in ('exchange','renew') then
      if v_action='exchange' then
        if coalesce(p_request->>'launch_code','') !~ '^[a-f0-9]{64}$' then
          return jsonb_build_object('error','JOY8_INVALID_REQUEST');
        end if;
        select s.* into v_session from public.game_sessions s
          where s.launch_code_hash=public.joy8_hash_secret(p_request->>'launch_code') and s.game_id=v_game;
      else
        if coalesce(p_request->>'session_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
          return jsonb_build_object('error','JOY8_INVALID_REQUEST');
        end if;
        select s.* into v_session from public.game_sessions s
          where s.id=(p_request->>'session_id')::uuid and s.game_id=v_game and s.launch_code_used_at is not null;
      end if;
      if v_session.id is null or v_session.status<>'active' or v_session.expires_at<=now() then
        return jsonb_build_object('error','JOY8_SESSION_INVALID');
      end if;
      v_key:='session:'||v_session.id::text||':login';
      v_limit:=30;
    elsif v_action='open' then
      v_key:='backend:'||v_game::text||':open';
      v_limit:=120;
    else
      if coalesce(length(p_request->>'match_ref'),0) not between 1 and 120 then
        return jsonb_build_object('error','JOY8_INVALID_REQUEST');
      end if;
      select m.id into v_subject from public.joy8_matches m
        where m.game_id=v_game and m.match_ref=p_request->>'match_ref';
      if not found then return jsonb_build_object('error','JOY8_MATCH_NOT_FOUND'); end if;
      v_key:='match:'||v_subject::text||':'||v_action;
      if v_action in ('settle','cancel') then v_limit:=30; end if;
    end if;
  else
    return jsonb_build_object('error','JOY8_INVALID_REQUEST');
  end if;
  return jsonb_build_object('allowed',public.joy8_consume_gateway_rate_limit(v_key,v_limit,v_window),'retry_after',v_window);
end;
$_$;



CREATE FUNCTION public.joy8_allocate_public_player_id() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_public_id text; v_attempt integer;
begin
  for v_attempt in 1..128 loop
    v_public_id := (pg_catalog.floor(pg_catalog.random() * 900000) + 100000)::integer::text;
    if exists(select 1 from public.player_accounts p where p.public_id=v_public_id) then
      continue;
    end if;
    begin
      if pg_catalog.pg_try_advisory_xact_lock(75080002,v_public_id::integer) then
        if exists(select 1 from public.player_accounts p where p.public_id=v_public_id) then
          raise exception using errcode='J8001';
        end if;
        return v_public_id;
      end if;
    exception when sqlstate 'J8001' then
      null;
    end;
  end loop;
  raise exception 'JOY8_PUBLIC_PLAYER_ID_ALLOCATION_FAILED' using errcode='54000';
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.wallet_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_account_id uuid NOT NULL,
    currency text DEFAULT 'POINT'::text NOT NULL,
    balance numeric(18,2) DEFAULT 0 NOT NULL,
    locked_balance numeric(18,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    wallet_policy_id uuid NOT NULL,
    CONSTRAINT wallet_accounts_balance_check CHECK ((balance >= (0)::numeric)),
    CONSTRAINT wallet_accounts_currency_check CHECK ((btrim(currency) <> ''::text)),
    CONSTRAINT wallet_accounts_locked_balance_check CHECK ((locked_balance >= (0)::numeric)),
    CONSTRAINT wallet_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'frozen'::text, 'closed'::text])))
);



CREATE FUNCTION public.joy8_apply_point_grant(p_wallet public.wallet_accounts, p_amount numeric, p_source text, p_policy uuid) RETURNS public.wallet_accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_wallet public.wallet_accounts%rowtype;
begin
  update public.wallet_accounts set balance = balance + p_amount, updated_at = now()
    where id = p_wallet.id returning * into v_wallet;
  insert into public.wallet_transactions(
    wallet_account_id, type, amount, balance_before, balance_after, game_id,
    idempotency_key, source_type, source_ref
  ) values (
    v_wallet.id, 'deposit', p_amount, p_wallet.balance, v_wallet.balance, null,
    replace(p_source, '_', '-') || ':' || v_wallet.id::text, p_source, p_policy::text
  );
  return v_wallet;
end;
$$;



CREATE FUNCTION public.joy8_assert_play_access(p_auth_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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



CREATE FUNCTION public.joy8_assert_player(p_player uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_auth uuid;
begin
  select p.auth_user_id into v_auth from public.player_accounts p where p.id=p_player;
  perform 1 from auth.users u where u.id=v_auth and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and (u.is_anonymous or u.email_confirmed_at is not null) for share;
  if not found then raise exception 'JOY8_PLAYER_INACTIVE' using errcode='42501'; end if;
  perform 1 from public.player_accounts p where p.id=p_player and p.status='active'
    and p.member_enrolled_at is not null for share;
  if not found then raise exception 'JOY8_PLAYER_INACTIVE' using errcode='42501'; end if;
end;
$$;



CREATE FUNCTION public.joy8_backend_game(p_secret text, p_scope text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_game uuid;
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then
    raise exception 'JOY8_BACKEND_UNAUTHORIZED' using errcode='28000';
  end if;
  select k.game_id into v_game from public.joy8_backend_keys k
  where k.key_hash=public.joy8_hash_secret(p_secret) and k.revoked_at is null
    and p_scope=any(k.scopes) for share;
  if not found then raise exception 'JOY8_BACKEND_UNAUTHORIZED' using errcode='28000'; end if;
  return v_game;
end;
$_$;



CREATE FUNCTION public.joy8_before_user_created(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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



CREATE FUNCTION public.joy8_check_product_ddl() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.joy8_validate_product_adapters();
  delete from public.joy8_product_ddl_checks where transaction_id=new.transaction_id;
  return null;
exception when sqlstate '42501' then
  raise exception 'JOY8_PRODUCT_DDL_REJECTED' using errcode='42501',
    hint='Revoke unintended product privileges in this transaction before commit. Product adapters were not executed.';
end;
$$;



CREATE FUNCTION public.joy8_check_product_registration() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.joy8_lock_product_ddl_schemas(array(
    select n.oid from pg_catalog.pg_namespace n
    where n.nspname in ('public','auth')
      or exists(select 1 from public.joy8_product_schemas s where s.schema_name=n.nspname)
  ));
  perform pg_catalog.pg_advisory_xact_lock(75080003);
  perform public.joy8_validate_product_adapters();
  return null;
end;
$$;



CREATE FUNCTION public.joy8_cleanup_gateway_runtime() RETURNS TABLE(expired_sessions integer, removed_rate_limits integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_expired_sessions integer;
  v_removed_rate_limits integer;
begin
  update public.game_sessions
  set
    status = 'expired',
    closed_at = coalesce(closed_at, now())
  where status = 'active'
    and (
      expires_at <= now()
      or (
        gateway_token_hash is null
        and launch_code_used_at is null
        and launch_code_expires_at <= now()
      )
    );

  get diagnostics v_expired_sessions = row_count;

  delete from public.gateway_rate_limits
  where expires_at <= now();

  get diagnostics v_removed_rate_limits = row_count;

  return query
  select v_expired_sessions, v_removed_rate_limits;
end;
$$;



CREATE FUNCTION public.joy8_consume_gateway_rate_limit(p_key text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_key_hash text;
  v_window_started_at timestamptz;
  v_allowed boolean;
begin
  if p_key is null or btrim(p_key) = '' then
    raise exception 'rate limit key is required' using errcode = '22023';
  end if;

  if p_limit < 1 or p_limit > 10000 then
    raise exception 'rate limit must be between 1 and 10000' using errcode = '22023';
  end if;

  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate limit window must be between 1 and 86400 seconds' using errcode = '22023';
  end if;

  v_key_hash := public.joy8_hash_secret(p_key);
  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.gateway_rate_limits (
    bucket_key_hash,
    window_started_at,
    request_count,
    expires_at
  )
  values (
    v_key_hash,
    v_window_started_at,
    1,
    v_window_started_at + (p_window_seconds * 2 * interval '1 second')
  )
  on conflict (bucket_key_hash, window_started_at)
  do update set
    request_count = public.gateway_rate_limits.request_count + 1,
    updated_at = now()
  where public.gateway_rate_limits.request_count < p_limit
  returning true
  into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;



CREATE FUNCTION public.joy8_create_private_session(p_game_slug text, p_auth_user_id uuid, p_origin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_member record; v_entry record; v_session record;
begin
  select * into v_member from public.joy8_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  select g.id,g.name,e.launch_url into v_entry from public.games g
    join public.joy8_private_entries e on e.game_id=g.id
    where g.slug=btrim(p_game_slug) and e.enabled
      and e.entry_origin=p_origin for share of g,e;
  if not found then raise exception 'JOY8_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  select * into v_session from public.joy8_issue_game_session(p_game_slug,p_auth_user_id);
  return (to_jsonb(v_session)-'player_account_id'-'wallet_account_id') ||
    jsonb_build_object('player_account_ref',v_member.player_account_id,'game_name',v_entry.name,'launch_url',v_entry.launch_url);
end;
$$;



CREATE FUNCTION public.joy8_game_readiness(p_game_id uuid, p_slug text, p_launch_url text, p_thumbnail text) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_missing text[] := array[]::text[];
  v_policy public.joy8_game_policies%rowtype;
begin
  if not public.is_joy8_admin() then raise exception 'JOY8_ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_game_id is null then v_missing:=array_append(v_missing,'save_draft'); end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,80}$' then v_missing:=array_append(v_missing,'slug'); end if;
  if p_launch_url is null or p_launch_url !~ '^https://[^/@[:space:]]+([/?#]|$)'
    or p_launch_url ~ '[[:space:]]' then v_missing:=array_append(v_missing,'https_url'); end if;
  if p_thumbnail is null or p_thumbnail is distinct from '/games/'||p_slug||'/cover.webp' then
    v_missing:=array_append(v_missing,'cover');
  end if;
  select * into v_policy from public.joy8_game_policies where game_id=p_game_id;
  if not found or not v_policy.enabled then v_missing:=array_append(v_missing,'game_policy'); end if;
  if not exists(select 1 from public.joy8_wallet_policies where id=v_policy.wallet_policy_id and enabled and currency='POINT') then
    v_missing:=array_append(v_missing,'wallet_policy');
  end if;
  if not exists(select 1 from public.joy8_backend_keys where game_id=p_game_id and revoked_at is null
    and scopes @> array['exchange','renew','open','settle','status','cancel']::text[]) then
    v_missing:=array_append(v_missing,'backend_key');
  end if;
  if v_policy.product_adapter is not null then
    begin
      perform public.joy8_validate_product_adapter(v_policy.product_adapter);
    exception when others then v_missing:=array_append(v_missing,'product_adapter');
    end;
  end if;
  return v_missing;
end;
$_$;



CREATE FUNCTION public.joy8_grant_member_point(p_player_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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



CREATE FUNCTION public.joy8_guard_mail_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='DELETE' then raise exception 'JOY8_MAIL_IMMUTABLE'; end if;
  if tg_table_name='joy8_mail_messages' then
    if old.status<>'draft' or (to_jsonb(new)-array['status','sent_at','recipient_count'])
      is distinct from (to_jsonb(old)-array['status','sent_at','recipient_count']) then
      raise exception 'JOY8_MAIL_IMMUTABLE';
    end if;
  else
    if new.message_id<>old.message_id or new.player_account_id<>old.player_account_id
      or (old.read_at is not null and new.read_at is distinct from old.read_at)
      or (old.claimed_at is not null and (new.claimed_at is distinct from old.claimed_at or new.transaction_id is distinct from old.transaction_id)) then
      raise exception 'JOY8_MAIL_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;



CREATE FUNCTION public.joy8_guard_play_access() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_auth uuid;
begin
  if tg_table_name='player_accounts' then v_auth:=new.auth_user_id;
  else select auth_user_id into v_auth from public.player_accounts where id=new.player_account_id;
  end if;
  perform public.joy8_assert_play_access(v_auth);
  return new;
end;
$$;



CREATE FUNCTION public.joy8_hash_secret(p_secret text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  select case
    when p_secret is null or btrim(p_secret) = '' then null
    else encode(digest(p_secret, 'sha256'), 'hex')
  end;
$$;



CREATE FUNCTION public.joy8_issue_game_session(p_game_slug text, p_auth_user_id uuid) RETURNS TABLE(session_id uuid, player_account_id uuid, wallet_account_id uuid, game_id uuid, launch_code text, launch_code_expires_at timestamp with time zone, account_type text, currency text, expires_at timestamp with time zone, protocol text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_game uuid;
  v_member record;
  v_wallet uuid;
  v_session public.game_sessions%rowtype;
  v_code text;
begin
  if p_game_slug is null or p_game_slug !~ '^[a-z0-9-]{1,80}$' then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
  select g.id into v_game from public.games g where g.slug=btrim(p_game_slug);
  if v_game is null then raise exception 'game is not available' using errcode='P0002'; end if;
  select * into v_member from public.joy8_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  v_wallet := public.joy8_provision_wallet(v_member.player_account_id,v_game);
  v_code := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.game_sessions (
    player_account_id,wallet_account_id,game_id,launch_code_hash,launch_code_expires_at,
    account_type,currency,expires_at,gateway_token_scopes
  ) values (
    v_member.player_account_id,v_wallet,v_game,public.joy8_hash_secret(v_code),
    now()+interval '120 seconds',
    v_member.account_type,'POINT',now()+interval '12 hours',
    array['balance']::text[]
  ) returning * into v_session;
  return query select v_session.id,v_session.player_account_id,v_session.wallet_account_id,
    v_session.game_id,v_code,v_session.launch_code_expires_at,v_session.account_type,
    v_session.currency,v_session.expires_at,'server-v1'::text;
end;
$_$;



CREATE FUNCTION public.joy8_lock_product_ddl_schemas(p_schemas oid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_schema oid;
begin
  if coalesce(cardinality(p_schemas),0)>0
    and current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'JOY8_PRODUCT_DDL_REQUIRES_READ_COMMITTED' using errcode='40001';
  end if;
  for v_schema in select distinct unnest(p_schemas) order by 1 loop
    perform pg_catalog.pg_advisory_xact_lock(75080005,v_schema::integer);
  end loop;
end;
$$;



CREATE FUNCTION public.joy8_match_available_points_v1(p_match_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_count integer;
  v_balance text;
  v_balances jsonb;
begin
  select count(*), max((w.balance-w.locked_balance)::numeric(18,2)::text),
    jsonb_object_agg(p.player_account_id::text,(w.balance-w.locked_balance)::numeric(18,2)::text)
  into v_count,v_balance,v_balances
  from public.joy8_match_participants p
  join public.wallet_accounts w on w.id=p.wallet_account_id
  where p.match_id=p_match_id;
  if v_count=0 then raise exception 'JOY8_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  if v_count=1 then return jsonb_build_object('available_balance',v_balance); end if;
  return jsonb_build_object('available_balances',v_balances);
end;
$$;



CREATE FUNCTION public.joy8_match_status_v1(p_secret text, p_request jsonb, p_cancel boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_game uuid; v_match public.joy8_matches%rowtype; v_part record;
begin
  v_game:=public.joy8_backend_game(p_secret,case when p_cancel then 'cancel' else 'status' end);
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120 then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if not found then raise exception 'JOY8_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  if p_cancel and v_match.state='settled' then raise exception 'JOY8_MATCH_FINALIZED' using errcode='55000'; end if;
  if p_cancel and v_match.state='open' then
    perform w.id from public.wallet_accounts w join public.joy8_match_participants p on p.wallet_account_id=w.id
      where p.match_id=v_match.id order by w.id for update of w;
    for v_part in select * from public.joy8_match_participants where match_id=v_match.id loop
      update public.wallet_accounts set locked_balance=locked_balance-v_part.reserved_amount,updated_at=now()
        where id=v_part.wallet_account_id;
    end loop;
    if v_match.product_adapter is not null then
      perform public.joy8_product_adapter(v_match.product_adapter,'cancel',v_match.id,
        jsonb_build_object('version',1,'game_id',v_game,'request',p_request));
    end if;
    update public.joy8_match_participants set released_at=now() where match_id=v_match.id;
    update public.joy8_matches set state='cancelled',finalized_at=now() where id=v_match.id;
    v_match.state:='cancelled';
  end if;
  return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state,'result',v_match.result,'settlement_count',v_match.settlement_count);
end;
$$;



CREATE FUNCTION public.joy8_member_mail(p_auth_user_id uuid, p_action text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_player uuid;
  v_mail public.joy8_mail_messages%rowtype;
  v_recipient public.joy8_mail_recipients%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_transaction uuid;
  v_offset integer;
  v_rows jsonb;
  v_unread bigint;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_action is null then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  select p.id into v_player from public.player_accounts p join auth.users u on u.id=p.auth_user_id
  where p.auth_user_id=p_auth_user_id and p.status='active' and p.member_enrolled_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
  if v_player is null then raise exception 'JOY8_MAIL_FORBIDDEN' using errcode='42501'; end if;
  if p_action='list' then
    if p_request-array['offset','game_id']<>'{}'::jsonb or coalesce(p_request->>'offset','0') !~ '^[0-9]{1,7}$' then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    v_offset := coalesce((p_request->>'offset')::integer,0);
    select count(*) into v_unread from public.joy8_mail_recipients r join public.joy8_mail_messages m on m.id=r.message_id
      where r.player_account_id=v_player and m.status='sent' and r.read_at is null
      and (nullif(p_request->>'game_id','') is null or m.game_id is null or m.game_id=(p_request->>'game_id')::uuid);
    select coalesce(jsonb_agg(to_jsonb(t) order by t.sent_at desc,t.id desc),'[]') into v_rows from (
      select m.id,m.title,m.body,m.kind,m.game_id,g.name game_name,m.amount::text,m.sent_at,r.read_at,r.claimed_at
      from public.joy8_mail_recipients r join public.joy8_mail_messages m on m.id=r.message_id
      left join public.games g on g.id=m.game_id
      where r.player_account_id=v_player and m.status='sent'
        and (nullif(p_request->>'game_id','') is null or m.game_id is null or m.game_id=(p_request->>'game_id')::uuid)
      order by m.sent_at desc,m.id desc limit 21 offset v_offset
    ) t;
    return jsonb_build_object('items',v_rows,'unread',v_unread,'offset',v_offset);
  elsif p_action in ('read','claim') then
    if p_request-array['id']<>'{}'::jsonb then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    select m.* into v_mail from public.joy8_mail_messages m join public.joy8_mail_recipients r on r.message_id=m.id
      where m.id=(p_request->>'id')::uuid and r.player_account_id=v_player and m.status='sent';
    if not found then raise exception 'JOY8_MAIL_NOT_FOUND' using errcode='P0002'; end if;
    select * into v_recipient from public.joy8_mail_recipients where message_id=v_mail.id and player_account_id=v_player for update;
    if p_action='read' then
      update public.joy8_mail_recipients set read_at=coalesce(read_at,clock_timestamp())
        where message_id=v_mail.id and player_account_id=v_player returning * into v_recipient;
      return jsonb_build_object('id',v_mail.id,'read_at',v_recipient.read_at,'claimed_at',v_recipient.claimed_at);
    end if;
    if v_mail.amount<=0 then raise exception 'JOY8_MAIL_NO_REWARD' using errcode='P0001'; end if;
    if v_recipient.claimed_at is not null then
      return jsonb_build_object('id',v_mail.id,'claimed_at',v_recipient.claimed_at,'transaction_id',v_recipient.transaction_id,'amount',v_mail.amount::text);
    end if;
    select * into v_wallet from public.wallet_accounts where player_account_id=v_player and currency='POINT' for update;
    if not found or v_wallet.status<>'active' then raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501'; end if;
    if v_wallet.locked_balance<>0 or exists(select 1 from public.joy8_match_participants p join public.joy8_matches m on m.id=p.match_id
      where p.wallet_account_id=v_wallet.id and m.state='open') then
      raise exception 'JOY8_WALLET_OCCUPIED' using errcode='P0001';
    end if;
    update public.wallet_accounts set balance=balance+v_mail.amount,updated_at=now() where id=v_wallet.id;
    insert into public.wallet_transactions(wallet_account_id,type,amount,balance_before,balance_after,game_id,idempotency_key,source_type,source_ref)
    values(v_wallet.id,'adjustment',v_mail.amount,v_wallet.balance,v_wallet.balance+v_mail.amount,v_mail.game_id,
      'mail:'||v_mail.id::text||':'||v_player::text,
      case when v_mail.kind='compensation' then 'mail_compensation' else 'mail_reward' end,v_mail.source_ref) returning id into v_transaction;
    update public.joy8_mail_recipients set read_at=coalesce(read_at,clock_timestamp()),claimed_at=clock_timestamp(),transaction_id=v_transaction
      where message_id=v_mail.id and player_account_id=v_player returning * into v_recipient;
    return jsonb_build_object('id',v_mail.id,'claimed_at',v_recipient.claimed_at,'transaction_id',v_transaction,'amount',v_mail.amount::text);
  end if;
  raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
end;
$_$;



CREATE FUNCTION public.joy8_open_match_v1(p_secret text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_game uuid;
  v_config record;
  v_match public.joy8_matches%rowtype;
  v_hash text;
  v_item jsonb;
  v_player uuid;
  v_wallet public.wallet_accounts%rowtype;
  v_session public.game_sessions%rowtype;
  v_amount numeric;
  v_count integer;
  v_products jsonb:=coalesce(p_request->'product_participants','[]'::jsonb);
begin
  v_game:=public.joy8_backend_game(p_secret,'open');
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref','rule_version','participants','product_participants'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or coalesce(length(p_request->>'rule_version'),0) not between 1 and 80
    or jsonb_typeof(p_request->'participants') is distinct from 'array'
    or jsonb_typeof(v_products) is distinct from 'array' then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.joy8_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if found then
    if v_match.open_hash<>v_hash then raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state);
  end if;
  select g.* into v_config from public.joy8_game_policies g
  join public.joy8_wallet_policies p on p.id=g.wallet_policy_id
  where g.game_id=v_game and g.enabled and p.enabled for share of g,p;
  if not found then raise exception 'JOY8_GAME_NOT_READY' using errcode='42501'; end if;
  if v_config.funding_mode='platform' and jsonb_array_length(v_products)>0 then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_count:=jsonb_array_length(p_request->'participants');
  if v_count<1 or v_count+jsonb_array_length(v_products)>v_config.max_participants then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_request->'participants') loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['session_id','reserve'])<>'{}'::jsonb
      or (v_item->>'session_id') is null then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_amount<=0 or (v_config.reservation_mode='capped'
        and (v_amount<v_config.min_bet_amount or v_amount>v_config.max_bet_amount))
      or (v_config.reservation_mode='full_balance' and v_config.max_reserve_amount is not null
        and v_amount>v_config.max_reserve_amount) then
      raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct value->>'session_id') from jsonb_array_elements(p_request->'participants'))<>v_count then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_products) loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['account_ref','reserve'])<>'{}'::jsonb
      or coalesce(length(v_item->>'account_ref'),0) not between 1 and 120 then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_amount<=0 or v_amount>v_config.max_payout_amount then raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'account_ref') from jsonb_array_elements(v_products))<>jsonb_array_length(v_products) then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  for v_player in select distinct s.player_account_id from public.game_sessions s
    join jsonb_array_elements(p_request->'participants') e on s.id=(e.value->>'session_id')::uuid
    order by s.player_account_id loop
    perform public.joy8_assert_player(v_player);
  end loop;
  perform w.id from public.wallet_accounts w join public.game_sessions s on s.wallet_account_id=w.id
    join jsonb_array_elements(p_request->'participants') e on s.id=(e.value->>'session_id')::uuid
    order by w.id for update of w;
  insert into public.joy8_matches(game_id,match_ref,rule_version,open_hash,wallet_policy_id,
    max_bet_amount,max_payout_amount,funding_mode,product_adapter,product_participants,
    reservation_mode,max_reserve_amount)
  values(v_game,p_request->>'match_ref',p_request->>'rule_version',v_hash,v_config.wallet_policy_id,
    v_config.max_bet_amount,v_config.max_payout_amount,v_config.funding_mode,v_config.product_adapter,v_products,
    v_config.reservation_mode,v_config.max_reserve_amount)
  returning * into v_match;
  for v_item in select value from jsonb_array_elements(p_request->'participants') order by value->>'session_id' loop
    select s.* into v_session from public.game_sessions s where s.id=(v_item->>'session_id')::uuid
      and s.game_id=v_game and s.status='active' and s.expires_at>now()
      and s.launch_code_used_at is not null for share;
    if not found then raise exception 'JOY8_SESSION_INVALID' using errcode='42501'; end if;
    select w.* into v_wallet from public.wallet_accounts w where w.id=v_session.wallet_account_id;
    v_amount:=public.joy8_point_amount(v_item->'reserve');
    if v_wallet.status<>'active' or v_wallet.wallet_policy_id<>v_config.wallet_policy_id then
      raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501';
    end if;
    if exists(select 1 from public.joy8_match_participants p
      where p.wallet_account_id=v_wallet.id and p.released_at is null) then
      raise exception 'JOY8_WALLET_OCCUPIED' using errcode='55000';
    end if;
    if v_wallet.balance-v_wallet.locked_balance<v_amount then
      raise exception 'JOY8_INSUFFICIENT_BALANCE' using errcode='22003';
    end if;
    if v_config.reservation_mode='full_balance' and v_wallet.balance-v_wallet.locked_balance<>v_amount then
      raise exception 'JOY8_INVALID_AMOUNT' using errcode='22023';
    end if;
    if v_config.reservation_mode='full_balance' and v_amount<v_config.min_bet_amount then
      raise exception 'JOY8_INSUFFICIENT_BALANCE' using errcode='22003';
    end if;
    insert into public.joy8_match_participants(
      match_id,player_account_id,wallet_account_id,game_session_id,reserved_amount
    ) values(v_match.id,v_session.player_account_id,v_wallet.id,v_session.id,v_amount);
    update public.wallet_accounts set locked_balance=locked_balance+v_amount,updated_at=now()
      where id=v_wallet.id;
  end loop;
  if v_config.product_adapter is not null then
    perform public.joy8_product_adapter(v_config.product_adapter,'open',v_match.id,
      jsonb_build_object('version',1,'game_id',v_game,'request',p_request));
  elsif jsonb_array_length(v_products)>0 then
    raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('version',1,'match_id',v_match.id,'state','open');
end;
$$;



CREATE FUNCTION public.joy8_open_with_settlement_v1(p_secret text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_game uuid;
  v_hash text;
  v_match public.joy8_matches%rowtype;
  v_settlement jsonb:=p_request->'settlement';
  v_settle_request jsonb;
  v_settle_result jsonb;
  v_open_result jsonb;
begin
  v_game:=public.joy8_backend_game(p_secret,'open');
  perform public.joy8_backend_game(p_secret,'settle');
  if jsonb_typeof(p_request) is distinct from 'object'
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or jsonb_typeof(v_settlement) is distinct from 'object'
    or (v_settlement-array['operation_key','final','entries','product_commit'])<>'{}'::jsonb
    or not (v_settlement ?& array['operation_key','final','entries']) then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.joy8_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if found then
    if v_match.open_hash<>v_hash then raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    select s.result into v_settle_result from public.joy8_settlements s
      where s.match_id=v_match.id and s.settlement_no=1;
    if not found then raise exception 'JOY8_UPSTREAM_UNAVAILABLE' using errcode='55000'; end if;
    return jsonb_build_object('version',1,'match_id',v_match.id,'state',v_match.state,
      'settlement',v_settle_result);
  end if;
  v_open_result:=public.joy8_open_match_v1(p_secret,p_request-'settlement');
  update public.joy8_matches set open_hash=v_hash where id=(v_open_result->>'match_id')::uuid;
  v_settle_request:=jsonb_build_object('version',1,'match_ref',p_request->>'match_ref',
    'rule_version',p_request->>'rule_version','operation_key',v_settlement->'operation_key',
    'settlement_no',1,'final',v_settlement->'final','entries',v_settlement->'entries');
  if v_settlement ? 'product_commit' then
    v_settle_request:=v_settle_request||jsonb_build_object('product_commit',v_settlement->'product_commit');
  end if;
  v_settle_result:=public.joy8_settle_match_v1(p_secret,v_settle_request);
  return jsonb_build_object('version',1,'match_id',v_open_result->'match_id',
    'state',v_settle_result->>'state','settlement',v_settle_result);
end;
$$;



CREATE FUNCTION public.joy8_operator_cancel_match(p_game uuid, p_match_ref text, p_expected_settlements integer, p_reason text, p_evidence_ref text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_match public.joy8_matches%rowtype; v_recovery public.joy8_match_recoveries%rowtype;
begin
  if p_expected_settlements is null or p_expected_settlements<0
    or coalesce(length(btrim(p_reason)),0) not between 10 and 1000
    or coalesce(length(btrim(p_evidence_ref)),0) not between 10 and 1000 then
    raise exception 'JOY8_RECOVERY_EVIDENCE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_game::text||':'||p_match_ref,1));
  select * into v_match from public.joy8_matches where game_id=p_game and match_ref=p_match_ref for update;
  if not found then raise exception 'JOY8_MATCH_NOT_FOUND'; end if;
  if v_match.settlement_count<>p_expected_settlements then raise exception 'JOY8_RECOVERY_STATE_CHANGED'; end if;
  select * into v_recovery from public.joy8_match_recoveries where match_id=v_match.id;
  if found then
    if v_match.state<>'cancelled' or v_recovery.reason<>p_reason or v_recovery.evidence_ref<>p_evidence_ref then
      raise exception 'JOY8_RECOVERY_CONFLICT';
    end if;
    return jsonb_build_object('match_id',v_match.id,'state',v_match.state,'settlement_count',v_match.settlement_count);
  end if;
  if v_match.state<>'open' then raise exception 'JOY8_MATCH_FINALIZED'; end if;
  perform w.id from public.wallet_accounts w join public.joy8_match_participants p on p.wallet_account_id=w.id
    where p.match_id=v_match.id order by w.id for update of w;
  if exists(select 1 from public.joy8_match_participants p join public.wallet_accounts w on w.id=p.wallet_account_id
    where p.match_id=v_match.id and (p.released_at is not null or w.locked_balance<p.reserved_amount)) then
    raise exception 'JOY8_RECOVERY_RESERVATION_MISMATCH';
  end if;
  update public.wallet_accounts w set locked_balance=w.locked_balance-p.reserved_amount,updated_at=now()
    from public.joy8_match_participants p where p.match_id=v_match.id and w.id=p.wallet_account_id;
  if v_match.product_adapter is not null then
    perform public.joy8_product_adapter(v_match.product_adapter,'cancel',v_match.id,
      jsonb_build_object('version',1,'game_id',p_game,'request',jsonb_build_object('version',1,'match_ref',p_match_ref)));
  end if;
  update public.joy8_match_participants set released_at=now() where match_id=v_match.id;
  update public.joy8_matches set state='cancelled',finalized_at=now() where id=v_match.id;
  insert into public.joy8_match_recoveries(match_id,settlement_count,reason,evidence_ref)
    values(v_match.id,v_match.settlement_count,p_reason,p_evidence_ref);
  return jsonb_build_object('match_id',v_match.id,'state','cancelled','settlement_count',v_match.settlement_count);
end;
$$;



CREATE FUNCTION public.joy8_platform_health_v1() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select to_regprocedure('public.joy8_resolve_member(uuid,boolean)') is not null
    and to_regprocedure('public.create_game_session(text,uuid)') is not null
    and to_regprocedure('public.joy8_settle_match_v1(text,jsonb)') is not null
    and (select count(*)>=0 from (select id from public.games limit 1) g);
$$;



CREATE FUNCTION public.joy8_point_amount(p_value jsonb) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
begin
  if jsonb_typeof(p_value) is distinct from 'string'
    or (p_value #>> '{}') !~ '^-?(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$' then
    raise exception 'JOY8_INVALID_AMOUNT' using errcode='22023';
  end if;
  return (p_value #>> '{}')::numeric;
end;
$_$;



CREATE FUNCTION public.joy8_product_adapter(p_adapter regprocedure, p_action text, p_match uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_schema text; v_name text; v_result jsonb;
begin
  perform public.joy8_validate_product_adapter(p_adapter);
  select n.nspname,p.proname into strict v_schema,v_name
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where p.oid=p_adapter::oid;
  execute format('select %I.%I($1,$2,$3)',v_schema,v_name) into v_result
    using p_action,p_match,p_payload;
  if v_result->>'committed' is distinct from 'true' then
    raise exception 'JOY8_ADAPTER_REJECTED' using errcode='42501';
  end if;
  return v_result;
end;
$_$;



CREATE FUNCTION public.joy8_protect_admin_allowlist() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists(select 1 from public.admin_users where lower(btrim(email))=old.email) then
    raise exception 'JOY8_ADMIN_EMAIL_REQUIRED' using errcode='42501';
  end if;
  return old;
end;
$$;



CREATE FUNCTION public.joy8_provision_wallet(p_player_id uuid, p_game_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_policy uuid;
  v_wallet uuid;
begin
  select p.id into v_policy
  from public.joy8_game_policies g
  join public.joy8_wallet_policies p on p.id = g.wallet_policy_id
  where g.game_id = p_game_id and g.enabled and p.enabled
  for share of g, p;
  if not found then raise exception 'JOY8_GAME_NOT_READY' using errcode = '42501'; end if;
  v_wallet := public.joy8_grant_member_point(p_player_id);
  if v_wallet is null or not exists(select 1 from public.wallet_accounts w
    where w.id = v_wallet and w.wallet_policy_id = v_policy) then
    raise exception 'JOY8_WALLET_INACTIVE' using errcode = '42501';
  end if;
  return v_wallet;
end;
$$;



CREATE FUNCTION public.joy8_public_games_v1() RETURNS TABLE(id uuid, slug text, name text, type text, thumbnail text, created_at timestamp with time zone, launch_url text, sort_order integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    g.id,
    g.slug,
    g.name,
    g.type,
    g.thumbnail,
    g.created_at,
    g.launch_url,
    g.sort_order
  from public.games g
  where g.published = true
    and g.launch_url is not null
    and btrim(g.launch_url) <> ''
  order by g.sort_order, g.created_at desc;
$$;



CREATE FUNCTION public.joy8_queue_product_ddl_check() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_schemas oid[];
  v_relevant boolean:=false;
begin
  if tg_event='sql_drop' then
    select array_agg(distinct coalesce(n.oid,dropped_schema.objid,
      case when d.classid='pg_catalog.pg_namespace'::regclass then d.objid end))
    into v_schemas
    from pg_catalog.pg_event_trigger_dropped_objects() d
    left join pg_catalog.pg_namespace n on n.nspname=d.schema_name
    left join pg_catalog.pg_event_trigger_dropped_objects() dropped_schema
      on dropped_schema.classid='pg_catalog.pg_namespace'::regclass
      and dropped_schema.object_name=d.schema_name
    where d.classid in ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_namespace'::regclass)
      and d.object_type not in ('index','index column');
  else
    select array_agg(distinct coalesce(c.relnamespace,p.pronamespace,n.oid)) into v_schemas
    from pg_catalog.pg_event_trigger_ddl_commands() d
    left join pg_catalog.pg_class c on d.classid='pg_catalog.pg_class'::regclass and c.oid=d.objid
      and c.relkind in ('r','p','v','m','S','f')
    left join pg_catalog.pg_proc p on d.classid='pg_catalog.pg_proc'::regclass and p.oid=d.objid
    left join pg_catalog.pg_namespace n on d.classid='pg_catalog.pg_namespace'::regclass and n.oid=d.objid;
  end if;
  perform public.joy8_lock_product_ddl_schemas(array_remove(v_schemas,null));

  if tg_tag in ('GRANT','REVOKE') then
    v_relevant:=true;
  elsif exists(select 1 from public.joy8_product_schemas s
    where pg_catalog.to_regnamespace(s.schema_name::text) is null) then
    v_relevant:=true;
  elsif tg_event='sql_drop' then
    select exists(
      select 1 from pg_catalog.pg_event_trigger_dropped_objects() d
      where (d.classid='pg_catalog.pg_namespace'::regclass
        and exists(select 1 from public.joy8_product_schemas s where s.schema_name=d.object_name))
        or (d.classid='pg_catalog.pg_proc'::regclass
          and exists(select 1 from public.joy8_game_policies p where p.product_adapter::oid=d.objid))
        or (d.classid in ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass)
          and d.object_type not in ('index','index column')
          and exists(select 1 from public.joy8_product_schemas s where s.schema_name=d.schema_name))
    ) into v_relevant;
  else
    select exists(
      select 1 from pg_catalog.pg_event_trigger_ddl_commands() d
      left join pg_catalog.pg_class c on d.classid='pg_catalog.pg_class'::regclass and c.oid=d.objid
      left join pg_catalog.pg_namespace n on d.classid='pg_catalog.pg_namespace'::regclass and n.oid=d.objid
      where (d.classid='pg_catalog.pg_proc'::regclass
        and exists(select 1 from public.joy8_game_policies p where p.product_adapter::oid=d.objid))
        or ((d.classid='pg_catalog.pg_proc'::regclass or c.relkind in ('r','p','v','m','S','f'))
          and exists(select 1 from public.joy8_product_schemas s where s.schema_name=d.schema_name))
        or exists(select 1 from public.joy8_product_schemas s where s.schema_name=n.nspname)
        or (c.relkind in ('r','p') and d.schema_name in ('public','auth') and exists(
          select 1 from public.joy8_game_policies policy
          join pg_catalog.pg_proc adapter on adapter.oid=policy.product_adapter::oid
          where has_table_privilege(adapter.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
            or (c.relname<>'games' and has_table_privilege(adapter.proowner,c.oid,'SELECT'))
        ))
    ) into v_relevant;
  end if;
  if not v_relevant then return; end if;
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'JOY8_PRODUCT_DDL_REQUIRES_READ_COMMITTED' using errcode='40001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(75080003);
  insert into public.joy8_product_ddl_checks values(pg_catalog.pg_current_xact_id())
  on conflict do nothing;
end;
$$;



CREATE FUNCTION public.joy8_recovery_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'JOY8_RECOVERY_IMMUTABLE';
end;
$$;



CREATE FUNCTION public.joy8_reject_accounting_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'JOY8_ACCOUNTING_IMMUTABLE' using errcode='42501';
end;
$$;



CREATE FUNCTION public.joy8_resolve_branded_entry(p_game_slug text, p_origin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_entry record;
begin
  select g.id,g.name,e.launch_url into v_entry
  from public.games g
  join public.joy8_private_entries e on e.game_id=g.id
  where g.slug=btrim(p_game_slug) and e.enabled
    and e.entry_origin=p_origin
  for share of g,e;
  if not found then raise exception 'JOY8_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  return jsonb_build_object(
    'game_id',v_entry.id,
    'game_name',v_entry.name,
    'launch_url',v_entry.launch_url,
    'protocol','server-v1'
  );
end;
$$;



CREATE FUNCTION public.joy8_resolve_member(p_auth_user_id uuid, p_enroll boolean DEFAULT false) RETURNS TABLE(player_account_id uuid, account_type text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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



CREATE FUNCTION public.joy8_resolve_member_profile(p_auth_user_id uuid, p_enroll boolean DEFAULT false) RETURNS TABLE(player_account_id uuid, account_type text, public_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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



CREATE FUNCTION public.joy8_server_request_v1(p_route text, p_ingress_key text, p_ingress_limit integer, p_ingress_window integer, p_secret text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_admission jsonb;
  v_action text;
  v_result jsonb;
begin
  if not public.joy8_consume_gateway_rate_limit(p_ingress_key,p_ingress_limit,p_ingress_window) then
    return jsonb_build_object('limited',true,'retry_after',p_ingress_window);
  end if;
  if p_secret is null or p_request is null then
    return jsonb_build_object('precheck',true);
  end if;
  v_admission:=public.joy8_admit_gateway_request(p_route,p_request,p_secret,null);
  if v_admission ? 'error' then
    return jsonb_build_object('admission_error',v_admission->>'error');
  end if;
  if (v_admission->>'allowed')::boolean is distinct from true then
    return jsonb_build_object('limited',true,'retry_after',v_admission->'retry_after');
  end if;
  v_action:=substring(p_route from 8 for length(p_route)-10);
  begin
    if v_action in ('exchange','renew') then
      v_result:=public.joy8_server_session_v1(p_secret,v_action,p_request);
    elsif v_action='open' then
      if p_request ? 'settlement' then
        v_result:=public.joy8_open_with_settlement_v1(p_secret,p_request);
      else
        v_result:=public.joy8_open_match_v1(p_secret,p_request);
      end if;
    elsif v_action='settle' then
      v_result:=public.joy8_settle_match_v1(p_secret,p_request);
    elsif v_action in ('status','cancel') then
      v_result:=public.joy8_match_status_v1(p_secret,p_request,v_action='cancel');
    else
      return jsonb_build_object('admission_error','JOY8_INVALID_REQUEST');
    end if;
    if v_action in ('open','settle') then
      v_result:=v_result||public.joy8_match_available_points_v1((v_result->>'match_id')::uuid);
    end if;
  exception when others then
    return jsonb_build_object('error',jsonb_build_object('message',SQLERRM,'code',SQLSTATE));
  end;
  return jsonb_build_object('result',v_result);
end;
$$;



CREATE FUNCTION public.joy8_server_session_v1(p_secret text, p_action text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_game uuid;
  v_session public.game_sessions%rowtype;
  v_token text;
  v_expiry timestamptz;
begin
  if p_action not in ('exchange','renew') or jsonb_typeof(p_request) is distinct from 'object'
    or p_request->>'version' is distinct from '1'
    or (p_request-array['version','launch_code','session_id'])<>'{}'::jsonb then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_game:=public.joy8_backend_game(p_secret,p_action);
  if p_action='exchange' then
    if p_request?'session_id' or coalesce(p_request->>'launch_code','')!~'^[a-f0-9]{64}$' then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    select s.* into v_session from public.game_sessions s
    where s.launch_code_hash=public.joy8_hash_secret(p_request->>'launch_code') and s.game_id=v_game;
  else
    if p_request?'launch_code' then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
    select s.* into v_session from public.game_sessions s
    where s.id=(p_request->>'session_id')::uuid and s.game_id=v_game and s.launch_code_used_at is not null;
  end if;
  if not found then raise exception 'JOY8_SESSION_INVALID' using errcode='42501'; end if;
  perform public.joy8_assert_player(v_session.player_account_id);
  perform 1 from public.wallet_accounts w
    where w.id=v_session.wallet_account_id and w.status='active' for share;
  if not found then raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501'; end if;
  select s.* into v_session from public.game_sessions s where s.id=v_session.id for update;
  if v_session.status<>'active' or v_session.expires_at<=now()
    or (p_action='exchange' and (v_session.launch_code_used_at is not null or v_session.launch_code_expires_at<=now())) then
    raise exception 'JOY8_SESSION_INVALID' using errcode='42501';
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_expiry:=least(v_session.expires_at,now()+interval '15 minutes');
  update public.game_sessions set launch_code_used_at=coalesce(launch_code_used_at,now()),
    gateway_token_hash=public.joy8_hash_secret(v_token),gateway_token_expires_at=v_expiry,
    gateway_token_scopes=array['balance']::text[] where id=v_session.id;
  return jsonb_build_object('version',1,'session_id',v_session.id,'game_id',v_game,
    'player_account_ref',v_session.player_account_id,'account_type',v_session.account_type,
    'wallet_scope','platform','currency',v_session.currency,'gateway_token',v_token,
    'gateway_token_expires_at',v_expiry,'expires_at',v_session.expires_at,
    'scopes',jsonb_build_array('balance'));
end;
$_$;



CREATE FUNCTION public.joy8_settle_match_v1(p_secret text, p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_game uuid;
  v_match public.joy8_matches%rowtype;
  v_existing public.joy8_settlements%rowtype;
  v_part public.joy8_match_participants%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_item jsonb;
  v_amount numeric;
  v_total numeric:=0;
  v_platform numeric:=0;
  v_fee numeric:=0;
  v_hash text;
  v_id uuid:=gen_random_uuid();
  v_index integer:=0;
  v_result jsonb;
  v_product jsonb;
  v_next_products jsonb:='[]'::jsonb;
  v_next_reserve numeric;
  v_sequence integer;
  v_final boolean;
begin
  v_game:=public.joy8_backend_game(p_secret,'settle');
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'version' is distinct from '1'
    or (p_request-array['version','match_ref','rule_version','operation_key','entries','product_commit','settlement_no','final'])<>'{}'::jsonb
    or coalesce(length(p_request->>'match_ref'),0) not between 1 and 120
    or coalesce(length(p_request->>'operation_key'),0) not between 1 and 180
    or jsonb_typeof(p_request->'entries') is distinct from 'array'
    or jsonb_typeof(coalesce(p_request->'product_commit','{}'::jsonb)) is distinct from 'object' then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  if jsonb_typeof(p_request->'settlement_no') is distinct from 'number'
    or (p_request->>'settlement_no') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_request->'final') is distinct from 'boolean' then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_sequence:=(p_request->>'settlement_no')::integer;
  v_final:=(p_request->>'final')::boolean;
  if jsonb_array_length(p_request->'entries') not between 0 and 65 then
    raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
  end if;
  v_hash:=public.joy8_hash_secret(p_request::text);
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'match_ref'),1));
  perform pg_advisory_xact_lock(hashtextextended(v_game::text||':'||(p_request->>'operation_key'),2));
  select s.* into v_existing from public.joy8_settlements s
    where s.game_id=v_game and s.operation_key=p_request->>'operation_key';
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'JOY8_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return v_existing.result;
  end if;
  select m.* into v_match from public.joy8_matches m
    where m.game_id=v_game and m.match_ref=p_request->>'match_ref' for update;
  if not found then raise exception 'JOY8_MATCH_NOT_FOUND' using errcode='P0002'; end if;
  if v_match.state<>'open' then raise exception 'JOY8_MATCH_FINALIZED' using errcode='55000'; end if;
  if v_sequence<>v_match.settlement_count+1 then
    raise exception 'JOY8_SETTLEMENT_SEQUENCE' using errcode='55000';
  end if;
  if p_request->>'rule_version' is distinct from v_match.rule_version then
    raise exception 'JOY8_RULE_MISMATCH' using errcode='22023';
  end if;
  if (select count(distinct (value->>'kind',value->>'account_ref')) from jsonb_array_elements(p_request->'entries'))
    <>jsonb_array_length(p_request->'entries') then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_request->'entries') loop
    if jsonb_typeof(v_item)<>'object' or (v_item-array['kind','account_ref','amount','source'])<>'{}'::jsonb
      or coalesce(v_item->>'kind','') not in ('player','product','fee')
      or coalesce(length(v_item->>'account_ref'),0) not between 1 and 120 then
      raise exception 'JOY8_INVALID_REQUEST' using errcode='22023';
    end if;
    v_amount:=public.joy8_point_amount(v_item->'amount');
    if v_amount=0 or abs(v_amount)>v_match.max_payout_amount then
      raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023';
    end if;
    if v_item->>'kind'='fee' then
      if v_amount<0 or v_item->>'source' is distinct from 'fee' or v_item->>'account_ref'<>v_game::text then
        raise exception 'JOY8_INVALID_ENTRY' using errcode='22023';
      end if;
      v_fee:=v_fee+v_amount;
    else
      if v_item->>'source' is distinct from 'gameplay' then raise exception 'JOY8_INVALID_ENTRY' using errcode='22023'; end if;
      if v_item->>'kind'='player' then
        if v_item->>'account_ref' is distinct from ((v_item->>'account_ref')::uuid)::text then
          raise exception 'JOY8_INVALID_ENTRY' using errcode='22023';
        end if;
        select p.* into v_part from public.joy8_match_participants p
          where p.match_id=v_match.id and p.player_account_id=(v_item->>'account_ref')::uuid;
        if not found or v_part.released_at is not null or -v_amount>v_part.reserved_amount then
          raise exception 'JOY8_INVALID_ENTRY' using errcode='22023';
        end if;
        if v_match.funding_mode='platform' and v_part.reserved_amount+v_amount>v_match.max_payout_amount then
          raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023';
        end if;
      else
        select value into v_product from jsonb_array_elements(v_match.product_participants)
          where value->>'account_ref'=v_item->>'account_ref';
        if not found or -v_amount>public.joy8_point_amount(v_product->'reserve') then
          raise exception 'JOY8_INVALID_ENTRY' using errcode='22023';
        end if;
      end if;
    end if;
    v_total:=v_total+v_amount;
  end loop;
  if v_match.funding_mode='participants' and v_total<>0 then
    raise exception 'JOY8_UNBALANCED_SETTLEMENT' using errcode='22023';
  elsif v_match.funding_mode='platform' then
    v_platform:=-v_total;
    if abs(v_platform)>v_match.max_payout_amount then
      raise exception 'JOY8_LIMIT_EXCEEDED' using errcode='22023';
    end if;
  end if;
  perform w.id from public.wallet_accounts w join public.joy8_match_participants p on p.wallet_account_id=w.id
    where p.match_id=v_match.id order by w.id for update of w;
  for v_part in select * from public.joy8_match_participants where match_id=v_match.id order by wallet_account_id loop
    select w.* into v_wallet from public.wallet_accounts w where w.id=v_part.wallet_account_id;
    if v_wallet.status<>'active'
      or v_wallet.wallet_policy_id<>v_match.wallet_policy_id or v_part.released_at is not null
      or v_wallet.locked_balance<v_part.reserved_amount then
      raise exception 'JOY8_WALLET_INACTIVE' using errcode='42501';
    end if;
    select public.joy8_point_amount(value->'amount') into v_amount from jsonb_array_elements(p_request->'entries')
      where value->>'kind'='player' and value->>'account_ref'=v_part.player_account_id::text;
    v_amount:=coalesce(v_amount,0);
    if v_wallet.balance+v_amount<0 then raise exception 'JOY8_INSUFFICIENT_BALANCE' using errcode='22003'; end if;
    v_next_reserve:=case when v_final then 0 else v_part.reserved_amount+v_amount end;
    update public.wallet_accounts set balance=balance+v_amount,
      locked_balance=locked_balance-v_part.reserved_amount+v_next_reserve,updated_at=now() where id=v_wallet.id;
    if not v_final then
      update public.joy8_match_participants set reserved_amount=v_next_reserve
        where match_id=v_match.id and player_account_id=v_part.player_account_id;
    end if;
    if v_amount<>0 then
      insert into public.wallet_transactions(wallet_account_id,type,amount,balance_before,balance_after,
        game_id,match_ref,game_session_id,idempotency_key,source_type,source_ref)
      values(v_wallet.id,case when v_amount<0 then 'bet' else 'payout' end,abs(v_amount),v_wallet.balance,
        v_wallet.balance+v_amount,v_game,v_match.match_ref,v_part.game_session_id,
        'settlement:'||v_id::text||':'||v_wallet.id::text,'gameplay',v_id::text);
    end if;
  end loop;
  for v_product in select value from jsonb_array_elements(v_match.product_participants) loop
    select public.joy8_point_amount(value->'amount') into v_amount from jsonb_array_elements(p_request->'entries')
      where value->>'kind'='product' and value->>'account_ref'=v_product->>'account_ref';
    v_next_reserve:=case when v_final then 0 else public.joy8_point_amount(v_product->'reserve')+coalesce(v_amount,0) end;
    v_next_products:=v_next_products||jsonb_build_array(jsonb_build_object(
      'account_ref',v_product->>'account_ref','reserve',v_next_reserve::text));
  end loop;
  if v_fee>0 then
    insert into public.joy8_fee_accounts(game_id,balance) values(v_game,v_fee)
      on conflict(game_id) do update set balance=public.joy8_fee_accounts.balance+excluded.balance;
  end if;
  if v_match.product_adapter is not null then
    perform public.joy8_product_adapter(v_match.product_adapter,'settle',v_match.id,
      jsonb_build_object('version',1,'game_id',v_game,'settlement_id',v_id,'request_hash',v_hash,'request',p_request,'next_product_participants',v_next_products));
  elsif coalesce(p_request->'product_commit','{}'::jsonb)<>'{}'::jsonb then
    raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501';
  end if;
  v_result:=jsonb_build_object('version',1,'settlement_id',v_id,'match_id',v_match.id,
    'state',case when v_final then 'settled' else 'open' end,'settlement_no',v_sequence,
    'final',v_final,'request_hash',v_hash,'settled_at',now());
  insert into public.joy8_settlements(id,match_id,game_id,operation_key,request_hash,result,settlement_no)
    values(v_id,v_match.id,v_game,p_request->>'operation_key',v_hash,v_result,v_sequence);
  for v_item in select value from jsonb_array_elements(p_request->'entries') loop
    insert into public.joy8_settlement_entries(settlement_id,entry_index,kind,account_ref,amount,source_type)
    values(v_id,v_index,v_item->>'kind',v_item->>'account_ref',public.joy8_point_amount(v_item->'amount'),v_item->>'source');
    v_index:=v_index+1;
  end loop;
  if v_platform<>0 then
    insert into public.joy8_settlement_entries(settlement_id,entry_index,kind,account_ref,amount,source_type)
    values(v_id,v_index,'platform',v_game::text,v_platform,'gameplay');
  end if;
  if v_final then
    update public.joy8_match_participants set released_at=now() where match_id=v_match.id;
  end if;
  update public.joy8_matches set state=case when v_final then 'settled' else 'open' end,
    finalized_at=case when v_final then now() else null end,result=v_result,
    settlement_count=v_sequence,
    product_participants=case when v_final then product_participants else v_next_products end where id=v_match.id;
  return v_result;
end;
$_$;



CREATE FUNCTION public.joy8_validate_product_adapter(p_adapter regprocedure) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner oid; v_schema oid;
begin
  select candidate.proowner,candidate_namespace.oid into v_owner,v_schema
  from pg_catalog.pg_proc candidate
  join pg_catalog.pg_namespace candidate_namespace on candidate_namespace.oid=candidate.pronamespace
  join public.joy8_product_schemas registered on registered.schema_name=candidate_namespace.nspname
  where candidate.oid=p_adapter::oid and candidate.proargtypes='25 2950 3802'::oidvector
    and candidate.prokind='f' and candidate.prorettype='jsonb'::regtype
    and not candidate.proretset and candidate.prosecdef
    and candidate.proconfig @> array['search_path=""']::text[]
    and not exists(select 1 from pg_catalog.pg_roles r where r.oid=candidate.proowner and (r.rolsuper or r.rolbypassrls))
    and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname in ('public','auth') and c.relkind in ('r','p')
        and (has_table_privilege(candidate.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          or (c.relname<>'games' and has_table_privilege(candidate.proowner,c.oid,'SELECT'))));
  if not found then raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
  if not exists(
    select 1 from public.joy8_product_schemas s
    join pg_catalog.pg_namespace n on n.nspname=s.schema_name where n.oid<>v_schema
  ) then return; end if;
  if exists(
      select 1 from public.joy8_product_schemas s
      join pg_catalog.pg_namespace n on n.nspname=s.schema_name
      where n.oid<>v_schema
        and has_schema_privilege(v_owner,n.oid,'CREATE')
    )
    or exists(
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join public.joy8_product_schemas s on s.schema_name=n.nspname
      where n.oid<>v_schema and (
        (c.relkind in ('r','p','v','m')
          and has_table_privilege(v_owner,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))
        or (c.relkind='S' and has_sequence_privilege(v_owner,c.oid,'USAGE,SELECT,UPDATE'))
      )
    )
    or exists(
      select 1 from pg_catalog.pg_proc f
      join pg_catalog.pg_namespace n on n.oid=f.pronamespace
      join public.joy8_product_schemas s on s.schema_name=n.nspname
      where n.oid<>v_schema
        and has_function_privilege(v_owner,f.oid,'EXECUTE')
    ) then raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
end;
$$;



CREATE FUNCTION public.joy8_validate_product_adapters() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_adapter regprocedure;
begin
  if exists(select 1 from public.joy8_product_schemas s
    where pg_catalog.to_regnamespace(s.schema_name::text) is null) then
    raise exception 'JOY8_PRODUCT_SCHEMA_UNAVAILABLE' using errcode='42501';
  end if;
  for v_adapter in select distinct product_adapter from public.joy8_game_policies where product_adapter is not null loop
    perform public.joy8_validate_product_adapter(v_adapter);
  end loop;
end;
$$;



CREATE FUNCTION public.wallet_get_balance(p_gateway_token text) RETURNS TABLE(session_id uuid, player_account_id uuid, wallet_account_id uuid, currency text, balance numeric, locked_balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_session record;
begin
  select * into v_session from public.joy8_active_session(p_gateway_token,'balance');
  if not found then raise exception 'game session is not active' using errcode='P0002'; end if;
  return query select v_session.session_id,v_session.player_account_id,w.id,w.currency,
    w.balance-w.locked_balance,w.locked_balance
    from public.wallet_accounts w where w.id=v_session.wallet_account_id and w.status='active';
end;
$$;



CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);



CREATE TABLE public.game_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_account_id uuid NOT NULL,
    wallet_account_id uuid NOT NULL,
    game_id uuid NOT NULL,
    launch_code_hash text NOT NULL,
    account_type text NOT NULL,
    currency text DEFAULT 'POINT'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    launch_code_expires_at timestamp with time zone NOT NULL,
    launch_code_used_at timestamp with time zone,
    gateway_token_hash text,
    gateway_token_expires_at timestamp with time zone,
    gateway_token_scopes text[] DEFAULT ARRAY['balance'::text, 'bet'::text, 'payout'::text, 'refund'::text, 'close-round'::text] NOT NULL,
    CONSTRAINT game_sessions_account_type_check CHECK ((account_type = 'registered'::text)),
    CONSTRAINT game_sessions_currency_check CHECK ((btrim(currency) <> ''::text)),
    CONSTRAINT game_sessions_gateway_token_pair_check CHECK (((gateway_token_hash IS NULL) = (gateway_token_expires_at IS NULL))),
    CONSTRAINT game_sessions_gateway_token_scopes_check CHECK ((cardinality(gateway_token_scopes) > 0)),
    CONSTRAINT game_sessions_launch_token_hash_check CHECK ((btrim(launch_code_hash) <> ''::text)),
    CONSTRAINT game_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'expired'::text, 'revoked'::text])))
);



CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    thumbnail text,
    type text NOT NULL,
    published boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    launch_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT games_type_check CHECK ((type = ANY (ARRAY['slot'::text, 'fish'::text, 'card'::text, 'arcade'::text, 'casual'::text, 'adult'::text])))
);



CREATE TABLE public.gateway_rate_limits (
    bucket_key_hash text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    request_count integer DEFAULT 1 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gateway_rate_limits_bucket_key_hash_check CHECK ((btrim(bucket_key_hash) <> ''::text)),
    CONSTRAINT gateway_rate_limits_request_count_check CHECK ((request_count > 0))
);



CREATE TABLE public.joy8_backend_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    key_hash text NOT NULL,
    scopes text[] NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT joy8_backend_keys_key_hash_check CHECK ((length(key_hash) = 64)),
    CONSTRAINT joy8_backend_keys_scopes_check CHECK (((cardinality(scopes) > 0) AND (scopes <@ ARRAY['exchange'::text, 'renew'::text, 'open'::text, 'settle'::text, 'status'::text, 'cancel'::text])))
);



CREATE TABLE public.joy8_email_allowlist (
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT joy8_email_allowlist_email_check CHECK (((email = lower(btrim(email))) AND (length(email) <= 254) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text)))
);



CREATE TABLE public.joy8_fee_accounts (
    game_id uuid NOT NULL,
    balance numeric(18,2) DEFAULT 0 NOT NULL,
    CONSTRAINT joy8_fee_accounts_balance_check CHECK ((balance >= (0)::numeric))
);



CREATE TABLE public.joy8_game_policies (
    game_id uuid NOT NULL,
    wallet_policy_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    max_payout_amount numeric(18,2) NOT NULL,
    max_participants integer DEFAULT 16 NOT NULL,
    product_adapter regprocedure,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    max_bet_amount numeric(18,2) NOT NULL,
    funding_mode text DEFAULT 'participants'::text NOT NULL,
    reservation_mode text DEFAULT 'capped'::text NOT NULL,
    max_reserve_amount numeric(18,2),
    min_bet_amount numeric(18,2) DEFAULT 1 NOT NULL,
    CONSTRAINT joy8_game_policies_funding_mode_check CHECK ((funding_mode = ANY (ARRAY['participants'::text, 'platform'::text]))),
    CONSTRAINT joy8_game_policies_max_bet_amount_check CHECK ((max_bet_amount > (0)::numeric)),
    CONSTRAINT joy8_game_policies_max_bet_cap_check CHECK ((max_bet_amount <= (10000)::numeric)),
    CONSTRAINT joy8_game_policies_max_participants_check CHECK (((max_participants >= 1) AND (max_participants <= 64))),
    CONSTRAINT joy8_game_policies_max_payout_amount_check CHECK ((max_payout_amount > (0)::numeric)),
    CONSTRAINT joy8_game_policies_max_reserve_amount_check CHECK (((max_reserve_amount IS NULL) OR (max_reserve_amount > (0)::numeric))),
    CONSTRAINT joy8_game_policies_min_bet_amount_check CHECK ((min_bet_amount > (0)::numeric)),
    CONSTRAINT joy8_game_policies_min_bet_range_check CHECK (((reservation_mode = 'full_balance'::text) OR (min_bet_amount <= max_bet_amount))),
    CONSTRAINT joy8_game_policies_platform_adapter_check CHECK (((funding_mode <> 'platform'::text) OR (product_adapter IS NULL))),
    CONSTRAINT joy8_game_policies_reservation_config_check CHECK ((((reservation_mode = 'capped'::text) AND (max_reserve_amount IS NULL)) OR ((reservation_mode = 'full_balance'::text) AND (funding_mode = 'participants'::text) AND (product_adapter IS NOT NULL)))),
    CONSTRAINT joy8_game_policies_reservation_mode_check CHECK ((reservation_mode = ANY (ARRAY['capped'::text, 'full_balance'::text])))
);



CREATE TABLE public.joy8_mail_messages (
    id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    status text DEFAULT 'draft'::text NOT NULL,
    request jsonb NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    audience text NOT NULL,
    game_id uuid,
    source_ref text DEFAULT ''::text NOT NULL,
    amount numeric(18,2) DEFAULT 0 NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT joy8_mail_messages_amount_check CHECK (((amount >= (0)::numeric) AND (amount = trunc(amount)))),
    CONSTRAINT joy8_mail_messages_audience_check CHECK ((audience = ANY (ARRAY['all'::text, 'game'::text, 'player'::text]))),
    CONSTRAINT joy8_mail_messages_body_check CHECK (((length(body) >= 1) AND (length(body) <= 3000))),
    CONSTRAINT joy8_mail_messages_check CHECK ((((kind = ANY (ARRAY['reward'::text, 'compensation'::text])) AND (amount > (0)::numeric) AND ((length(source_ref) >= 1) AND (length(source_ref) <= 200))) OR ((kind = ANY (ARRAY['announcement'::text, 'notification'::text])) AND (amount = (0)::numeric)))),
    CONSTRAINT joy8_mail_messages_check1 CHECK (((status = 'sent'::text) = (sent_at IS NOT NULL))),
    CONSTRAINT joy8_mail_messages_kind_check CHECK ((kind = ANY (ARRAY['announcement'::text, 'notification'::text, 'reward'::text, 'compensation'::text]))),
    CONSTRAINT joy8_mail_messages_recipient_count_check CHECK (((recipient_count >= 0) AND (recipient_count <= 5000))),
    CONSTRAINT joy8_mail_messages_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'cancelled'::text]))),
    CONSTRAINT joy8_mail_messages_title_check CHECK (((length(title) >= 1) AND (length(title) <= 120)))
);



CREATE TABLE public.joy8_mail_recipients (
    message_id uuid NOT NULL,
    player_account_id uuid NOT NULL,
    read_at timestamp with time zone,
    claimed_at timestamp with time zone,
    transaction_id uuid,
    CONSTRAINT joy8_mail_recipients_check CHECK (((claimed_at IS NULL) = (transaction_id IS NULL))),
    CONSTRAINT joy8_mail_recipients_check1 CHECK (((claimed_at IS NULL) OR (read_at IS NOT NULL)))
);



CREATE TABLE public.joy8_match_participants (
    match_id uuid NOT NULL,
    player_account_id uuid NOT NULL,
    wallet_account_id uuid NOT NULL,
    game_session_id uuid NOT NULL,
    reserved_amount numeric(18,2) NOT NULL,
    released_at timestamp with time zone,
    CONSTRAINT joy8_match_participants_reserved_amount_check CHECK ((reserved_amount >= (0)::numeric))
);



CREATE TABLE public.joy8_match_recoveries (
    match_id uuid NOT NULL,
    settlement_count integer NOT NULL,
    reason text NOT NULL,
    evidence_ref text NOT NULL,
    operator_name text DEFAULT SESSION_USER NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT joy8_match_recoveries_evidence_ref_check CHECK (((length(evidence_ref) >= 10) AND (length(evidence_ref) <= 1000))),
    CONSTRAINT joy8_match_recoveries_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 1000)))
);



CREATE TABLE public.joy8_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    match_ref text NOT NULL,
    rule_version text NOT NULL,
    open_hash text NOT NULL,
    wallet_policy_id uuid NOT NULL,
    max_payout_amount numeric(18,2) NOT NULL,
    product_adapter regprocedure,
    product_participants jsonb DEFAULT '[]'::jsonb NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_at timestamp with time zone,
    result jsonb,
    settlement_count integer DEFAULT 0 NOT NULL,
    max_bet_amount numeric(18,2) NOT NULL,
    funding_mode text NOT NULL,
    reservation_mode text DEFAULT 'capped'::text NOT NULL,
    max_reserve_amount numeric(18,2),
    CONSTRAINT joy8_matches_funding_mode_check CHECK ((funding_mode = ANY (ARRAY['participants'::text, 'platform'::text]))),
    CONSTRAINT joy8_matches_match_ref_check CHECK (((length(match_ref) >= 1) AND (length(match_ref) <= 120))),
    CONSTRAINT joy8_matches_max_bet_amount_check CHECK ((max_bet_amount > (0)::numeric)),
    CONSTRAINT joy8_matches_max_bet_cap_check CHECK ((max_bet_amount <= (10000)::numeric)),
    CONSTRAINT joy8_matches_max_payout_amount_check CHECK ((max_payout_amount > (0)::numeric)),
    CONSTRAINT joy8_matches_max_reserve_amount_check CHECK (((max_reserve_amount IS NULL) OR (max_reserve_amount > (0)::numeric))),
    CONSTRAINT joy8_matches_platform_products_check CHECK (((funding_mode <> 'platform'::text) OR (product_participants = '[]'::jsonb))),
    CONSTRAINT joy8_matches_reservation_config_check CHECK ((((reservation_mode = 'capped'::text) AND (max_reserve_amount IS NULL)) OR ((reservation_mode = 'full_balance'::text) AND (funding_mode = 'participants'::text) AND (product_adapter IS NOT NULL)))),
    CONSTRAINT joy8_matches_reservation_mode_check CHECK ((reservation_mode = ANY (ARRAY['capped'::text, 'full_balance'::text]))),
    CONSTRAINT joy8_matches_rule_version_check CHECK (((length(rule_version) >= 1) AND (length(rule_version) <= 80))),
    CONSTRAINT joy8_matches_settlement_count_check CHECK ((settlement_count >= 0)),
    CONSTRAINT joy8_matches_state_check CHECK ((state = ANY (ARRAY['open'::text, 'settled'::text, 'cancelled'::text])))
);



CREATE TABLE public.joy8_private_entries (
    game_id uuid NOT NULL,
    entry_origin text NOT NULL,
    launch_url text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT joy8_private_entries_check CHECK (((launch_url <> 'http://localhost:4391/'::text) OR (entry_origin = 'http://localhost:5173'::text))),
    CONSTRAINT joy8_private_entries_entry_origin_check CHECK (((entry_origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'::text) OR (entry_origin = 'http://localhost:5173'::text))),
    CONSTRAINT joy8_private_entries_launch_url_check CHECK (((launch_url ~ '^https://'::text) OR (launch_url = 'http://localhost:4391/'::text)))
);



CREATE TABLE public.joy8_product_ddl_checks (
    transaction_id xid8 NOT NULL
);



CREATE TABLE public.joy8_product_schemas (
    schema_name name NOT NULL,
    CONSTRAINT joy8_product_schemas_schema_name_check CHECK ((((schema_name)::text !~ '^pg_'::text) AND (schema_name <> ALL (ARRAY['public'::name, 'auth'::name, 'extensions'::name, 'information_schema'::name, 'storage'::name, 'realtime'::name, 'vault'::name, 'supabase_functions'::name]))))
);



CREATE TABLE public.joy8_settlement_entries (
    settlement_id uuid NOT NULL,
    entry_index integer NOT NULL,
    kind text NOT NULL,
    account_ref text NOT NULL,
    amount numeric(18,2) NOT NULL,
    source_type text NOT NULL,
    CONSTRAINT joy8_settlement_entries_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT joy8_settlement_entries_kind_check CHECK ((kind = ANY (ARRAY['player'::text, 'product'::text, 'fee'::text, 'platform'::text]))),
    CONSTRAINT joy8_settlement_entries_source_type_check CHECK ((source_type = ANY (ARRAY['gameplay'::text, 'fee'::text])))
);



CREATE TABLE public.joy8_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_id uuid NOT NULL,
    game_id uuid NOT NULL,
    operation_key text NOT NULL,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settlement_no integer NOT NULL,
    CONSTRAINT joy8_settlements_operation_key_check CHECK (((length(operation_key) >= 1) AND (length(operation_key) <= 180))),
    CONSTRAINT joy8_settlements_settlement_no_check CHECK ((settlement_no > 0))
);



CREATE TABLE public.joy8_wallet_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    currency text DEFAULT 'POINT'::text NOT NULL,
    initial_credit numeric(18,2) DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT joy8_wallet_policies_currency_check CHECK ((currency = 'POINT'::text)),
    CONSTRAINT joy8_wallet_policies_initial_credit_check CHECK ((initial_credit >= (0)::numeric))
);



CREATE TABLE public.player_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid,
    account_type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    member_enrolled_at timestamp with time zone,
    public_id text DEFAULT public.joy8_allocate_public_player_id() NOT NULL,
    CONSTRAINT player_accounts_account_type_check CHECK ((account_type = 'registered'::text)),
    CONSTRAINT player_accounts_check CHECK (((account_type <> 'registered'::text) OR (auth_user_id IS NOT NULL))),
    CONSTRAINT player_accounts_public_id_format CHECK ((public_id ~ '^[1-9][0-9]{5}$'::text)),
    CONSTRAINT player_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text])))
);



CREATE VIEW public.public_games_v1 WITH (security_invoker='true', security_barrier='true') AS
 SELECT id,
    slug,
    name,
    type,
    thumbnail,
    created_at,
    launch_url,
    sort_order
   FROM public.joy8_public_games_v1() joy8_public_games_v1(id, slug, name, type, thumbnail, created_at, launch_url, sort_order);



CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_account_id uuid NOT NULL,
    type text NOT NULL,
    amount numeric(18,2) NOT NULL,
    balance_before numeric(18,2) NOT NULL,
    balance_after numeric(18,2) NOT NULL,
    game_id uuid,
    match_ref text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    game_session_id uuid,
    source_type text,
    source_ref text,
    CONSTRAINT wallet_transactions_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT wallet_transactions_game_source_check CHECK (((game_id IS NOT NULL) OR (source_type = ANY (ARRAY['initial_grant'::text, 'registration_grant'::text])) OR ((source_type = ANY (ARRAY['mail_reward'::text, 'mail_compensation'::text])) AND (type = 'adjustment'::text) AND (amount > (0)::numeric)))),
    CONSTRAINT wallet_transactions_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text)),
    CONSTRAINT wallet_transactions_type_check CHECK ((type = ANY (ARRAY['deposit'::text, 'withdraw'::text, 'bet'::text, 'payout'::text, 'refund'::text, 'adjustment'::text])))
);



ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);



ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_launch_token_hash_key UNIQUE (launch_code_hash);



ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_slug_key UNIQUE (slug);



ALTER TABLE ONLY public.gateway_rate_limits
    ADD CONSTRAINT gateway_rate_limits_pkey PRIMARY KEY (bucket_key_hash, window_started_at);



ALTER TABLE ONLY public.joy8_backend_keys
    ADD CONSTRAINT joy8_backend_keys_key_hash_key UNIQUE (key_hash);



ALTER TABLE ONLY public.joy8_backend_keys
    ADD CONSTRAINT joy8_backend_keys_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.joy8_email_allowlist
    ADD CONSTRAINT joy8_email_allowlist_pkey PRIMARY KEY (email);



ALTER TABLE ONLY public.joy8_fee_accounts
    ADD CONSTRAINT joy8_fee_accounts_pkey PRIMARY KEY (game_id);



ALTER TABLE ONLY public.joy8_game_policies
    ADD CONSTRAINT joy8_game_policies_pkey PRIMARY KEY (game_id);



ALTER TABLE ONLY public.joy8_mail_messages
    ADD CONSTRAINT joy8_mail_messages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.joy8_mail_recipients
    ADD CONSTRAINT joy8_mail_recipients_pkey PRIMARY KEY (message_id, player_account_id);



ALTER TABLE ONLY public.joy8_mail_recipients
    ADD CONSTRAINT joy8_mail_recipients_transaction_id_key UNIQUE (transaction_id);



ALTER TABLE ONLY public.joy8_match_participants
    ADD CONSTRAINT joy8_match_participants_match_id_wallet_account_id_key UNIQUE (match_id, wallet_account_id);



ALTER TABLE ONLY public.joy8_match_participants
    ADD CONSTRAINT joy8_match_participants_pkey PRIMARY KEY (match_id, player_account_id);



ALTER TABLE ONLY public.joy8_match_recoveries
    ADD CONSTRAINT joy8_match_recoveries_pkey PRIMARY KEY (match_id);



ALTER TABLE ONLY public.joy8_matches
    ADD CONSTRAINT joy8_matches_game_id_match_ref_key UNIQUE (game_id, match_ref);



ALTER TABLE ONLY public.joy8_matches
    ADD CONSTRAINT joy8_matches_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.joy8_private_entries
    ADD CONSTRAINT joy8_private_entries_pkey PRIMARY KEY (game_id);



ALTER TABLE ONLY public.joy8_product_ddl_checks
    ADD CONSTRAINT joy8_product_ddl_checks_pkey PRIMARY KEY (transaction_id);



ALTER TABLE ONLY public.joy8_product_schemas
    ADD CONSTRAINT joy8_product_schemas_pkey PRIMARY KEY (schema_name);



ALTER TABLE ONLY public.joy8_settlement_entries
    ADD CONSTRAINT joy8_settlement_entries_pkey PRIMARY KEY (settlement_id, entry_index);



ALTER TABLE ONLY public.joy8_settlements
    ADD CONSTRAINT joy8_settlements_game_id_operation_key_key UNIQUE (game_id, operation_key);



ALTER TABLE ONLY public.joy8_settlements
    ADD CONSTRAINT joy8_settlements_match_id_settlement_no_key UNIQUE (match_id, settlement_no);



ALTER TABLE ONLY public.joy8_settlements
    ADD CONSTRAINT joy8_settlements_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.joy8_wallet_policies
    ADD CONSTRAINT joy8_wallet_policies_currency_key UNIQUE (currency);



ALTER TABLE ONLY public.joy8_wallet_policies
    ADD CONSTRAINT joy8_wallet_policies_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.player_accounts
    ADD CONSTRAINT player_accounts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.player_accounts
    ADD CONSTRAINT player_accounts_public_id_key UNIQUE (public_id);



ALTER TABLE ONLY public.wallet_accounts
    ADD CONSTRAINT wallet_accounts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_idempotency_key_key UNIQUE (idempotency_key);



ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);



CREATE INDEX game_sessions_game_id_idx ON public.game_sessions USING btree (game_id);



CREATE INDEX game_sessions_game_launch_code_idx ON public.game_sessions USING btree (game_id, launch_code_hash) WHERE (launch_code_hash IS NOT NULL);



CREATE UNIQUE INDEX game_sessions_gateway_token_hash_key ON public.game_sessions USING btree (gateway_token_hash) WHERE (gateway_token_hash IS NOT NULL);



CREATE INDEX game_sessions_player_account_id_idx ON public.game_sessions USING btree (player_account_id);



CREATE INDEX joy8_mail_created ON public.joy8_mail_messages USING btree (created_at DESC, id DESC);



CREATE INDEX joy8_mail_recipient_player ON public.joy8_mail_recipients USING btree (player_account_id, message_id);



CREATE INDEX joy8_mail_sent ON public.joy8_mail_messages USING btree (sent_at DESC, id DESC) WHERE (status = 'sent'::text);



CREATE UNIQUE INDEX joy8_one_active_match_per_wallet ON public.joy8_match_participants USING btree (wallet_account_id) WHERE (released_at IS NULL);



CREATE UNIQUE INDEX player_accounts_auth_user_id_key ON public.player_accounts USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);



CREATE UNIQUE INDEX wallet_accounts_identity_key ON public.wallet_accounts USING btree (player_account_id, currency);



CREATE INDEX wallet_transactions_game_match_idx ON public.wallet_transactions USING btree (game_id, match_ref);



CREATE INDEX wallet_transactions_game_session_id_idx ON public.wallet_transactions USING btree (game_session_id);



CREATE INDEX wallet_transactions_wallet_account_id_idx ON public.wallet_transactions USING btree (wallet_account_id);



CREATE TRIGGER joy8_mail_message_history BEFORE DELETE OR UPDATE ON public.joy8_mail_messages FOR EACH ROW EXECUTE FUNCTION public.joy8_guard_mail_history();



CREATE TRIGGER joy8_mail_recipient_history BEFORE DELETE OR UPDATE ON public.joy8_mail_recipients FOR EACH ROW EXECUTE FUNCTION public.joy8_guard_mail_history();



CREATE TRIGGER joy8_product_adapter_registration AFTER INSERT OR DELETE OR UPDATE ON public.joy8_game_policies FOR EACH STATEMENT EXECUTE FUNCTION public.joy8_check_product_registration();



CREATE CONSTRAINT TRIGGER joy8_product_ddl_check AFTER INSERT ON public.joy8_product_ddl_checks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.joy8_check_product_ddl();



CREATE TRIGGER joy8_product_schema_registration AFTER INSERT OR DELETE OR UPDATE ON public.joy8_product_schemas FOR EACH STATEMENT EXECUTE FUNCTION public.joy8_check_product_registration();



CREATE TRIGGER joy8_recovery_immutable BEFORE DELETE OR UPDATE ON public.joy8_match_recoveries FOR EACH ROW EXECUTE FUNCTION public.joy8_recovery_immutable();



CREATE TRIGGER joy8_settlement_entries_immutable BEFORE DELETE OR UPDATE ON public.joy8_settlement_entries FOR EACH ROW EXECUTE FUNCTION public.joy8_reject_accounting_change();



CREATE TRIGGER joy8_settlements_immutable BEFORE DELETE OR UPDATE ON public.joy8_settlements FOR EACH ROW EXECUTE FUNCTION public.joy8_reject_accounting_change();



CREATE TRIGGER joy8_wallet_transactions_immutable BEFORE DELETE OR UPDATE ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.joy8_reject_accounting_change();



CREATE TRIGGER player_play_access BEFORE INSERT ON public.player_accounts FOR EACH ROW EXECUTE FUNCTION public.joy8_guard_play_access();



CREATE TRIGGER protect_admin_allowlist BEFORE DELETE OR UPDATE ON public.joy8_email_allowlist FOR EACH ROW EXECUTE FUNCTION public.joy8_protect_admin_allowlist();



CREATE TRIGGER session_play_access BEFORE INSERT ON public.game_sessions FOR EACH ROW EXECUTE FUNCTION public.joy8_guard_play_access();



ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_player_account_id_fkey FOREIGN KEY (player_account_id) REFERENCES public.player_accounts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_wallet_account_id_fkey FOREIGN KEY (wallet_account_id) REFERENCES public.wallet_accounts(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_backend_keys
    ADD CONSTRAINT joy8_backend_keys_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_fee_accounts
    ADD CONSTRAINT joy8_fee_accounts_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_game_policies
    ADD CONSTRAINT joy8_game_policies_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_game_policies
    ADD CONSTRAINT joy8_game_policies_wallet_policy_id_fkey FOREIGN KEY (wallet_policy_id) REFERENCES public.joy8_wallet_policies(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_mail_messages
    ADD CONSTRAINT joy8_mail_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);



ALTER TABLE ONLY public.joy8_mail_messages
    ADD CONSTRAINT joy8_mail_messages_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);



ALTER TABLE ONLY public.joy8_mail_recipients
    ADD CONSTRAINT joy8_mail_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.joy8_mail_messages(id);



ALTER TABLE ONLY public.joy8_mail_recipients
    ADD CONSTRAINT joy8_mail_recipients_player_account_id_fkey FOREIGN KEY (player_account_id) REFERENCES public.player_accounts(id);



ALTER TABLE ONLY public.joy8_mail_recipients
    ADD CONSTRAINT joy8_mail_recipients_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.wallet_transactions(id);



ALTER TABLE ONLY public.joy8_match_participants
    ADD CONSTRAINT joy8_match_participants_game_session_id_fkey FOREIGN KEY (game_session_id) REFERENCES public.game_sessions(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_match_participants
    ADD CONSTRAINT joy8_match_participants_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.joy8_matches(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_match_participants
    ADD CONSTRAINT joy8_match_participants_player_account_id_fkey FOREIGN KEY (player_account_id) REFERENCES public.player_accounts(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_match_participants
    ADD CONSTRAINT joy8_match_participants_wallet_account_id_fkey FOREIGN KEY (wallet_account_id) REFERENCES public.wallet_accounts(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_match_recoveries
    ADD CONSTRAINT joy8_match_recoveries_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.joy8_matches(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_matches
    ADD CONSTRAINT joy8_matches_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_matches
    ADD CONSTRAINT joy8_matches_wallet_policy_id_fkey FOREIGN KEY (wallet_policy_id) REFERENCES public.joy8_wallet_policies(id);



ALTER TABLE ONLY public.joy8_private_entries
    ADD CONSTRAINT joy8_private_entries_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_settlement_entries
    ADD CONSTRAINT joy8_settlement_entries_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.joy8_settlements(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_settlements
    ADD CONSTRAINT joy8_settlements_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.joy8_settlements
    ADD CONSTRAINT joy8_settlements_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.joy8_matches(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.player_accounts
    ADD CONSTRAINT player_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.wallet_accounts
    ADD CONSTRAINT wallet_accounts_player_account_id_fkey FOREIGN KEY (player_account_id) REFERENCES public.player_accounts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.wallet_accounts
    ADD CONSTRAINT wallet_accounts_wallet_policy_id_fkey FOREIGN KEY (wallet_policy_id) REFERENCES public.joy8_wallet_policies(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;



ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_game_session_id_fkey FOREIGN KEY (game_session_id) REFERENCES public.game_sessions(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_wallet_account_id_fkey FOREIGN KEY (wallet_account_id) REFERENCES public.wallet_accounts(id) ON DELETE RESTRICT;



ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;


CREATE POLICY admin_users_self_read ON public.admin_users FOR SELECT TO authenticated USING ((lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))));



CREATE POLICY email_allowlist_admin_add ON public.joy8_email_allowlist FOR INSERT TO authenticated WITH CHECK (public.is_joy8_admin());



CREATE POLICY email_allowlist_admin_read ON public.joy8_email_allowlist FOR SELECT TO authenticated USING (public.is_joy8_admin());



CREATE POLICY email_allowlist_admin_remove ON public.joy8_email_allowlist FOR DELETE TO authenticated USING (public.is_joy8_admin());



CREATE POLICY email_allowlist_auth_read ON public.joy8_email_allowlist FOR SELECT TO supabase_auth_admin USING (true);



ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;


CREATE POLICY games_admin_insert ON public.games FOR INSERT TO authenticated WITH CHECK ((public.is_joy8_admin() AND ((NOT published) OR (cardinality(public.joy8_game_readiness(id, slug, launch_url, thumbnail)) = 0))));



CREATE POLICY games_admin_select ON public.games FOR SELECT TO authenticated USING (public.is_joy8_admin());



CREATE POLICY games_admin_update ON public.games FOR UPDATE TO authenticated USING (public.is_joy8_admin()) WITH CHECK ((public.is_joy8_admin() AND ((NOT published) OR (cardinality(public.joy8_game_readiness(id, slug, launch_url, thumbnail)) = 0))));



ALTER TABLE public.gateway_rate_limits ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_backend_keys ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_email_allowlist ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_fee_accounts ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_game_policies ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_mail_messages ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_mail_recipients ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_match_participants ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_match_recoveries ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_matches ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_private_entries ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_product_ddl_checks ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_product_schemas ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_settlement_entries ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_settlements ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.joy8_wallet_policies ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.player_accounts ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;



REVOKE ALL ON FUNCTION public.create_game_session(p_game_slug text, p_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_game_session(p_game_slug text, p_auth_user_id uuid) TO service_role;



REVOKE ALL ON FUNCTION public.is_joy8_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_joy8_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_joy8_admin() TO service_role;



REVOKE ALL ON FUNCTION public.joy8_active_session(p_gateway_token text, p_required_scope text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_admin_mail(p_action text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_admin_mail(p_action text, p_request jsonb) TO authenticated;



REVOKE ALL ON FUNCTION public.joy8_admit_gateway_request(p_route text, p_request jsonb, p_secret text, p_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_admit_gateway_request(p_route text, p_request jsonb, p_secret text, p_auth_user_id uuid) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_allocate_public_player_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_allocate_public_player_id() TO service_role;



GRANT ALL ON TABLE public.wallet_accounts TO service_role;



REVOKE ALL ON FUNCTION public.joy8_apply_point_grant(p_wallet public.wallet_accounts, p_amount numeric, p_source text, p_policy uuid) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_assert_play_access(p_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_assert_play_access(p_auth_user_id uuid) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_assert_player(p_player uuid) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_backend_game(p_secret text, p_scope text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_before_user_created(event jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_before_user_created(event jsonb) TO supabase_auth_admin;



REVOKE ALL ON FUNCTION public.joy8_check_product_ddl() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_check_product_registration() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_cleanup_gateway_runtime() FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_cleanup_gateway_runtime() TO service_role;



REVOKE ALL ON FUNCTION public.joy8_consume_gateway_rate_limit(p_key text, p_limit integer, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_consume_gateway_rate_limit(p_key text, p_limit integer, p_window_seconds integer) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_create_private_session(p_game_slug text, p_auth_user_id uuid, p_origin text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_create_private_session(p_game_slug text, p_auth_user_id uuid, p_origin text) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_game_readiness(p_game_id uuid, p_slug text, p_launch_url text, p_thumbnail text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_game_readiness(p_game_id uuid, p_slug text, p_launch_url text, p_thumbnail text) TO authenticated;



REVOKE ALL ON FUNCTION public.joy8_grant_member_point(p_player_id uuid) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_guard_mail_history() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_guard_play_access() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_hash_secret(p_secret text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_issue_game_session(p_game_slug text, p_auth_user_id uuid) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_lock_product_ddl_schemas(p_schemas oid[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_match_available_points_v1(p_match_id uuid) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_match_status_v1(p_secret text, p_request jsonb, p_cancel boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_match_status_v1(p_secret text, p_request jsonb, p_cancel boolean) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_member_mail(p_auth_user_id uuid, p_action text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_member_mail(p_auth_user_id uuid, p_action text, p_request jsonb) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_open_match_v1(p_secret text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_open_match_v1(p_secret text, p_request jsonb) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_open_with_settlement_v1(p_secret text, p_request jsonb) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_operator_cancel_match(p_game uuid, p_match_ref text, p_expected_settlements integer, p_reason text, p_evidence_ref text) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_platform_health_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_platform_health_v1() TO service_role;



REVOKE ALL ON FUNCTION public.joy8_point_amount(p_value jsonb) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_product_adapter(p_adapter regprocedure, p_action text, p_match uuid, p_payload jsonb) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_protect_admin_allowlist() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_provision_wallet(p_player_id uuid, p_game_id uuid) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_public_games_v1() FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_public_games_v1() TO anon;
GRANT ALL ON FUNCTION public.joy8_public_games_v1() TO authenticated;
GRANT ALL ON FUNCTION public.joy8_public_games_v1() TO service_role;



REVOKE ALL ON FUNCTION public.joy8_queue_product_ddl_check() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_recovery_immutable() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_reject_accounting_change() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_resolve_branded_entry(p_game_slug text, p_origin text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_resolve_branded_entry(p_game_slug text, p_origin text) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_resolve_member(p_auth_user_id uuid, p_enroll boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_resolve_member(p_auth_user_id uuid, p_enroll boolean) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_resolve_member_profile(p_auth_user_id uuid, p_enroll boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_resolve_member_profile(p_auth_user_id uuid, p_enroll boolean) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_server_request_v1(p_route text, p_ingress_key text, p_ingress_limit integer, p_ingress_window integer, p_secret text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_server_request_v1(p_route text, p_ingress_key text, p_ingress_limit integer, p_ingress_window integer, p_secret text, p_request jsonb) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_server_session_v1(p_secret text, p_action text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_server_session_v1(p_secret text, p_action text, p_request jsonb) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_settle_match_v1(p_secret text, p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.joy8_settle_match_v1(p_secret text, p_request jsonb) TO service_role;



REVOKE ALL ON FUNCTION public.joy8_validate_product_adapter(p_adapter regprocedure) FROM PUBLIC;



REVOKE ALL ON FUNCTION public.joy8_validate_product_adapters() FROM PUBLIC;



REVOKE ALL ON FUNCTION public.wallet_get_balance(p_gateway_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wallet_get_balance(p_gateway_token text) TO service_role;



GRANT ALL ON TABLE public.admin_users TO service_role;



GRANT ALL ON TABLE public.game_sessions TO service_role;



GRANT SELECT,INSERT,UPDATE ON TABLE public.games TO authenticated;
GRANT ALL ON TABLE public.games TO service_role;



GRANT ALL ON TABLE public.gateway_rate_limits TO service_role;



GRANT SELECT,INSERT,DELETE ON TABLE public.joy8_email_allowlist TO authenticated;
GRANT SELECT ON TABLE public.joy8_email_allowlist TO supabase_auth_admin;



GRANT ALL ON TABLE public.player_accounts TO service_role;



GRANT SELECT ON TABLE public.public_games_v1 TO anon;
GRANT SELECT ON TABLE public.public_games_v1 TO authenticated;
GRANT SELECT ON TABLE public.public_games_v1 TO service_role;



GRANT ALL ON TABLE public.wallet_transactions TO service_role;





CREATE EVENT TRIGGER joy8_product_ddl_guard ON ddl_command_end WHEN TAG IN ('GRANT','REVOKE','CREATE SCHEMA','ALTER SCHEMA','CREATE TABLE','CREATE TABLE AS','SELECT INTO','ALTER TABLE','CREATE FOREIGN TABLE','ALTER FOREIGN TABLE','IMPORT FOREIGN SCHEMA','CREATE SEQUENCE','ALTER SEQUENCE','CREATE VIEW','ALTER VIEW','CREATE MATERIALIZED VIEW','ALTER MATERIALIZED VIEW','CREATE FUNCTION','ALTER FUNCTION','CREATE PROCEDURE','ALTER PROCEDURE','ALTER ROUTINE','CREATE AGGREGATE','ALTER AGGREGATE','CREATE EXTENSION','ALTER EXTENSION') EXECUTE FUNCTION public.joy8_queue_product_ddl_check();

CREATE EVENT TRIGGER joy8_product_drop_guard ON sql_drop EXECUTE FUNCTION public.joy8_queue_product_ddl_check();

INSERT INTO public.joy8_wallet_policies(enabled,currency,initial_credit) VALUES(true,'POINT',1000);
COMMIT;
