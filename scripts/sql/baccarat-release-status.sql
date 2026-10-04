select
  (select count(*) from baccarat.bets where status not in ('settled','rejected','voided')) as pending_bets,
  (select count(*) from baccarat.gateway_operations where state='pending') as pending_operations,
  (select count(*) from public.joy8_matches where game_id='6dc12d01-5760-4123-832f-6d0bd305404a' and state='open') as open_matches,
  (select jsonb_agg(t) from (
    select t.table_id,t.rule_version,t.enabled,r.serial,r.phase,r.rule_version as round_rule_version
    from baccarat.tables t left join lateral (
      select serial,phase,rule_version from baccarat.rounds where table_id=t.table_id order by serial desc limit 1
    ) r on true order by t.table_id
  ) t) as tables;
