import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"

const db = await createLocalPostgres()
const one = async sql => (await db.query(sql)).rows[0]
before(async () => {
  await loadPlatformDatabase(db)
  await loadProductAccounting(db)
  await db.exec(`
    update public.joy8_wallet_policies set enabled=true;
    insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount,product_adapter)
    select g.id,w.id,true,1000,'fixture_product.accounting(text,uuid,jsonb)'::regprocedure
    from public.games g cross join public.joy8_wallet_policies w;
    create schema ddl_maintenance;
    create table auth.provider_data(id int);
    create role ddl_candidate_owner nologin;
    create schema ddl_candidate authorization ddl_candidate_owner;
    create schema ddl_candidate_two authorization ddl_candidate_owner;
    create schema ddl_other authorization ddl_candidate_owner;
    set role ddl_candidate_owner;
    create function ddl_other.safe() returns int language sql as $$ select 1 $$;
    revoke execute on function ddl_other.safe() from public;
    reset role;
    insert into public.joy8_product_schemas values('ddl_other');
  `)
})
after(() => db.close())

async function competing(action) {
  const first = await db.connect()
  const second = await db.connect()
  let pending
  try {
    await first.query("begin; set local statement_timeout=8000")
    await second.query("begin; set local statement_timeout=8000")
    const pid = (await second.query("select pg_backend_pid() pid")).rows[0].pid
    await action(first, second, query => {
      pending = second.query(query)
      pending.catch(() => {})
      return pending
    }, async () => {
      for (let i = 0; i < 100; i++) {
        if ((await db.query("select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted", [pid])).rowCount) return
        await delay(20)
      }
      assert.fail("Competing DDL must wait at the isolation lock")
    })
  } finally {
    await first.query("rollback")
    await pending?.catch(() => {})
    await second.query("rollback")
    await first.end()
    await second.end()
  }
  assert.equal((await one("select count(*)::int n from public.joy8_product_ddl_checks")).n, 0)
}

test("maintenance completes without the global isolation lock while another transaction holds it", async () => {
  await competing(async (first, second) => {
    await first.query("select pg_advisory_xact_lock(75080003)")
    await second.query(`set local statement_timeout=1500;
      comment on table fixture_product.accounts is 'maintenance';
      create index ddl_maintenance_index on fixture_product.accounts(ref);
      reindex index fixture_product.ddl_maintenance_index;
      drop index fixture_product.ddl_maintenance_index;
      alter table auth.provider_data add column value text;
      create function ddl_maintenance.safe() returns int language sql as $$ select 1 $$;
    `)
    assert.equal((await second.query("select count(*)::int n from public.joy8_product_ddl_checks")).rows[0].n, 0)
    assert.equal((await second.query("select count(*)::int n from pg_locks where pid=pg_backend_pid() and locktype='advisory' and classid=0 and objid=75080003")).rows[0].n, 0)
    await second.query("commit")
  })
})

test("related product DDL serializes and both safe transactions commit", async () => {
  await competing(async (first, second, start, waiting) => {
    await first.query("alter function fixture_product.accounting(text,uuid,jsonb) set search_path=''")
    const query = start("alter function ddl_other.safe() set search_path=''")
    await waiting()
    await first.query("commit")
    await query
    await second.query("commit")
  })
})

test("DDL waiting behind registration sees the newly registered schema and rejects a PUBLIC leak", async () => {
  await competing(async (first, second, start, waiting) => {
    await first.query("insert into public.joy8_product_schemas values('ddl_candidate')")
    const query = start("set local role ddl_candidate_owner; create function ddl_candidate.leaked() returns int language sql as $$ select 1 $$")
    await waiting()
    await first.query("commit")
    await query
    await assert.rejects(second.query("commit"), /JOY8_PRODUCT_DDL_REJECTED/)
  })
  assert.equal((await one("select to_regprocedure('ddl_candidate.leaked()') name")).name, null)
})

test("registration waiting behind unregistered DDL validates the newly committed privilege state", async () => {
  await competing(async (first, second, start, waiting) => {
    await first.query("set local role ddl_candidate_owner; create function ddl_candidate_two.leaked() returns int language sql as $$ select 1 $$")
    const query = start("insert into public.joy8_product_schemas values('ddl_candidate_two')")
    await waiting()
    await first.query("commit")
    await assert.rejects(query, /JOY8_ADAPTER_UNAVAILABLE/)
  })
  assert.equal((await one("select count(*)::int n from public.joy8_product_schemas where schema_name='ddl_candidate_two'")).n, 0)
})

test("new adapter registration cannot race past previously harmless Auth ownership changes", async () => {
  await db.exec(`set role ddl_candidate_owner;
    create function ddl_other.accounting(text,uuid,jsonb) returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
    revoke execute on function ddl_other.accounting(text,uuid,jsonb) from public;
    reset role`)
  await competing(async (first, second, start, waiting) => {
    await first.query("alter table auth.provider_data owner to ddl_candidate_owner")
    const query = start("update public.joy8_game_policies set product_adapter='ddl_other.accounting(text,uuid,jsonb)'::regprocedure where game_id=(select id from public.games where slug='hidden-game')")
    await waiting()
    await first.query("commit")
    await assert.rejects(query, /JOY8_ADAPTER_UNAVAILABLE/)
  })
})
