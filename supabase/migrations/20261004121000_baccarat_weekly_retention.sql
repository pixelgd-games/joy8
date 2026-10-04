begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;

create index baccarat_rounds_retention on baccarat.rounds(finished_at,round_id) where finished_at is not null;
create index baccarat_rounds_shoe on baccarat.rounds(table_id,shoe_id);
create index baccarat_bets_round on baccarat.bets(round_id);

create table baccarat.maintenance (
  singleton boolean primary key default true check (singleton),
  next_run_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  cutoff_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  rounds_deleted bigint not null default 0,
  bets_deleted bigint not null default 0,
  operations_deleted bigint not null default 0,
  shoes_deleted bigint not null default 0
);
alter table baccarat.maintenance enable row level security;
insert into baccarat.maintenance(singleton) values(true);

create function baccarat.cleanup_history() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  maintenance_row baccarat.maintenance;
  cutoff timestamptz;
  round_ids text[];
  removed_rounds integer;
  removed_bets integer;
  removed_operations integer;
  removed_shoes integer;
  completed boolean;
begin
  select * into maintenance_row from baccarat.maintenance where singleton for update skip locked;
  if not found then return jsonb_build_object('status','busy'); end if;
  if maintenance_row.cutoff_at is null and maintenance_row.next_run_at > clock_timestamp() then
    return jsonb_build_object('status','waiting','next_run_at',maintenance_row.next_run_at);
  end if;
  cutoff := maintenance_row.cutoff_at;
  if cutoff is null then
    cutoff := clock_timestamp() - interval '7 days';
    update baccarat.maintenance set cutoff_at=cutoff,last_started_at=clock_timestamp(),
      rounds_deleted=0,bets_deleted=0,operations_deleted=0,shoes_deleted=0 where singleton;
  end if;

  with bounds as materialized (
    select t.table_id,
      (select serial from baccarat.rounds where table_id=t.table_id order by serial desc limit 1) as latest_serial,
      coalesce((select serial from baccarat.rounds where table_id=t.table_id
        and phase='result' and result->>'outcome' is not null order by serial desc offset 95 limit 1),0) as history_floor
    from baccarat.tables t
  ), candidates as (
    select r.round_id from baccarat.rounds r join bounds using(table_id)
    where r.phase in ('result','void') and r.finished_at < cutoff and r.serial < bounds.latest_serial
      and (r.phase='void' or r.result->>'outcome' is null or r.serial < bounds.history_floor)
      and not exists (
        select 1 from baccarat.bets b where b.round_id=r.round_id and (
          b.status not in ('settled','rejected','voided') or b.created_at >= cutoff
          or not exists (
            select 1 from baccarat.gateway_operations o where o.bet_id=b.bet_id and o.completed_at < cutoff
              and ((b.status='settled' and o.kind='settle' and o.state='confirmed')
                or (b.status='voided' and o.kind='cancel' and o.state='confirmed')
                or (b.status='rejected' and o.kind='open' and o.state='rejected'))
          ) or exists (
            select 1 from baccarat.gateway_operations o where o.bet_id=b.bet_id
              and (o.state='pending' or o.completed_at is null or o.completed_at >= cutoff)
          )
        )
      )
    order by r.finished_at,r.round_id limit 5000 for update of r
  ) select array_agg(round_id) into round_ids from candidates;

  delete from baccarat.gateway_operations o using baccarat.bets b
    where o.bet_id=b.bet_id and b.round_id=any(round_ids);
  get diagnostics removed_operations=row_count;
  delete from baccarat.bets where round_id=any(round_ids);
  get diagnostics removed_bets=row_count;
  delete from baccarat.rounds where round_id=any(round_ids);
  get diagnostics removed_rounds=row_count;
  with candidates as (
    select s.shoe_id from baccarat.shoes s where s.retired_at < cutoff
      and not exists(select 1 from baccarat.rounds r where r.table_id=s.table_id and r.shoe_id=s.shoe_id)
    order by s.retired_at,s.shoe_id limit 5000 for update of s
  ) delete from baccarat.shoes s using candidates c where s.shoe_id=c.shoe_id;
  get diagnostics removed_shoes=row_count;

  completed := removed_rounds < 5000 and removed_shoes < 5000;
  update baccarat.maintenance set
    cutoff_at=case when completed then null else cutoff end,
    next_run_at=case when completed then clock_timestamp()+interval '7 days' else next_run_at end,
    last_completed_at=case when completed then clock_timestamp() else last_completed_at end,
    rounds_deleted=rounds_deleted+removed_rounds,bets_deleted=bets_deleted+removed_bets,
    operations_deleted=operations_deleted+removed_operations,shoes_deleted=shoes_deleted+removed_shoes
    where singleton;
  return jsonb_build_object('status',case when completed then 'completed' else 'running' end,
    'rounds',removed_rounds,'bets',removed_bets,'operations',removed_operations,'shoes',removed_shoes);
end;
$$;

revoke all on function baccarat.cleanup_history() from public,anon,authenticated,service_role,baccarat_backend;
grant usage on schema baccarat to session_user;
grant execute on function baccarat.cleanup_history() to session_user;
reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'BACCARAT_PG_CRON_REQUIRED';
  end if;
  if exists(select 1 from cron.job where jobname='baccarat-weekly-cleanup') then
    raise exception 'BACCARAT_CLEANUP_JOB_ALREADY_EXISTS';
  end if;
end;
$$;
select cron.schedule('baccarat-weekly-cleanup','*/10 * * * *',
  $job$set statement_timeout='30s'; set lock_timeout='1s';
  select baccarat.cleanup_history();
  delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='baccarat-weekly-cleanup')
    and end_time < clock_timestamp()-interval '7 days';$job$);
commit;
