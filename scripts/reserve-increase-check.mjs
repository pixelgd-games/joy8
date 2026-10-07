import { googleIdentity } from "./fixtures/google-identity.mjs"
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { after, afterEach, before, beforeEach, describe, test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const native = process.env.JOY8_TEST_ENGINE === "postgres17"
const db = await createTestDatabase()
const secret = randomBytes(32).toString("hex")
const statusOnly = randomBytes(32).toString("hex")
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
let game

before(async () => {
  await loadCurrentPlatform(db)
  await loadProductAccounting(db)
  game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("update public.joy8_wallet_policies set initial_credit=20000,enabled=true returning id")).id
  await db.query(`insert into public.joy8_game_policies(
    game_id,wallet_policy_id,enabled,min_bet_amount,max_bet_amount,max_payout_amount,max_participants,funding_mode,reserve_increase_enabled
  ) values($1,$2,true,10,10000,21000,1,'platform',true)`, [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','open','settle','status','cancel','reserve'])", [game, secret])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['open','settle','status','cancel'])", [game, statusOnly])
})
after(() => db.close())

async function gateway(route, body, key = secret) {
  return (await one("select public.joy8_server_request_v1($1,$2,10000,60,$3,$4::jsonb) result", [
    route, `ingress:${randomUUID()}`, key, JSON.stringify(body),
  ])).result
}
const failure = packet => packet.admission_error ?? packet.error?.message
const wallet = player => one("select balance::text,locked_balance::text,(balance-locked_balance)::text available from public.wallet_accounts where id=$1", [player.wallet_account_id])

async function ready() {
  const auth = await googleIdentity(db)
  const player = await one("select * from public.joy8_resolve_member($1,true)", [auth])
  const session = await one("select * from public.create_game_session('test-game',$1)", [auth])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [secret, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  return { ...session, player: player.player_account_id }
}
async function open(player, reserve = "100.00") {
  const body = { version: 1, match_ref: randomUUID(), rule_version: "fixture-rules-v1", participants: [{ session_id: player.session_id, reserve }] }
  assert.equal((await gateway("server-open-v1", body)).result.state, "open")
  return body.match_ref
}
const raise = (player, matchRef, amount, operationKey = randomUUID()) => ({
  version: 1, match_ref: matchRef, operation_key: operationKey, account_ref: player.player, amount,
})
const lookup = (matchRef, operationKey) => ({ version: 1, match_ref: matchRef, operation_key: operationKey })
const settle = (player, matchRef, amount, number = 1, final = true) => ({
  version: 1, match_ref: matchRef, rule_version: "fixture-rules-v1", operation_key: `${matchRef}:settle:${number}`,
  settlement_no: number, final, entries: amount === null ? [] : [{ kind: "player", account_ref: player.player, amount, source: "gameplay" }],
})
const reconciled = async () => assert.equal((await one(`select count(*)::int n from public.wallet_accounts w
  where w.locked_balance<>coalesce((select sum(p.reserved_amount) from public.joy8_match_participants p
    where p.wallet_account_id=w.id and p.released_at is null),0)`)).n, 0)

describe("match reserve increase", () => {
  beforeEach(() => db.exec("begin"))
  afterEach(() => db.exec("rollback"))

  test("increases accumulate, report the new reserve and available POINT, and settle against the total", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const body = raise(player, matchRef, "100.00")
    const { match_id: matchId, ...first } = (await gateway("server-reserve-v1", body)).result
    assert.match(matchId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(first, {
      version: 1, state: "open", operation_key: body.operation_key, operation_state: "applied",
      amount: "100.00", reserve: "200.00", available_balance: "19800.00",
    })
    const second = (await gateway("server-reserve-v1", raise(player, matchRef, "50.50"))).result
    assert.equal(second.reserve, "250.50")
    assert.deepEqual(await wallet(player), { balance: "20000.00", locked_balance: "250.50", available: "19749.50" })
    await reconciled()
    const settled = (await gateway("server-settle-v1", settle(player, matchRef, "-250.50"))).result
    assert.equal(settled.state, "settled")
    assert.deepEqual(await wallet(player), { balance: "19749.50", locked_balance: "0.00", available: "19749.50" })
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "1.00"))), "JOY8_MATCH_FINALIZED")
  })

  test("the same operation key replays without another hold and changed content conflicts", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const body = raise(player, matchRef, "100.00")
    const first = (await gateway("server-reserve-v1", body)).result
    const replay = (await gateway("server-reserve-v1", body)).result
    assert.deepEqual(replay, first)
    assert.equal((await wallet(player)).locked_balance, "200.00")
    assert.equal(failure(await gateway("server-reserve-v1", { ...body, amount: "100.01" })), "JOY8_IDEMPOTENCY_CONFLICT")
    const other = await ready()
    const otherMatch = await open(other)
    assert.equal(failure(await gateway("server-reserve-v1", raise(other, otherMatch, "100.00", body.operation_key))), "JOY8_IDEMPOTENCY_CONFLICT")
    assert.equal((await one("select count(*)::int n from public.joy8_reserve_operations where operation_key=$1", [body.operation_key])).n, 1)
  })

  test("limit, balance and identity failures leave the existing reserve unchanged", async () => {
    const player = await ready()
    const matchRef = await open(player, "9000.00")
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "1000.01"))), "JOY8_LIMIT_EXCEEDED")
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "0.00"))), "JOY8_LIMIT_EXCEEDED")
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "1.001"))), "JOY8_INVALID_AMOUNT")
    assert.equal(failure(await gateway("server-reserve-v1", raise({ player: randomUUID() }, matchRef, "1.00"))), "JOY8_INVALID_ENTRY")
    await db.query("update public.wallet_accounts set balance=9500 where id=$1", [player.wallet_account_id])
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "500.01"))), "JOY8_INSUFFICIENT_BALANCE")
    assert.deepEqual(await wallet(player), { balance: "9500.00", locked_balance: "9000.00", available: "500.00" })
    assert.equal((await gateway("server-reserve-v1", raise(player, matchRef, "500.00"))).result.reserve, "9500.00")
    assert.equal((await one("select count(*)::int n from public.joy8_reserve_operations")).n, 1)
  })

  test("the platform payout limit applies to the accumulated stake", async () => {
    const player = await ready()
    const matchRef = await open(player, "1000.00")
    await gateway("server-reserve-v1", raise(player, matchRef, "1000.00"))
    assert.equal(failure(await gateway("server-settle-v1", settle(player, matchRef, "19000.01"))), "JOY8_LIMIT_EXCEEDED")
    assert.equal((await gateway("server-settle-v1", settle(player, matchRef, "19000.00"))).result.available_balance, "39000.00")
  })

  test("increases close once settlement starts and match cancel releases every increase", async () => {
    const player = await ready()
    const matchRef = await open(player)
    await gateway("server-settle-v1", settle(player, matchRef, null, 1, false))
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "10.00"))), "JOY8_RESERVE_CLOSED")
    const holder = await ready()
    const second = await open(holder)
    await gateway("server-reserve-v1", raise(holder, second, "300.00"))
    await gateway("server-reserve-v1", raise(holder, second, "200.00"))
    assert.equal((await wallet(holder)).locked_balance, "600.00")
    assert.equal((await gateway("server-cancel-v1", { version: 1, match_ref: second })).result.state, "cancelled")
    assert.deepEqual(await wallet(holder), { balance: "20000.00", locked_balance: "0.00", available: "20000.00" })
    await reconciled()
  })

  test("one increase can be cancelled, a cancel before arrival blocks the late increase, and status never writes", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const body = raise(player, matchRef, "100.00")
    assert.equal((await gateway("server-reserve-status-v1", lookup(matchRef, body.operation_key))).result.operation_state, "not_found")
    assert.equal((await one("select count(*)::int n from public.joy8_reserve_operations")).n, 0)
    await gateway("server-reserve-v1", body)
    await gateway("server-reserve-v1", raise(player, matchRef, "40.00"))
    const status = (await gateway("server-reserve-status-v1", lookup(matchRef, body.operation_key))).result
    assert.deepEqual([status.operation_state, status.amount, status.reserve], ["applied", "100.00", "240.00"])
    const cancelled = (await gateway("server-reserve-cancel-v1", lookup(matchRef, body.operation_key))).result
    assert.deepEqual([cancelled.operation_state, cancelled.amount, cancelled.reserve, cancelled.available_balance], ["cancelled", "100.00", "140.00", "19860.00"])
    assert.deepEqual((await gateway("server-reserve-cancel-v1", lookup(matchRef, body.operation_key))).result, cancelled)
    assert.equal(failure(await gateway("server-reserve-v1", body)), "JOY8_RESERVE_CANCELLED")
    const late = raise(player, matchRef, "70.00")
    const tombstone = (await gateway("server-reserve-cancel-v1", lookup(matchRef, late.operation_key))).result
    assert.deepEqual([tombstone.operation_state, tombstone.amount, tombstone.reserve], ["cancelled", null, null])
    assert.equal(failure(await gateway("server-reserve-v1", late)), "JOY8_RESERVE_CANCELLED")
    assert.equal((await wallet(player)).locked_balance, "140.00")
    await reconciled()
    await gateway("server-settle-v1", settle(player, matchRef, "-140.00"))
    assert.equal((await wallet(player)).balance, "19860.00")
  })

  test("a single increase cannot be cancelled after settlement starts or completes", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const body = raise(player, matchRef, "100.00")
    await gateway("server-reserve-v1", body)
    await gateway("server-settle-v1", settle(player, matchRef, "-50.00", 1, false))
    assert.equal(failure(await gateway("server-reserve-cancel-v1", lookup(matchRef, body.operation_key))), "JOY8_RESERVE_CLOSED")
    await gateway("server-settle-v1", settle(player, matchRef, null, 2, true))
    assert.equal(failure(await gateway("server-reserve-cancel-v1", lookup(matchRef, body.operation_key))), "JOY8_MATCH_FINALIZED")
    const status = (await gateway("server-reserve-status-v1", lookup(matchRef, body.operation_key))).result
    assert.deepEqual([status.state, status.operation_state, status.reserve], ["settled", "applied", null])
  })

  test("the feature is snapshotted per match and limited to capped platform policies", async () => {
    await db.query("update public.joy8_game_policies set reserve_increase_enabled=false where game_id=$1", [game])
    const player = await ready()
    const matchRef = await open(player)
    await db.query("update public.joy8_game_policies set reserve_increase_enabled=true where game_id=$1", [game])
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "10.00"))), "JOY8_GAME_NOT_READY")
    const holder = await ready()
    const enabled = await open(holder)
    await db.query("update public.joy8_game_policies set enabled=false where game_id=$1", [game])
    assert.equal(failure(await gateway("server-reserve-v1", raise(holder, enabled, "10.00"))), "JOY8_GAME_NOT_READY")
    await db.exec("savepoint mode")
    await assert.rejects(db.query(`update public.joy8_game_policies set funding_mode='participants',
      product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1`, [game]), /joy8_game_policies_reserve_increase_check/)
    await db.exec("rollback to savepoint mode")
    await assert.rejects(db.query("update public.joy8_backend_keys set scopes=array['reserve','withdraw'] where game_id=$1", [game]), /joy8_backend_keys_scopes_check/)
    await db.exec("rollback to savepoint mode; release savepoint mode")
  })

  test("increases need the reserve scope, a live session and an active wallet; status uses the status scope", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const body = raise(player, matchRef, "10.00")
    assert.equal(failure(await gateway("server-reserve-v1", body, statusOnly)), "JOY8_BACKEND_UNAUTHORIZED")
    assert.equal(failure(await gateway("server-reserve-cancel-v1", lookup(matchRef, body.operation_key), statusOnly)), "JOY8_BACKEND_UNAUTHORIZED")
    assert.equal((await gateway("server-reserve-status-v1", lookup(matchRef, body.operation_key), statusOnly)).result.operation_state, "not_found")
    await db.query("update public.wallet_accounts set status='frozen' where id=$1", [player.wallet_account_id])
    assert.equal(failure(await gateway("server-reserve-v1", body)), "JOY8_WALLET_INACTIVE")
    await db.query("update public.wallet_accounts set status='active' where id=$1", [player.wallet_account_id])
    await db.query("update public.game_sessions set status='expired' where id=$1", [player.session_id])
    assert.equal(failure(await gateway("server-reserve-v1", body)), "JOY8_SESSION_INVALID")
    assert.equal((await gateway("server-settle-v1", settle(player, matchRef, "-100.00"))).result.state, "settled")
  })

  test("increases keep wallet occupancy, stop at fifty operations and use the match budget", async () => {
    const player = await ready()
    const matchRef = await open(player, "10.00")
    const other = { version: 1, match_ref: randomUUID(), rule_version: "fixture-rules-v1", participants: [{ session_id: player.session_id, reserve: "10.00" }] }
    assert.equal(failure(await gateway("server-open-v1", other)), "JOY8_WALLET_OCCUPIED")
    for (let n = 0; n < 50; n++) {
      await db.exec("delete from public.gateway_rate_limits")
      assert.equal((await gateway("server-reserve-v1", raise(player, matchRef, "1.00"))).result.operation_state, "applied")
    }
    assert.equal(failure(await gateway("server-reserve-v1", raise(player, matchRef, "1.00"))), "JOY8_LIMIT_EXCEEDED")
    await db.exec("delete from public.gateway_rate_limits")
    const admit = route => one("select public.joy8_admit_gateway_request($1,$2::jsonb,$3,null) result", [route, JSON.stringify(lookup(matchRef, "x")), secret])
    for (let n = 0; n < 30; n++) assert.equal((await admit(n % 2 ? "server-reserve-v1" : "server-reserve-cancel-v1")).result.allowed, true)
    assert.equal((await admit("server-reserve-v1")).result.allowed, false)
    assert.equal((await admit("server-reserve-status-v1")).result.allowed, true)
    assert.equal((await admit("server-open-v1")).result.allowed, true)
  })

  test("browser and product roles cannot read operations or call the reserve function", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`savepoint denied; set local role ${role}`)
      await assert.rejects(db.query("select * from public.joy8_reserve_operations"), /permission denied/)
      await db.exec("rollback to savepoint denied")
      await db.exec(`set local role ${role}`)
      await assert.rejects(db.query("select public.joy8_reserve_operation_v1($1,'reserve-status','{}'::jsonb)", [secret]), /permission denied/)
      await db.exec("rollback to savepoint denied; release savepoint denied")
    }
    await db.exec("savepoint denied; set local role service_role")
    await assert.rejects(db.query("select * from public.joy8_reserve_operations"), /permission denied/)
    await db.exec("rollback to savepoint denied; release savepoint denied")
  })
})

