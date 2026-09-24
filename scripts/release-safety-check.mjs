import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const secret = randomBytes(32).toString("hex")
let game
before(async () => {
  for (const source of (await buildPlatformBundle()).sources) await db.exec(source.sql)
  game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("update public.joy8_wallet_policies set initial_credit=20000,guest_initial_credit=20000 returning id")).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,max_participants,funding_mode) values($1,$2,true,10000,1000000,1,'platform')", [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','open','settle','cancel','status'],now()+interval '1 day')", [game, secret])
  await loadProductAccounting(db)
})
after(() => db.close())
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))

async function denied(action, pattern) {
  await db.exec("savepoint rejection")
  await assert.rejects(action, pattern)
  await db.exec("rollback to savepoint rejection; release savepoint rejection")
}
async function player() {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  await db.query("select * from public.joy8_resolve_member($1,true)", [auth])
  const session = await one("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])
  await rpc("joy8_server_session_v1", { version: 1, launch_code: session.launch_code }, "exchange")
  return session
}
async function rpc(name, body, action) {
  await db.exec("savepoint operation; set local role service_role")
  try {
    const sql = action ? `select public.${name}($1,$2,$3::jsonb) result` : `select public.${name}($1,$2::jsonb) result`
    const result = (await one(sql, action ? [secret, action, JSON.stringify(body)] : [secret, JSON.stringify(body)])).result
    await db.exec("reset role; release savepoint operation")
    return result
  } catch (error) { await db.exec("rollback to savepoint operation; release savepoint operation"); throw error }
}
const openBody = p => ({ version: 1, match_ref: randomUUID(), rule_version: "v1", participants: [{ session_id: p.session_id, reserve: "1.00" }] })
const settleBody = (p, body, amount, n = 1, final = false) => ({ version: 1, match_ref: body.match_ref, rule_version: "v1", operation_key: `${body.match_ref}:${n}`, settlement_no: n, final, entries: amount === null ? [] : [{ kind: "player", account_ref: p.player_account_id, amount, source: "gameplay" }] })
const cancel = body => one("select public.joy8_operator_cancel_match($1,$2,$3,$4,$5) result", [game, body.match_ref, 0, "Product confirmed void", "incident:approved-void-proof"])

test("platform matches open without a per-game payout budget", async () => {
  assert.equal((await one("select to_regclass('public.joy8_payout_budgets') value")).value, null)
  const p = await player()
  await rpc("joy8_open_match_v1", openBody(p))
  assert.equal((await one("select locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id])).locked_balance, "1.00")
})

test("operator recovery requires evidence, preserves balance and is exactly repeatable", async () => {
  const p = await player(), body = openBody(p)
  await rpc("joy8_open_match_v1", body)
  await denied(() => one("select public.joy8_operator_cancel_match($1,$2,0,'timeout','')", [game, body.match_ref]), /EVIDENCE_REQUIRED/)
  await denied(() => one("select public.joy8_operator_cancel_match($1,$2,1,'Product confirmed void','incident:approved-void-proof')", [game, body.match_ref]), /STATE_CHANGED/)
  const result = await cancel(body)
  assert.deepEqual(await cancel(body), result)
  assert.deepEqual(await one("select balance,locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id]), { balance: "20000.00", locked_balance: "0.00" })
  assert.equal((await one("select count(*)::int n from public.joy8_match_recoveries")).n, 1)
  await denied(() => db.exec("delete from public.joy8_match_recoveries"), /JOY8_RECOVERY_IMMUTABLE/)
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set local role ${role}`)
    await denied(() => cancel(body), /permission denied/)
    await db.exec("reset role")
  }
})

test("administrator authority binds verified Google Auth identity, never a matching email claim", async () => {
  const id = (await one("insert into auth.users(email,email_confirmed_at) values('admin@example.test',now()) returning id")).id
  await db.query("insert into public.admin_users(email) values('admin@example.test')")
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ email: "admin@example.test", app_metadata: { provider: "email" } })])
  assert.equal((await one("select public.is_joy8_admin() allowed")).allowed, false)
  await db.query("insert into auth.identities values($1,'google')", [id])
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ app_metadata: { provider: "google" } })])
  assert.equal((await one("select public.is_joy8_admin() allowed")).allowed, true)
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [id])
  assert.equal((await one("select public.is_joy8_admin() allowed")).allowed, false)
})

test("operator recovery rolls back all reservation changes when the product refuses cancellation", async () => {
  await db.query("update public.joy8_game_policies set funding_mode='participants',max_participants=2,product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [game])
  const p = await player(), body = { ...openBody(p), product_participants: [{ account_ref: "bot-1", reserve: "1.00" }] }
  await rpc("joy8_open_match_v1", body)
  await db.exec("update fixture_product.matches set state='blocked'")
  await denied(() => cancel(body), /query returned no rows/)
  assert.equal((await one("select locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id])).locked_balance, "1.00")
  assert.equal((await one("select state from public.joy8_matches where match_ref=$1", [body.match_ref])).state, "open")
  assert.equal((await one("select count(*)::int n from public.joy8_match_recoveries")).n, 0)
})

test("operator recovery preserves previously committed payouts", async () => {
  const p = await player(), body = openBody(p)
  await rpc("joy8_open_match_v1", body)
  await rpc("joy8_settle_match_v1", settleBody(p, body, "10.00"))
  await one("select public.joy8_operator_cancel_match($1,$2,1,$3,$4)", [game, body.match_ref, "Product confirmed void", "incident:approved-void-proof"])
  assert.deepEqual(await one("select balance,locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id]), { balance: "20010.00", locked_balance: "0.00" })
  assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n, 1)
})

test("private-entry pause preserves identities, sessions and financial records", async () => {
  await db.exec("delete from public.joy8_backend_keys")
  await db.exec(await readFile("supabase/migrations/20260923143700_private_entry_pause.sql", "utf8").then(sql => sql.replace(/^begin;|commit;\s*$/g, "")))
  assert.equal((await one("select count(*)::int n from public.joy8_private_entries e join public.games g on g.id=e.game_id where g.slug='monster-lab' and e.enabled")).n, 0)
})

test("scheduled cleanup expires credentials without releasing occupied wallet funds", async () => {
  const sql = await readFile("supabase/migrations/20260923143740_runtime_maintenance.sql", "utf8")
  await db.exec(sql.split("create extension")[0].replace(/^begin;/, ""))
  const p = await player(), body = openBody(p)
  await rpc("joy8_open_match_v1", body)
  await db.query("update public.game_sessions set expires_at=now()-interval '1 second' where id=$1", [p.session_id])
  await db.exec("insert into public.gateway_rate_limits(bucket_key_hash,window_started_at,expires_at) values('expired',now(),now()-interval '1 second'),('live',now(),now()+interval '1 hour')")
  assert.deepEqual(await one("select * from public.joy8_cleanup_gateway_runtime()"), { expired_sessions: 1, removed_rate_limits: 1 })
  assert.equal((await one("select locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id])).locked_balance, "1.00")
  assert.equal((await one("select state from public.joy8_matches where match_ref=$1", [body.match_ref])).state, "open")
  assert.equal((await one("select count(*)::int n from public.gateway_rate_limits")).n, 1)
})
