import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"

const db = await createTestDatabase()
const one = async sql => (await db.query(sql)).rows[0]
before(async () => {
  await loadPlatformDatabase(db)
  await loadProductAccounting(db)
  await db.exec(`
    insert into public.joy8_wallet_policies(enabled) values(true);
    insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount,product_adapter)
    select g.id,w.id,true,1000,'fixture_product.accounting(text,uuid,jsonb)'::regprocedure
    from public.games g cross join public.joy8_wallet_policies w;
    create role ddl_product_owner nologin;
    create schema ddl_product authorization ddl_product_owner;
    set role ddl_product_owner;
    create table ddl_product.data(id int);
    create function ddl_product.safe() returns int language sql as $$ select 1 $$;
    revoke execute on function ddl_product.safe() from public;
    reset role;
    insert into public.joy8_product_schemas values('ddl_product');
  `)
})
after(() => db.close())

async function rejected(sql, pattern = /JOY8_PRODUCT_DDL_REJECTED/) {
  try {
    await db.exec("begin")
    await db.exec(sql)
    await assert.rejects(db.exec("commit"), pattern)
  } finally { await db.exec("rollback; reset role") }
  await db.exec("select public.joy8_validate_product_adapters()")
  assert.equal((await one("select count(*)::int n from public.joy8_product_ddl_checks")).n, 0)
}

test("PUBLIC EXECUTE grant is automatically rolled back at commit without manual preflight", async () => {
  await rejected("set local role ddl_product_owner; grant execute on function ddl_product.safe() to public")
  assert.equal((await one("select has_function_privilege('fixture_product_owner','ddl_product.safe()','EXECUTE') allowed")).allowed, false)
})

test("new public function is rolled back before it can break the configured adapter", async () => {
  await rejected("set local role ddl_product_owner; create function ddl_product.leaked() returns int language sql as $$ select 1 $$")
  assert.equal((await one("select to_regprocedure('ddl_product.leaked()') name")).name, null)
})

test("function creation and revocation in the same transaction succeed and clear the queue", async () => {
  await db.exec(`begin; set local role ddl_product_owner;
    create function ddl_product.new_safe() returns int language sql as $$ select 1 $$;
    revoke execute on function ddl_product.new_safe() from public;
    commit`)
  assert.equal((await one("select count(*)::int n from public.joy8_product_ddl_checks")).n, 0)
  await db.exec("select public.joy8_validate_product_adapters()")
})

test("cross-product table grants and adapter owner changes cannot commit", async () => {
  await rejected("grant select on ddl_product.data to fixture_product_owner")
  await rejected("alter function fixture_product.accounting(text,uuid,jsonb) owner to current_user")
  assert.equal((await one("select has_table_privilege('fixture_product_owner','ddl_product.data','SELECT') allowed")).allowed, false)
})

test("dropping a registered schema aborts the entire DDL transaction", async () => {
  await rejected("drop schema ddl_product cascade")
  assert.notEqual((await one("select to_regnamespace('ddl_product') name")).name, null)
})

test("unrelated DDL succeeds, failed DDL has no queued residue", async () => {
  await db.exec("create table public.ddl_unrelated(id int); drop table public.ddl_unrelated")
  await assert.rejects(db.exec("alter table public.ddl_missing add column id int"), /does not exist/)
  assert.equal((await one("select count(*)::int n from public.joy8_product_ddl_checks")).n, 0)
})

test("browser, service and product roles cannot bypass or clear validation", async () => {
  for (const role of ["anon", "authenticated", "service_role", "fixture_product_owner", "ddl_product_owner"]) {
    assert.equal((await one(`select has_table_privilege('${role}','public.joy8_product_ddl_checks','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') allowed`)).allowed, false)
    for (const fn of ["joy8_queue_product_ddl_check()", "joy8_check_product_ddl()"]) {
      assert.equal((await one(`select has_function_privilege('${role}','public.${fn}','EXECUTE') allowed`)).allowed, false)
    }
  }
})
