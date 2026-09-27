begin;
set local lock_timeout='5s';
alter function public.joy8_consume_gateway_rate_limit(text,integer,integer) set search_path='';
alter function public.joy8_cleanup_gateway_runtime() set search_path='';
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
create or replace function public.joy8_admin_mail(p_action text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;


revoke all on function public.joy8_admin_mail(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.joy8_admin_mail(text,jsonb) to authenticated;
select public.joy8_validate_product_adapters();
commit;
