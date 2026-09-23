begin;

create table public.joy8_match_recoveries (
  match_id uuid primary key references public.joy8_matches(id) on delete restrict,
  settlement_count integer not null,
  reason text not null check(length(reason) between 10 and 1000),
  evidence_ref text not null check(length(evidence_ref) between 10 and 1000),
  operator_name text not null default session_user,
  created_at timestamptz not null default now()
);
alter table public.joy8_match_recoveries enable row level security;
revoke all on public.joy8_match_recoveries from public,anon,authenticated,service_role;

create function public.joy8_recovery_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'JOY8_RECOVERY_IMMUTABLE';
end;
$$;
create trigger joy8_recovery_immutable before update or delete on public.joy8_match_recoveries
  for each row execute function public.joy8_recovery_immutable();
revoke all on function public.joy8_recovery_immutable() from public,anon,authenticated,service_role;

create function public.joy8_operator_cancel_match(p_game uuid,p_match_ref text,p_expected_settlements integer,p_reason text,p_evidence_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.joy8_operator_cancel_match(uuid,text,integer,text,text) from public,anon,authenticated,service_role;
select public.joy8_validate_product_adapters();

commit;
