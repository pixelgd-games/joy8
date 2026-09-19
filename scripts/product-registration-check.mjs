import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { memberSql } from "./fixtures/member-database.mjs"
import { applyJoy8Rebrand } from "./fixtures/joy8-rebrand.mjs"
import { loadPlatformHardening } from "./fixtures/platform-hardening.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const invoke = () => one("select public.joy8_product_adapter('review_a.accounting(text,uuid,jsonb)'::regprocedure,'settle',null,'{}') result")

before(async () => {
  await loadPlatformDatabase(db, async () => {}, false)
  await applyJoy8Rebrand(db)
  for (const name of ["20260919130000_read_only_member_lookup.sql", "20260919131000_cross_product_adapter_isolation.sql", "20260920100000_public_player_ids.sql", "20260920110000_public_id_allocation.sql"]) {
    await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  }
  await db.exec(`
    create role review_a_owner nologin;
    create role review_b_owner nologin;
    create schema review_a authorization review_a_owner;
    create schema review_b authorization review_b_owner;
    set role review_a_owner;
    create table review_a.commits(action text);
    create function review_a.accounting(action text,match_id uuid,payload jsonb)
    returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      insert into review_a.commits values(action);
      return '{"committed":true}'::jsonb;
    end;
    $$;
    revoke all on function review_a.accounting(text,uuid,jsonb) from public;
    reset role;
    insert into public.joy8_wallet_policies(enabled) values(true);
    insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount,product_adapter)
    select g.id,w.id,true,1000,'review_a.accounting(text,uuid,jsonb)'::regprocedure
    from public.games g cross join public.joy8_wallet_policies w;
  `)
  await db.exec(await memberSql("../../supabase/migrations/20260920111000_product_schema_registration.sql"))
  await loadPlatformHardening(db)
})
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))
after(() => db.close())

async function denied(sql, pattern = /JOY8_ADAPTER_UNAVAILABLE/) {
  await db.exec("savepoint rejected_change")
  await assert.rejects(db.exec(sql), pattern)
  await db.exec("rollback to savepoint rejected_change; release savepoint rejected_change")
}

test("existing registration is preserved and preflight never executes the product", async () => {
  assert.equal((await one("select count(*)::int n from public.joy8_product_schemas where schema_name='review_a'")).n, 1)
  await db.query("select public.joy8_validate_product_adapters()")
  assert.equal((await one("select count(*)::int n from review_a.commits")).n, 0)
  assert.deepEqual((await invoke()).result, { committed: true })
})

test("unsafe product registration rolls back before it can interrupt an existing adapter", async () => {
  await db.exec(`
    set role review_b_owner;
    alter default privileges in schema review_b revoke execute on functions from public;
    create function review_b.helper() returns int language sql as $$ select 1 $$;
    reset role;
  `)
  const privileges = await one("select has_schema_privilege('review_a_owner','review_b','USAGE') usage,has_function_privilege('review_a_owner','review_b.helper()','EXECUTE') execute")
  assert.deepEqual(privileges, { usage: false, execute: true })
  await denied("insert into public.joy8_product_schemas values('review_b')")
  assert.equal((await one("select count(*)::int n from public.joy8_product_schemas where schema_name='review_b'")).n, 0)
  assert.deepEqual((await invoke()).result, { committed: true })
  await db.exec("revoke execute on function review_b.helper() from public; insert into public.joy8_product_schemas values('review_b')")
  assert.deepEqual((await invoke()).result, { committed: true })
})

test("registered schemas without adapters are included in runtime and preflight checks", async () => {
  await db.exec("insert into public.joy8_product_schemas values('review_b'); create table review_b.private_data(id int)")
  await denied("grant select on review_b.private_data to review_a_owner; select public.joy8_validate_product_adapters()")
  await db.exec("grant select on review_b.private_data to review_a_owner")
  await denied("select public.joy8_product_adapter('review_a.accounting(text,uuid,jsonb)'::regprocedure,'settle',null,'{}')")
  assert.equal((await one("select count(*)::int n from review_a.commits")).n, 0)
  await db.exec("revoke select on review_b.private_data from review_a_owner")
  assert.deepEqual((await invoke()).result, { committed: true })
})

test("DDL preflight aborts new PUBLIC functions while retaining both product registrations", async () => {
  await db.exec("insert into public.joy8_product_schemas values('review_b')")
  await denied("create function review_b.leaked() returns int language sql as $$ select 1 $$; select public.joy8_validate_product_adapters()")
  assert.equal((await one("select to_regprocedure('review_b.leaked()') function")).function, null)
  assert.equal((await one("select count(*)::int n from public.joy8_product_schemas")).n, 2)
  assert.deepEqual((await invoke()).result, { committed: true })
})

test("invalid adapter configuration, registry removal and missing schema fail before commit", async () => {
  await db.exec("set role review_b_owner; create function review_b.bad(text,uuid,jsonb) returns jsonb language sql security definer as $$ select '{}'::jsonb $$; revoke all on function review_b.bad(text,uuid,jsonb) from public; reset role")
  await denied("update public.joy8_game_policies set product_adapter='review_b.bad(text,uuid,jsonb)'::regprocedure")
  await db.exec("insert into public.joy8_product_schemas values('review_b')")
  await denied("update public.joy8_game_policies set product_adapter='review_b.bad(text,uuid,jsonb)'::regprocedure")
  await denied("delete from public.joy8_product_schemas where schema_name='review_a'")
  await denied("insert into public.joy8_product_schemas values('review_missing')", /JOY8_PRODUCT_SCHEMA_UNAVAILABLE/)
  assert.deepEqual((await invoke()).result, { committed: true })
})

test("registration and validation helpers grant no browser, service or product bypass", async () => {
  for (const role of ["anon", "authenticated", "service_role", "review_a_owner"]) {
    assert.equal((await one("select has_table_privilege($1,'public.joy8_product_schemas','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed", [role])).allowed, false)
    for (const fn of ["joy8_validate_product_adapter(regprocedure)", "joy8_validate_product_adapters()", "joy8_check_product_registration()", "joy8_product_adapter(regprocedure,text,uuid,jsonb)"]) {
      assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${fn}`])).allowed, false)
    }
  }
})

test("sequence, view, schema and inherited function privileges all deny cross-product execution", async () => {
  await db.exec(`
    set role review_b_owner;
    create sequence review_b.counter;
    create view review_b.summary as select 1 value;
    create function review_b.private_function() returns int language sql as $$ select 1 $$;
    revoke all on function review_b.private_function() from public;
    reset role;
    insert into public.joy8_product_schemas values('review_b');
  `)
  for (const grant of [
    "grant usage on sequence review_b.counter to review_a_owner",
    "grant select on review_b.summary to review_a_owner",
    "grant create on schema review_b to review_a_owner",
    "grant execute on function review_b.private_function() to review_a_owner",
    "grant review_b_owner to review_a_owner",
  ]) {
    await denied(`${grant}; select public.joy8_validate_product_adapters()`)
    assert.deepEqual((await invoke()).result, { committed: true })
  }
})
