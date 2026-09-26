begin;

alter table public.wallet_transactions
  drop constraint wallet_transactions_game_source_check,
  add constraint wallet_transactions_game_source_check check (
    game_id is not null or source_type in ('initial_grant','registration_grant')
    or (source_type in ('mail_reward','mail_compensation') and type='adjustment' and amount>0)
  );

create table public.joy8_mail_messages (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'draft' check (status in ('draft','sent','cancelled')),
  request jsonb not null,
  kind text not null check (kind in ('announcement','notification','reward','compensation')),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 3000),
  audience text not null check (audience in ('all','game','player')),
  game_id uuid references public.games(id),
  source_ref text not null default '',
  amount numeric(18,2) not null default 0 check (amount >= 0 and amount = trunc(amount)),
  recipient_count integer not null default 0 check (recipient_count between 0 and 5000),
  check ((kind in ('reward','compensation') and amount > 0 and length(source_ref) between 1 and 200)
    or (kind in ('announcement','notification') and amount = 0)),
  check ((status = 'sent') = (sent_at is not null))
);

create table public.joy8_mail_recipients (
  message_id uuid not null references public.joy8_mail_messages(id),
  player_account_id uuid not null references public.player_accounts(id),
  read_at timestamptz,
  claimed_at timestamptz,
  transaction_id uuid unique references public.wallet_transactions(id),
  primary key (message_id, player_account_id),
  check ((claimed_at is null) = (transaction_id is null)),
  check (claimed_at is null or read_at is not null)
);

create index joy8_mail_recipient_player on public.joy8_mail_recipients(player_account_id,message_id);
create index joy8_mail_sent on public.joy8_mail_messages(sent_at desc,id desc) where status='sent';
create index joy8_mail_created on public.joy8_mail_messages(created_at desc,id desc);
alter table public.joy8_mail_messages enable row level security;
alter table public.joy8_mail_recipients enable row level security;
revoke all on public.joy8_mail_messages,public.joy8_mail_recipients from public,anon,authenticated,service_role;

create function public.joy8_guard_mail_history() returns trigger
language plpgsql set search_path = '' as $$
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
create trigger joy8_mail_message_history before update or delete on public.joy8_mail_messages
for each row execute function public.joy8_guard_mail_history();
create trigger joy8_mail_recipient_history before update or delete on public.joy8_mail_recipients
for each row execute function public.joy8_guard_mail_history();
revoke all on function public.joy8_guard_mail_history() from public,anon,authenticated,service_role;

create function public.joy8_admin_mail(p_action text,p_request jsonb) returns jsonb
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

create function public.joy8_member_mail(p_auth_user_id uuid,p_action text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;

revoke all on function public.joy8_admin_mail(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.joy8_admin_mail(text,jsonb) to authenticated;
revoke all on function public.joy8_member_mail(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.joy8_member_mail(uuid,text,jsonb) to service_role;
select public.joy8_validate_product_adapters();

commit;
