begin;
grant mahjong_clash_accounting_owner to current_user with set true;
grant mahjong_clash_accounting_owner to current_user with inherit true;
grant create on schema mahjong_clash to mahjong_clash_accounting_owner;

create table mahjong_clash.integration_players (
  player_id uuid primary key,
  session_id uuid not null,
  wallet_id uuid not null unique
);
create table mahjong_clash.local_runtime (
  singleton boolean primary key default true check(singleton),
  revision bigint not null check(revision>=0),
  operation_id uuid,
  request_hash text,
  metadata jsonb not null check(not mahjong_clash.has_credentials(metadata)),
  metadata_hash text not null check(metadata_hash=mahjong_clash.hash_json(metadata))
);
insert into mahjong_clash.local_runtime values(true,0,null,null,'{}',mahjong_clash.hash_json('{}'));
create table mahjong_clash.integration_pending (
  singleton boolean primary key default true check(singleton),
  operation_id uuid not null,
  revision bigint not null check(revision>=0),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  state text not null check(not mahjong_clash.has_credentials(state::jsonb)),
  cursor integer not null default 0 check(cursor>=0)
);

create function mahjong_clash.bind_runtime_identity(p_session uuid,p_player uuid) returns void
language plpgsql security definer set search_path='' as $$
declare binding jsonb;
begin
  binding:=mahjong_clash.resolve_looty_session(p_session,p_player);
  insert into mahjong_clash.integration_players values(p_player,p_session,(binding->>'wallet_id')::uuid)
    on conflict(player_id) do update set session_id=excluded.session_id,wallet_id=excluded.wallet_id;
end;
$$;

create function mahjong_clash.runtime_balance(p_player uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select w.balance from mahjong_clash.integration_players b
    join public.wallet_accounts w on w.id=b.wallet_id and w.player_account_id=b.player_id
    join public.looty_wallet_policies p on p.id=w.wallet_policy_id
    join mahjong_clash.lifecycle_config c on c.game_id=p.game_id and c.singleton
    where b.player_id=p_player and w.currency='POINT';
$$;

create function mahjong_clash.fund_runtime_ai(p_ai uuid,p_name text,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from mahjong_clash.economy_state where singleton for update;
  insert into mahjong_clash.ai_accounts(id,display_name) values(p_ai,p_name) on conflict do nothing;
  return mahjong_clash.fund_ai(p_ai,p_operation);
end;
$$;
grant execute on function mahjong_clash.fund_ai(uuid,text) to mahjong_clash_accounting_owner;
alter function mahjong_clash.fund_runtime_ai(uuid,text,text) owner to mahjong_clash_accounting_owner;

create function mahjong_clash.release_runtime_leases(p_owner uuid) returns void
language sql security definer set search_path='' as $$
  update mahjong_clash.match_states set lease_expires_at=clock_timestamp() where lease_owner=p_owner;
$$;

create function mahjong_clash.runtime_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'game_id',c.game_id,'environment',e.environment,
    'continuous',exists(select 1 from information_schema.columns where table_schema='public' and table_name='looty_matches' and column_name='settlement_count'),
    'wallet_enabled',w.enabled,'initial_credit',w.initial_credit,
    'game_enabled',p.enabled,'adapter',p.product_adapter::text,
    'pending',exists(select 1 from mahjong_clash.integration_pending))
  from mahjong_clash.lifecycle_config c cross join mahjong_clash.economy_state e
    join public.looty_game_policies p on true
    join public.looty_wallet_policies w on w.id=p.wallet_policy_id
  where c.singleton and e.singleton and p.game_id=c.game_id and w.game_id=c.game_id;
$$;

revoke all on mahjong_clash.integration_players,mahjong_clash.local_runtime,mahjong_clash.integration_pending from public,anon,authenticated,service_role,mahjong_clash_server;
grant select on mahjong_clash.integration_players,mahjong_clash.local_runtime,mahjong_clash.integration_pending,
  mahjong_clash.match_states,mahjong_clash.hands,mahjong_clash.platform_matches,mahjong_clash.economy_operations,
  mahjong_clash.ai_accounts,mahjong_clash.ai_reservations,mahjong_clash.economy_state,mahjong_clash.economy_versions,
  mahjong_clash.match_openings to mahjong_clash_server;
grant update(revision,operation_id,request_hash,metadata,metadata_hash) on mahjong_clash.local_runtime to mahjong_clash_server;
grant insert,delete on mahjong_clash.integration_pending to mahjong_clash_server;
grant update(cursor) on mahjong_clash.integration_pending to mahjong_clash_server;
create policy runtime_read on mahjong_clash.match_states for select to mahjong_clash_server using(true);
create policy runtime_read on mahjong_clash.hands for select to mahjong_clash_server using(true);
create policy runtime_read on mahjong_clash.ai_accounts for select to mahjong_clash_server using(true);
grant execute on function mahjong_clash.hash_json(jsonb),mahjong_clash.has_credentials(jsonb) to mahjong_clash_server;
revoke all on function mahjong_clash.bind_runtime_identity(uuid,uuid),mahjong_clash.runtime_balance(uuid),
  mahjong_clash.fund_runtime_ai(uuid,text,text),mahjong_clash.release_runtime_leases(uuid),mahjong_clash.runtime_readiness()
  from public,anon,authenticated,service_role,mahjong_clash_server;
grant execute on function mahjong_clash.bind_runtime_identity(uuid,uuid),mahjong_clash.runtime_balance(uuid),
  mahjong_clash.fund_runtime_ai(uuid,text,text),mahjong_clash.release_runtime_leases(uuid),mahjong_clash.runtime_readiness() to mahjong_clash_server;

revoke create on schema mahjong_clash from mahjong_clash_accounting_owner;
grant mahjong_clash_accounting_owner to current_user with inherit false;
grant mahjong_clash_accounting_owner to current_user with set false;

commit;
