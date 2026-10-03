import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { restoreSnapshot } from "./restore-snapshot.mjs"

const snapshot = process.argv[2]
assert.ok(snapshot, "Pass a verified local recovery snapshot directory")
await restoreSnapshot(snapshot, async db => {
  const before = (await db.query("select count(*)::text n,coalesce(sum(balance),0)::text balance from public.wallet_accounts")).rows[0]
  for (const migration of ["20261003110000_baccarat_registration.sql", "20261003111000_baccarat_product_state.sql", "20261003112000_baccarat_tables.sql"]) {
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"))
  }
  const policy = (await db.query("select p.funding_mode,p.reservation_mode,p.min_bet_amount::text,p.max_bet_amount::text,p.max_payout_amount::text,p.max_participants,g.published from public.joy8_game_policies p join public.games g on g.id=p.game_id where g.slug='baccarat'")).rows[0]
  assert.deepEqual(policy, { funding_mode: "platform", reservation_mode: "capped", min_bet_amount: "10.00", max_bet_amount: "10000.00", max_payout_amount: "210000.00", max_participants: 1, published: false })
  assert.equal((await db.query("select count(*)::int n from baccarat.tables where enabled and game_id='6dc12d01-5760-4123-832f-6d0bd305404a'")).rows[0].n, 4)
  await db.exec("create role baccarat_runtime login inherit nosuperuser nobypassrls nocreatedb nocreaterole; grant baccarat_backend to baccarat_runtime")
  await db.exec("set session authorization baccarat_runtime")
  assert.equal((await db.query("select count(*)::int n from baccarat.tables")).rows[0].n, 4)
  await assert.rejects(db.query("select * from public.wallet_accounts"), /permission denied/)
  await assert.rejects(db.query("set role baccarat_owner"), /permission denied/)
  await assert.rejects(db.query("delete from baccarat.tables"), /permission denied/)
  await db.exec("reset session authorization")
  await db.query("select public.joy8_validate_product_adapters()")
  assert.deepEqual((await db.query("select count(*)::text n,coalesce(sum(balance),0)::text balance from public.wallet_accounts")).rows[0], before)
  console.log("Baccarat migrations passed on a restored hosted snapshot; hidden catalog, limits, four tables, runtime isolation and unchanged wallets verified.")
})
