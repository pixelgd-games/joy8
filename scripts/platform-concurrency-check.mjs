import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { randomBytes, randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"

const db = await createLocalPostgres()
const secret = randomBytes(32).toString("hex")
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const launchSql = "select * from public.create_game_session('test-game','POINT',3600,null,$1)"
const openSql = "select public.joy8_open_match_v1($1,$2::jsonb) result"
const settleSql = "select public.joy8_settle_match_v1($1,$2::jsonb) result"
let game
before(async () => {
  await loadPlatformDatabase(db)
  game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("update public.joy8_wallet_policies set initial_credit=1000,guest_initial_credit=1000,enabled=true returning id")).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount) values($1,$2,true,1000)", [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','renew','open','settle','status','cancel'],now()+interval '1 day')", [game, secret])
})
after(() => db.close())

async function identity() {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  const member = await one("select * from public.joy8_resolve_member($1,true)", [auth])
  return { auth, id: member.player_account_id }
}
async function ready() {
  const player = await identity()
  const session = await one(launchSql, [player.auth])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [secret, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  return { ...player, ...session }
}
const opening = (members, ref = randomUUID()) => ({ version: 1, match_ref: ref, rule_version: "v1", participants: members.map(p => ({ session_id: p.session_id, reserve: "100.00" })) })
const settlement = (members, ref) => ({ version: 1, match_ref: ref, rule_version: "v1", operation_key: `result:${ref}`, entries: members.map((p, i) => ({ kind: "player", account_ref: p.id, amount: i ? "90.00" : "-90.00", source: "gameplay" })) })
async function race(hold, holdValues, works, release = "commit") {
  const gate = await db.connect(), clients = [], pending = []
  try {
    await gate.query("begin")
    await gate.query(hold, holdValues)
    for (const [sql, values, role = "service_role"] of works) {
      const client = await db.connect()
      clients.push(client)
      assert.ok(["service_role", "joy8_test"].includes(role))
      await client.query(`set role ${role}`)
      pending.push(client.query(sql, values).then(r => ({ rows: r.rows }), error => ({ error })))
    }
    const deadline = Date.now() + 5000
    let blocked = false
    while (Date.now() < deadline) {
      const row = await one("select count(*)::int n from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0", [clients.map(c => c.processID)])
      if (row.n === clients.length) { blocked = true; break }
      await delay(10)
    }
    assert.ok(blocked, "Every competing call must wait on an observed PostgreSQL lock")
    assert.ok(["commit", "rollback"].includes(release))
    await gate.query(release)
    return await Promise.all(pending)
  } finally {
    await gate.query("rollback")
    await Promise.allSettled(pending)
    await Promise.allSettled(clients.map(c => c.end()))
    await gate.end()
  }
}
function success(results) {
  for (const result of results) assert.equal(result.error, undefined, result.error?.message)
  return results.map(r => r.rows[0])
}

test("simultaneous operational launches provision one wallet and one grant", async () => {
  const p = await identity()
  const results = success(await race("update public.player_accounts set display_name=display_name where id=$1", [p.id], Array.from({ length: 6 }, () => [launchSql, [p.auth]])))
  assert.equal(new Set(results.map(r => r.wallet_account_id)).size, 1)
  assert.equal((await one("select count(*)::int n from public.wallet_transactions where wallet_account_id=$1", [results[0].wallet_account_id])).n, 1)
})

test("two competing matches cannot reserve the same wallet", async () => {
  const p = await ready()
  const results = await race("select id from public.wallet_accounts where id=$1 for update", [p.wallet_account_id], [opening([p]), opening([p])].map(body => [openSql, [secret, JSON.stringify(body)]]))
  assert.equal(results.filter(r => !r.error).length, 1)
  assert.equal(results.filter(r => r.error?.message.includes("JOY8_WALLET_OCCUPIED")).length, 1)
  assert.equal((await one("select locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id])).locked_balance, "100.00")
})

test("simultaneous identical settlement retries commit once", async () => {
  const players = [await ready(), await ready()], body = opening(players)
  await db.query(openSql, [secret, JSON.stringify(body)])
  const request = JSON.stringify(settlement(players, body.match_ref))
  const results = success(await race("select pg_advisory_xact_lock(hashtextextended($1,1))", [`${game}:${body.match_ref}`], Array.from({ length: 6 }, () => [settleSql, [secret, request]])))
  assert.equal(new Set(results.map(r => r.result.settlement_id)).size, 1)
  assert.equal((await one("select balance,locked_balance from public.wallet_accounts where id=$1", [players[0].wallet_account_id])).balance, "910.00")
})

test("changed concurrent retry conflicts with the committed content", async () => {
  const players = [await ready(), await ready()], body = opening(players)
  await db.query(openSql, [secret, JSON.stringify(body)])
  const request = settlement(players, body.match_ref)
  const changed = { ...request, entries: request.entries.map(e => ({ ...e, amount: e.amount.replace("90", "80") })) }
  const results = await race(settleSql, [secret, JSON.stringify(request)], [[settleSql, [secret, JSON.stringify(changed)]]])
  assert.match(results[0].error.message, /JOY8_IDEMPOTENCY_CONFLICT/)
})

test("freeze committed first rejects every waiting settlement without partial accounting", async () => {
  const players = [await ready(), await ready()], body = opening(players)
  await db.query(openSql, [secret, JSON.stringify(body)])
  const results = await race("update public.wallet_accounts set status='frozen' where id=$1", [players[0].wallet_account_id], [[settleSql, [secret, JSON.stringify(settlement(players, body.match_ref))]]])
  assert.match(results[0].error.message, /JOY8_WALLET_INACTIVE/)
  for (const p of players) assert.equal((await one("select balance from public.wallet_accounts where id=$1", [p.wallet_account_id])).balance, "1000.00")
})

test("settlement committed first completes before a waiting freeze", async () => {
  const players = [await ready(), await ready()], body = opening(players)
  await db.query(openSql, [secret, JSON.stringify(body)])
  success(await race(settleSql, [secret, JSON.stringify(settlement(players, body.match_ref))], [["update public.wallet_accounts set status='frozen' where id=$1 returning id", [players[0].wallet_account_id], "joy8_test"]]))
  assert.equal((await one("select balance from public.wallet_accounts where id=$1", [players[0].wallet_account_id])).balance, "910.00")
})

test("revocation committed first rejects a queued server operation", async () => {
  const p = await ready()
  const results = await race("update public.joy8_backend_keys set revoked_at=now() where game_id=$1", [game], [[openSql, [secret, JSON.stringify(opening([p]))]]])
  assert.match(results[0].error.message, /JOY8_BACKEND_UNAUTHORIZED/)
  await db.query("update public.joy8_backend_keys set revoked_at=null where game_id=$1", [game])
})

test("rolled back settlement permits the waiting retry to commit once", async () => {
  const players = [await ready(), await ready()], body = opening(players)
  await db.query(openSql, [secret, JSON.stringify(body)])
  const values = [secret, JSON.stringify(settlement(players, body.match_ref))]
  success(await race(settleSql, values, [[settleSql, values]], "rollback"))
  assert.equal((await one("select balance from public.wallet_accounts where id=$1", [players[0].wallet_account_id])).balance, "910.00")
})
