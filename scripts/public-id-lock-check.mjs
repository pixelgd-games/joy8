import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"

const db = await createLocalPostgres()
before(async () => {
  await loadCurrentPlatform(db)
})
after(() => db.close())

test("a candidate committed between the two reads releases its rejected lock", async () => {
  const gate = await db.connect()
  const client = await db.connect()
  const original = (await db.query("select pg_get_functiondef('public.joy8_allocate_public_player_id()'::regprocedure) body")).rows[0].body
  let pending
  try {
    const anchor = "if pg_catalog.pg_try_advisory_xact_lock"
    assert.ok(original.includes(anchor))
    await db.exec(original.replace(anchor, `perform pg_catalog.pg_advisory_xact_lock(75080004);\n      ${anchor}`))
    await gate.query("select pg_advisory_lock(75080004); select setseed(0.51)")
    const candidate = (await gate.query("select (floor(random()*900000)+100000)::int::text id")).rows[0].id
    const pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid
    await client.query("begin; set local statement_timeout=5000; select setseed(0.51)")
    pending = client.query("insert into public.player_accounts(account_type) values('guest') returning public_id")
    pending.catch(() => {})
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const locks = await gate.query("select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted", [pid])
      if (locks.rowCount) { waiting = true; break }
      await delay(20)
    }
    assert.equal(waiting, true, "allocator must pause after its first candidate lookup")
    await gate.query("insert into public.player_accounts(account_type,public_id) values('guest',$1)", [candidate])
    await gate.query("select pg_advisory_unlock(75080004)")
    const assigned = (await pending).rows[0].public_id
    assert.notEqual(assigned, candidate)
    const locks = (await gate.query("select objid::text id from pg_locks where pid=$1 and locktype='advisory' and classid=75080002 and granted", [pid])).rows
    assert.deepEqual(locks, [{ id: assigned }])
    await client.query("rollback")
    assert.equal((await gate.query("select 1 from pg_locks where pid=$1 and locktype='advisory' and classid=75080002", [pid])).rowCount, 0)
  } finally {
    await gate.query("select pg_advisory_unlock_all()")
    await pending?.catch(() => {})
    await client.query("rollback")
    await db.exec(original)
    await client.end()
    await gate.end()
  }
})
