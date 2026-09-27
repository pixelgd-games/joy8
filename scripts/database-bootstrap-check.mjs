import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { googleIdentity } from "./fixtures/google-identity.mjs"

const bootstrap = await readFile("supabase/bootstrap/platform.sql", "utf8")
const fixture = await readFile("scripts/fixtures/member-database.sql", "utf8")
const auth = fixture.slice(0, fixture.indexOf("create table public.games")) + fixture.slice(fixture.indexOf("create table auth.identities"), fixture.indexOf("create table public.admin_users"))
  + fixture.slice(fixture.indexOf("create function auth.uid"))
const cleanDump = sql => sql.replace(/^\\(?:un)?restrict.*\r?\n/gm, "")
const first = await createLocalPostgres()
const restored = await createLocalPostgres()
try {
  await first.exec(auth)
  await first.exec(bootstrap)
  await first.exec("create function public.bootstrap_permission_probe() returns boolean language sql as $$select true$$")
  assert.equal((await first.query("select has_function_privilege('anon','public.bootstrap_permission_probe()','execute') allowed")).rows[0].allowed, false)
  assert.equal((await first.query("select has_function_privilege('service_role','public.bootstrap_permission_probe()','execute') allowed")).rows[0].allowed, false)
  await first.exec("drop function public.bootstrap_permission_probe()")
  const id = await googleIdentity(first)
  const member = (await first.query("select * from public.joy8_resolve_member($1,true)", [id])).rows[0]
  const snapshot = async db => ({
    member: (await db.query("select * from public.joy8_resolve_member_profile($1,false)", [id])).rows,
    wallet: (await db.query("select id,balance::text,locked_balance::text from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).rows,
    ledger: (await db.query("select id,amount::text,source_type,idempotency_key from public.wallet_transactions order by id")).rows,
    permissions: (await db.query("select has_function_privilege('anon','public.joy8_resolve_member(uuid,boolean)','execute') anonymous,has_function_privilege('service_role','public.joy8_resolve_member(uuid,boolean)','execute') backend")).rows,
  })
  const before = await snapshot(first)
  assert.equal(before.wallet[0].balance, "1000.00")
  assert.deepEqual(before.permissions, [{ anonymous: false, backend: true }])
  const dump = cleanDump(await first.dump(["--inserts", "--schema=public", "--schema=auth"]))
  await restored.exec("create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create schema extensions; create extension pgcrypto with schema extensions;")
  await restored.exec(dump.replace(/^CREATE SCHEMA public;\r?\n/gm, "").replace(/ALTER DEFAULT PRIVILEGES FOR ROLE joy8_test/g, "ALTER DEFAULT PRIVILEGES"))
  assert.deepEqual(await snapshot(restored), before)
  await restored.query("select * from public.joy8_resolve_member($1,true)", [id])
  assert.deepEqual(await snapshot(restored), before)
  await assert.rejects(restored.exec(bootstrap), /JOY8_BOOTSTRAP_REQUIRES_EMPTY_PROJECT/)
  await restored.exec("rollback")
  console.log("Empty project bootstrap, schema/data restore, identity, wallet, ledger, grants and no duplicate enrollment credit passed on PostgreSQL 17.")
} finally { await Promise.all([first.close(), restored.close()]) }
