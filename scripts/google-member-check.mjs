import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { googleIdentity } from "./fixtures/google-identity.mjs"

const db = await createTestDatabase()
before(() => loadCurrentPlatform(db))
after(() => db.close())

test("Google enrollment grants exactly 1000 POINT once under retries and competing connections", async () => {
  const id = await googleIdentity(db)
  const clients = db.connect ? await Promise.all(Array.from({ length: 8 }, () => db.connect())) : Array(8).fill(db)
  try {
    const results = await Promise.all(clients.map(client => client.query("select * from public.joy8_resolve_member($1,true)", [id])))
    assert.equal(new Set(results.map(result => result.rows[0].player_account_id)).size, 1)
    const player = results[0].rows[0].player_account_id
    assert.deepEqual((await db.query("select balance::text from public.wallet_accounts where player_account_id=$1", [player])).rows, [{ balance: "1000.00" }])
    assert.deepEqual((await db.query("select t.source_type,t.amount::text from public.wallet_transactions t join public.wallet_accounts w on w.id=t.wallet_account_id where w.player_account_id=$1", [player])).rows,
      [{ source_type: "initial_grant", amount: "1000.00" }])
    await db.exec("begin read only")
    assert.equal((await db.query("select * from public.joy8_resolve_member($1,false)", [id])).rows[0].player_account_id, player)
    await db.exec("rollback")
  } finally { if (db.connect) await Promise.all(clients.map(client => client.end())) }
})

test("retired account models are absent and anonymous users cannot create a player or wallet", async () => {
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and column_name in ('guest_initial_credit','upgraded_at')")).rows[0].n, 0)
  const id = (await db.query("insert into auth.users(is_anonymous) values(true) returning id")).rows[0].id
  await assert.rejects(db.query("select * from public.joy8_resolve_member($1,true)", [id]), /JOY8_GUEST_DISABLED/)
  assert.equal((await db.query("select count(*)::int n from public.player_accounts where auth_user_id=$1", [id])).rows[0].n, 0)
  const definitions = (await db.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('joy8_resolve_member','joy8_grant_member_point')")).rows
  assert.ok(definitions.every(row => !/guest|upgraded_at|registration_grant/.test(row.prosrc)))
})