const reserveSql = "select public.joy8_reserve_operation_v1($1,$2,$3::jsonb) result"
const settleSql = "select public.joy8_settle_match_v1($1,$2::jsonb) result"
const cancelSql = "select public.joy8_match_status_v1($1,$2::jsonb,true) result"

async function race(hold, holdValues, works) {
  const gate = await db.connect(), clients = [], pending = []
  try {
    await gate.query("begin")
    await gate.query(hold, holdValues)
    for (const [sql, values] of works) {
      const client = await db.connect()
      clients.push(client)
      await client.query("set role service_role")
      pending.push(client.query(sql, values).then(r => ({ rows: r.rows }), error => ({ error })))
    }
    let blocked = false
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const row = await one("select count(*)::int n from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0", [clients.map(c => c.processID)])
      if (row.n === clients.length) { blocked = true; break }
      await delay(10)
    }
    assert.ok(blocked, "Every competing call waits on an observed PostgreSQL lock")
    await gate.query("commit")
    return await Promise.all(pending)
  } finally {
    await gate.query("rollback")
    await Promise.allSettled(pending)
    await Promise.allSettled(clients.map(c => c.end()))
    await gate.end()
  }
}

describe("PostgreSQL 17 competing reserve increases", { skip: !native }, () => {
  const matchLock = matchRef => ["select pg_advisory_xact_lock(hashtextextended($1,1))", [`${game}:${matchRef}`]]

  test("simultaneous retries of one increase hold the amount once", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const body = JSON.stringify(raise(player, matchRef, "100.00"))
    const results = await race(...matchLock(matchRef), Array.from({ length: 4 }, () => [reserveSql, [secret, "reserve", body]]))
    for (const r of results) assert.equal(r.error, undefined, r.error?.message)
    assert.equal(new Set(results.map(r => r.rows[0].result.reserve)).size, 1)
    assert.equal((await wallet(player)).locked_balance, "200.00")
  })

  test("two different increases cannot pass the accumulated bet limit together", async () => {
    const player = await ready()
    const matchRef = await open(player, "9000.00")
    const results = await race(...matchLock(matchRef), [600, 700].map(amount =>
      [reserveSql, [secret, "reserve", JSON.stringify(raise(player, matchRef, `${amount}.00`))]]))
    assert.equal(results.filter(r => r.error).length, 1)
    assert.match(results.find(r => r.error).error.message, /JOY8_LIMIT_EXCEEDED/)
    assert.ok(["9600.00", "9700.00"].includes((await wallet(player)).locked_balance))
    await reconciled()
  })

  test("an increase waiting on a final settlement or cancel is rejected without a hold", async () => {
    for (const close of ["settle", "cancel"]) {
      const player = await ready()
      const matchRef = await open(player)
      const hold = close === "settle" ? [settleSql, [secret, JSON.stringify(settle(player, matchRef, "-100.00"))]]
        : [cancelSql, [secret, JSON.stringify({ version: 1, match_ref: matchRef })]]
      const results = await race(...hold, [[reserveSql, [secret, "reserve", JSON.stringify(raise(player, matchRef, "50.00"))]]])
      assert.match(results[0].error.message, /JOY8_MATCH_FINALIZED/)
      assert.equal((await wallet(player)).locked_balance, "0.00")
    }
    await reconciled()
  })

  test("a final settlement waiting on an increase settles against the new total", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const results = await race(reserveSql, [secret, "reserve", JSON.stringify(raise(player, matchRef, "100.00"))],
      [[settleSql, [secret, JSON.stringify(settle(player, matchRef, "-200.00"))]]])
    assert.equal(results[0].error, undefined, results[0].error?.message)
    assert.deepEqual(await wallet(player), { balance: "19800.00", locked_balance: "0.00", available: "19800.00" })
  })

  test("a committed cancel before arrival rejects the waiting late increase", async () => {
    const player = await ready()
    const matchRef = await open(player)
    const late = raise(player, matchRef, "100.00")
    const results = await race(reserveSql, [secret, "reserve-cancel", JSON.stringify(lookup(matchRef, late.operation_key))],
      [[reserveSql, [secret, "reserve", JSON.stringify(late)]]])
    assert.match(results[0].error.message, /JOY8_RESERVE_CANCELLED/)
    assert.equal((await wallet(player)).locked_balance, "100.00")
  })
})
