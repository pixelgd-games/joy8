select
  (select jsonb_agg(j) from (
    select jobid,jobname,schedule,active,username
    from cron.job where jobname='baccarat-weekly-cleanup'
  ) j) as job,
  (select to_jsonb(m) from baccarat.maintenance m) as maintenance,
  (select to_jsonb(r) from (
    select status,start_time,end_time from cron.job_run_details
    where jobid=(select jobid from cron.job where jobname='baccarat-weekly-cleanup')
    order by runid desc limit 1
  ) r) as last_scheduler_run,
  (select jsonb_agg(t order by table_id) from (
    select t.table_id,t.enabled,r.serial,r.phase
    from baccarat.tables t left join lateral (
      select serial,phase from baccarat.rounds where table_id=t.table_id order by serial desc limit 1
    ) r on true
  ) t) as tables,
  has_function_privilege('baccarat_backend','baccarat.cleanup_history()','EXECUTE') as runtime_can_cleanup,
  has_table_privilege('baccarat_backend','baccarat.rounds','DELETE') as runtime_can_delete;
