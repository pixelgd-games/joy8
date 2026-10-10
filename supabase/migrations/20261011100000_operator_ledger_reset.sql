begin;
set local lock_timeout='5s';

create function public.joy8_operator_reset_ledger(p_expected jsonb, p_game_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_counts jsonb;
  v_session uuid;
  v_kept integer:=0;
begin
  lock table public.wallet_accounts,public.wallet_transactions,public.game_sessions,public.joy8_matches,
    public.joy8_match_participants,public.joy8_settlements,public.joy8_settlement_entries,
    public.joy8_reserve_operations,public.joy8_match_recoveries,public.joy8_fee_accounts,
    public.joy8_mail_messages,public.joy8_mail_recipients in access exclusive mode;
  if p_game_id is not null and not exists(select 1 from public.games where id=p_game_id) then
    raise exception 'JOY8_LEDGER_RESET_GAME_NOT_FOUND' using errcode='55000';
  end if;

  create temporary table joy8_reset_matches on commit drop as
    select id from public.joy8_matches where p_game_id is null or game_id=p_game_id;
  create temporary table joy8_reset_transactions on commit drop as
    select id,wallet_account_id,balance_after-balance_before as delta from public.wallet_transactions
    where p_game_id is null
      or (game_id=p_game_id and coalesce(source_type,'') not in ('mail_reward','mail_compensation'));

  v_counts:=jsonb_build_object(
    'game_id',p_game_id,
    'wallet_transactions',(select count(*) from pg_temp.joy8_reset_transactions),
    'joy8_matches',(select count(*) from pg_temp.joy8_reset_matches),
    'joy8_match_participants',(select count(*) from public.joy8_match_participants where match_id in (select id from pg_temp.joy8_reset_matches)),
    'joy8_settlements',(select count(*) from public.joy8_settlements where match_id in (select id from pg_temp.joy8_reset_matches)),
    'joy8_settlement_entries',(select count(*) from public.joy8_settlement_entries e join public.joy8_settlements s on s.id=e.settlement_id where s.match_id in (select id from pg_temp.joy8_reset_matches)),
    'joy8_reserve_operations',(select count(*) from public.joy8_reserve_operations where match_id in (select id from pg_temp.joy8_reset_matches)),
    'joy8_match_recoveries',(select count(*) from public.joy8_match_recoveries where match_id in (select id from pg_temp.joy8_reset_matches)),
    'game_sessions',(select count(*) from public.game_sessions where p_game_id is null or game_id=p_game_id),
    'joy8_mail_messages',case when p_game_id is null then (select count(*) from public.joy8_mail_messages) else 0 end,
    'joy8_mail_recipients',case when p_game_id is null then (select count(*) from public.joy8_mail_recipients) else 0 end);
  if v_counts is distinct from p_expected then
    raise exception 'JOY8_LEDGER_RESET_STALE' using errcode='55000', detail=v_counts::text;
  end if;
  if exists(select 1 from public.joy8_matches where state='open' and id in (select id from pg_temp.joy8_reset_matches)) then
    raise exception 'JOY8_LEDGER_RESET_OPEN_MATCH' using errcode='55000';
  end if;
  if p_game_id is not null and exists(select 1 from public.wallet_accounts w
    join (select wallet_account_id,sum(delta) net from pg_temp.joy8_reset_transactions group by 1) d on d.wallet_account_id=w.id
    where w.balance-d.net-w.locked_balance<0) then
    raise exception 'JOY8_LEDGER_RESET_NEGATIVE_BALANCE' using errcode='55000';
  end if;

  alter table public.wallet_transactions disable trigger joy8_wallet_transactions_immutable;
  alter table public.joy8_settlement_entries disable trigger joy8_settlement_entries_immutable;
  alter table public.joy8_settlements disable trigger joy8_settlements_immutable;
  alter table public.joy8_reserve_operations disable trigger joy8_reserve_operations_guard;
  alter table public.joy8_match_recoveries disable trigger joy8_recovery_immutable;
  alter table public.joy8_mail_messages disable trigger joy8_mail_message_history;
  alter table public.joy8_mail_recipients disable trigger joy8_mail_recipient_history;

  if p_game_id is null then
    delete from public.joy8_mail_recipients;
    delete from public.joy8_mail_messages;
    update public.wallet_accounts set balance=0,locked_balance=0 where balance<>0 or locked_balance<>0;
    update public.joy8_fee_accounts set balance=0 where balance<>0;
  else
    update public.wallet_accounts w set balance=w.balance-d.net
      from (select wallet_account_id,sum(delta) net from pg_temp.joy8_reset_transactions group by 1) d
      where d.wallet_account_id=w.id and d.net<>0;
    update public.joy8_fee_accounts set balance=0 where game_id=p_game_id and balance<>0;
  end if;
  delete from public.joy8_settlement_entries where settlement_id in
    (select id from public.joy8_settlements where match_id in (select id from pg_temp.joy8_reset_matches));
  delete from public.joy8_settlements where match_id in (select id from pg_temp.joy8_reset_matches);
  delete from public.joy8_reserve_operations where match_id in (select id from pg_temp.joy8_reset_matches);
  delete from public.joy8_match_recoveries where match_id in (select id from pg_temp.joy8_reset_matches);
  delete from public.joy8_match_participants where match_id in (select id from pg_temp.joy8_reset_matches);
  delete from public.joy8_matches where id in (select id from pg_temp.joy8_reset_matches);
  delete from public.wallet_transactions where id in (select id from pg_temp.joy8_reset_transactions);
  begin
    delete from public.game_sessions where p_game_id is null or game_id=p_game_id;
  exception when foreign_key_violation then
    for v_session in select id from public.game_sessions where p_game_id is null or game_id=p_game_id loop
      begin
        delete from public.game_sessions where id=v_session;
      exception when foreign_key_violation then
        v_kept:=v_kept+1;
      end;
    end loop;
  end;

  alter table public.wallet_transactions enable trigger joy8_wallet_transactions_immutable;
  alter table public.joy8_settlement_entries enable trigger joy8_settlement_entries_immutable;
  alter table public.joy8_settlements enable trigger joy8_settlements_immutable;
  alter table public.joy8_reserve_operations enable trigger joy8_reserve_operations_guard;
  alter table public.joy8_match_recoveries enable trigger joy8_recovery_immutable;
  alter table public.joy8_mail_messages enable trigger joy8_mail_message_history;
  alter table public.joy8_mail_recipients enable trigger joy8_mail_recipient_history;
  if exists(select 1 from public.wallet_accounts w where w.balance<>(select coalesce(sum(t.balance_after-t.balance_before),0)
      from public.wallet_transactions t where t.wallet_account_id=w.id))
    or exists(select 1 from public.joy8_fee_accounts f where f.balance<>(select coalesce(sum(e.amount),0)
      from public.joy8_settlement_entries e join public.joy8_settlements s on s.id=e.settlement_id where s.game_id=f.game_id and e.kind='fee')) then
    raise exception 'JOY8_LEDGER_RESET_UNRECONCILED' using errcode='55000';
  end if;
  drop table pg_temp.joy8_reset_matches,pg_temp.joy8_reset_transactions;
  return v_counts||jsonb_build_object('game_sessions_kept',v_kept);
end;
$$;
revoke all on function public.joy8_operator_reset_ledger(jsonb,uuid) from public,anon,authenticated,service_role;

commit;
