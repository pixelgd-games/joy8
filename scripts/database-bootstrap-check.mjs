import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { googleIdentity } from "./fixtures/google-identity.mjs"
import { snapshotMetadata } from "./snapshot-metadata.mjs"
import { restoreSnapshot } from "./restore-snapshot.mjs"

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
  await first.exec(`
    create role probe_table_owner nologin;
    create role probe_function_owner nologin;
    create table public.recovery_probe_rows(value integer);
    insert into public.recovery_probe_rows values(7);
    alter table public.recovery_probe_rows owner to probe_table_owner;
    alter table public.recovery_probe_rows enable row level security;
    create policy recovery_probe_read on public.recovery_probe_rows for select to probe_function_owner using(true);
    grant select on public.recovery_probe_rows to probe_function_owner;
    grant usage on schema extensions to probe_function_owner;
    create function public.recovery_permission_probe(p public.wallet_accounts) returns boolean
      language sql security definer set search_path='' as $$
      select sum(value)=7 and octet_length(extensions.gen_random_bytes(4))=4 from public.recovery_probe_rows;
      $$;
    alter function public.recovery_permission_probe(public.wallet_accounts) owner to probe_function_owner;
  `)
  assert.equal((await first.query("select public.recovery_permission_probe(null) ok")).rows[0].ok, true)
  await first.exec("begin read only; set local search_path=''")
  const metadata = await snapshotMetadata(first, ["public", "auth"])
  const directory = path.resolve(".recovery.local", `regression-${randomUUID()}`)
  await mkdir(directory, { recursive: true })
  const hashes = {}
  for (const section of ["pre-data", "data", "post-data"]) {
    const sql = cleanDump(await first.dump(["--inserts", "--schema=public", "--schema=auth", `--section=${section}`])).replace(/^CREATE SCHEMA public;\r?\n/gm, "")
    await writeFile(path.join(directory, `${section}.sql`), sql)
    hashes[section] = createHash("sha256").update(sql).digest("hex")
  }
  await first.exec("commit")
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ref: "lsazydefvnuqglultqii", ...metadata, sha256: hashes }))
  await restoreSnapshot(directory, async db => {
    assert.equal((await db.query("select public.recovery_permission_probe(null) ok")).rows[0].ok, true)
    assert.equal((await db.query("select pg_get_userbyid(relowner) owner from pg_class where oid='public.recovery_probe_rows'::regclass")).rows[0].owner, "probe_table_owner")
    assert.equal((await db.query("show row_security")).rows[0].row_security, "on")
  })
  console.log("Hosted restore regression passed: distinct object/function owners, schema-qualified row types, extension access and RLS execution.")
  console.log("Empty project bootstrap, schema/data restore, identity, wallet, ledger, grants and no duplicate enrollment credit passed on PostgreSQL 17.")
} finally { await Promise.all([first.close(), restored.close()]) }
