begin;
set local lock_timeout='5s';
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;

create or replace function baccarat.guard_update() returns trigger
language plpgsql set search_path = '' as $$
declare mutable text[];
begin
  if tg_table_name = 'tables' then
    mutable := array['name','rule_version','min_bet_minor','max_bet_minor','max_payout_minor','revision','enabled'];
  elsif tg_table_name = 'rounds' then
    mutable := array['phase','result','finished_at'];
    if old.phase in ('result','void') and new is distinct from old then
      raise exception 'BACCARAT_FINAL_ROUND';
    end if;
    if old.phase = 'closing' and new.phase in ('dealing','void') and exists (
      select 1 from baccarat.bets where round_id = old.round_id and status = 'opening'
    ) then raise exception 'BACCARAT_RESERVATIONS_PENDING'; end if;
    if (old.result is not null and new.result is distinct from old.result)
      or (old.phase <> new.phase and not (
        (old.phase = 'betting' and new.phase = 'closing')
        or (old.phase = 'closing' and new.phase in ('dealing','void'))
        or (old.phase = 'dealing' and new.phase = 'result'))) then
      raise exception 'BACCARAT_ROUND_TRANSITION';
    end if;
  elsif tg_table_name = 'bets' then
    mutable := array['status','payout_minor','stake_minor'];
    if old.status in ('settled','rejected','voided') and new is distinct from old then
      raise exception 'BACCARAT_FINAL_BET';
    end if;
    if old.status <> new.status and not (
      (old.status = 'opening' and new.status in ('accepted','rejected','voiding'))
      or (old.status = 'accepted' and new.status in ('settling','voiding'))
      or (old.status = 'settling' and new.status = 'settled')
      or (old.status = 'voiding' and new.status = 'voided')) then
      raise exception 'BACCARAT_BET_TRANSITION';
    end if;
  else
    mutable := array['state','attempts','next_attempt_at','response','completed_at','last_error'];
    if old.state <> 'pending' and new is distinct from old then
      raise exception 'BACCARAT_FINAL_OPERATION';
    end if;
    if new.attempts < old.attempts then raise exception 'BACCARAT_ATTEMPT_REGRESSION'; end if;
  end if;
  if to_jsonb(new) - mutable is distinct from to_jsonb(old) - mutable then
    raise exception 'BACCARAT_IMMUTABLE_RECORD';
  end if;
  return new;
end;
$$;

revoke execute on function baccarat.guard_update() from public, anon, authenticated, service_role;

reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
