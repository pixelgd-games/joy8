import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { after, afterEach, before, beforeEach, describe, test } from "node:test"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const secret = randomBytes(32).toString("hex")
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
let game

before(async () => {
  await loadCurrentPlatform(db)
  await loadProductAccounting(db)
  game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("update public.joy8_wallet_policies set initial_credit=20000,guest_initial_credit=20000,enabled=true returning id")).id
  await db.query(`insert into public.joy8_game_policies(
    game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,max_participants,funding_mode
  ) values($1,$2,true,10000,1000000,1,'platform')`, [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','open','settle','status','cancel'])", [game, secret])
})
after(() => db.close())

async function rpc(name, body) {
  assert.match(name, /^[a-z0-9_]+$/)
  await db.exec("savepoint rpc_call")
  try {
    await db.exec("set local role service_role")
    const result = await one(`select public.${name}($1,$2::jsonb) result`, [secret, JSON.stringify(body)])
    await db.exec("reset role; release savepoint rpc_call")
    return result.result
  } catch (error) {
    await db.exec("rollback to savepoint rpc_call; release savepoint rpc_call")
    throw error
  }
}
const denied = (promise, code) => assert.rejects(promise, error => error.message.includes(code))
async function deniedQuery(sql, values, code) {
  await db.exec("savepoint denied_query")
  try {
    await denied(db.query(sql, values), code)
  } finally {
    await db.exec("rollback to savepoint denied_query; release savepoint denied_query")
  }
}

async function ready() {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  const player = await one("select * from public.joy8_resolve_member($1,true)", [auth])
  const session = await one("select * from public.create_game_session('test-game',$1)", [auth])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [secret, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  return { ...session, player: player.player_account_id }
}

const opening = (player, reserve = "10000.00", extra = {}) => ({
  version: 1,
  match_ref: randomUUID(),
  rule_version: "fixture-rules-v1",
  participants: [{ session_id: player.session_id, reserve }],
  ...extra,
})
const settlement = (player, matchRef, amount, number = 1, final = true, extra = {}) => ({
  version: 1,
  match_ref: matchRef,
  rule_version: "fixture-rules-v1",
  operation_key: `${matchRef}:spin:${number}`,
  settlement_no: number,
  final,
  entries: amount === null ? [] : [{ kind: "player", account_ref: player.player, amount, source: "gameplay" }],
  ...extra,
})

describe("seamless wallet platform settlement", () => {
  beforeEach(() => db.exec("begin"))
  afterEach(() => db.exec("rollback"))

  test("policy separates the bet limit from the payout guard", async () => {
    const policy = await one("select max_bet_amount,max_payout_amount,max_participants,funding_mode,product_adapter from public.joy8_game_policies where game_id=$1", [game])
    assert.deepEqual(policy, {
      max_bet_amount: "10000.00",
      max_payout_amount: "1000000.00",
      max_participants: 1,
      funding_mode: "platform",
      product_adapter: null,
    })
    const player = await ready()
    await denied(rpc("joy8_open_match_v1", opening(player, "10000.01")), "JOY8_LIMIT_EXCEEDED")
    const body = opening(player)
    assert.equal((await rpc("joy8_open_match_v1", body)).state, "open")
    const saved = await one("select max_bet_amount,max_payout_amount,funding_mode,product_participants from public.joy8_matches where game_id=$1 and match_ref=$2", [game, body.match_ref])
    assert.equal(saved.max_bet_amount, "10000.00")
    assert.equal(saved.max_payout_amount, "1000000.00")
    assert.equal(saved.funding_mode, "platform")
    assert.deepEqual(saved.product_participants, [])
    await deniedQuery("update public.joy8_game_policies set max_bet_amount=10000.01 where game_id=$1", [game], "joy8_game_policies_max_bet_cap_check")
  })

  test("full-balance tables reserve the entire available wallet without the slot bet cap", async () => {
    await deniedQuery("update public.joy8_game_policies set reservation_mode='full_balance' where game_id=$1", [game], "joy8_game_policies_reservation_config_check")
    await db.query(`update public.joy8_game_policies
      set funding_mode='participants',product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure,
        reservation_mode='full_balance',max_participants=2
      where game_id=$1`, [game])
    const player = await ready()
    await denied(rpc("joy8_open_match_v1", opening(player, "10000.00")), "JOY8_INVALID_AMOUNT")
    await denied(rpc("joy8_open_match_v1", opening(player, "20000.01")), "JOY8_INSUFFICIENT_BALANCE")
    await db.query("update public.joy8_game_policies set max_reserve_amount=1 where game_id=$1", [game])
    await denied(rpc("joy8_open_match_v1", opening(player, "20000.00")), "JOY8_LIMIT_EXCEEDED")
    await db.query("update public.joy8_game_policies set max_reserve_amount=null where game_id=$1", [game])
    const body = opening(player, "20000.00", {
      product_participants: [{ account_ref: "bot-1", reserve: "100.00" }],
    })
    assert.equal((await rpc("joy8_open_match_v1", body)).state, "open")
    const saved = await one("select reservation_mode,max_reserve_amount from public.joy8_matches where game_id=$1 and match_ref=$2", [game, body.match_ref])
    assert.deepEqual(saved, { reservation_mode: "full_balance", max_reserve_amount: null })
    assert.equal((await one("select locked_balance from public.wallet_accounts where id=$1", [player.wallet_account_id])).locked_balance, "20000.00")
    await denied(rpc("joy8_open_match_v1", opening(player, "20000.00")), "JOY8_WALLET_OCCUPIED")
  })

  test("each game sets a minimum bet and a table minimum joining balance", async () => {
    await deniedQuery("update public.joy8_game_policies set min_bet_amount=0 where game_id=$1", [game], "joy8_game_policies_min_bet_amount_check")
    await deniedQuery("update public.joy8_game_policies set min_bet_amount=10000.01 where game_id=$1", [game], "joy8_game_policies_min_bet_range_check")
    await db.query("update public.joy8_game_policies set min_bet_amount=50 where game_id=$1", [game])
    const player = await ready()
    await denied(rpc("joy8_open_match_v1", opening(player, "49.99")), "JOY8_LIMIT_EXCEEDED")
    assert.equal((await rpc("joy8_open_match_v1", opening(player, "50.00"))).state, "open")
    await db.query(`update public.joy8_game_policies
      set funding_mode='participants',product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure,
        reservation_mode='full_balance',max_participants=2,min_bet_amount=30000
      where game_id=$1`, [game])
    const table = await ready()
    await denied(rpc("joy8_open_match_v1", opening(table, "20000.00")), "JOY8_INSUFFICIENT_BALANCE")
    await db.query("update public.joy8_game_policies set min_bet_amount=20000 where game_id=$1", [game])
    assert.equal((await rpc("joy8_open_match_v1", opening(table, "20000.00", {
      product_participants: [{ account_ref: "bot-1", reserve: "100.00" }],
    }))).state, "open")
  })

  test("platform-funded games reject product reserves and game-supplied platform entries", async () => {
    const player = await ready()
    await denied(rpc("joy8_open_match_v1", opening(player, "100.00", {
      product_participants: [{ account_ref: "house", reserve: "100.00" }],
    })), "JOY8_INVALID_REQUEST")
    const body = opening(player, "100.00")
    await rpc("joy8_open_match_v1", body)
    await denied(rpc("joy8_settle_match_v1", settlement(player, body.match_ref, null, 1, true, {
      entries: [{ kind: "platform", account_ref: game, amount: "100.00", source: "gameplay" }],
    })), "JOY8_INVALID_REQUEST")
  })

  test("player-only losses and wins receive an automatic balancing audit entry", async () => {
    const player = await ready()
    const body = opening(player)
    await rpc("joy8_open_match_v1", body)
    const firstRequest = settlement(player, body.match_ref, "-1000.00", 1, false)
    const first = await rpc("joy8_settle_match_v1", firstRequest)
    assert.deepEqual(await rpc("joy8_settle_match_v1", firstRequest), first)
    assert.deepEqual(await one("select balance,locked_balance from public.wallet_accounts where id=$1", [player.wallet_account_id]), {
      balance: "19000.00",
      locked_balance: "9000.00",
    })
    const firstEntries = (await db.query("select kind,account_ref,amount from public.joy8_settlement_entries where settlement_id=$1 order by entry_index", [first.settlement_id])).rows
    assert.deepEqual(firstEntries, [
      { kind: "player", account_ref: player.player, amount: "-1000.00" },
      { kind: "platform", account_ref: game, amount: "1000.00" },
    ])
    const last = await rpc("joy8_settle_match_v1", settlement(player, body.match_ref, "500.00", 2, true))
    const lastEntries = (await db.query("select kind,account_ref,amount from public.joy8_settlement_entries where settlement_id=$1 order by entry_index", [last.settlement_id])).rows
    assert.deepEqual(lastEntries, [
      { kind: "player", account_ref: player.player, amount: "500.00" },
      { kind: "platform", account_ref: game, amount: "-500.00" },
    ])
    assert.deepEqual(await one("select balance,locked_balance from public.wallet_accounts where id=$1", [player.wallet_account_id]), {
      balance: "19500.00",
      locked_balance: "0.00",
    })
    assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n, 2)
  })

  test("payouts stop at the configured guard and never require a game-owned wallet", async () => {
    const player = await ready()
    const tooLarge = opening(player)
    await rpc("joy8_open_match_v1", tooLarge)
    await denied(rpc("joy8_settle_match_v1", settlement(player, tooLarge.match_ref, "990000.01")), "JOY8_LIMIT_EXCEEDED")
    const winner = await ready()
    const body = opening(winner)
    await rpc("joy8_open_match_v1", body)
    await rpc("joy8_settle_match_v1", settlement(winner, body.match_ref, "990000.00"))
    assert.equal((await one("select balance from public.wallet_accounts where id=$1", [winner.wallet_account_id])).balance, "1010000.00")
    assert.equal((await one(`select coalesce(sum(e.amount),0) total
      from public.joy8_settlement_entries e
      join public.joy8_settlements s on s.id=e.settlement_id
      join public.joy8_matches m on m.id=s.match_id
      where m.match_ref=$1`, [body.match_ref])).total, "0.00")
  })

  test("continuous platform settlement caps the whole round and permits an empty final posting", async () => {
    const player = await ready()
    const body = opening(player, "100.00")
    await rpc("joy8_open_match_v1", body)
    assert.equal((await rpc("joy8_settle_match_v1", settlement(player, body.match_ref, "600000.00", 1, false))).state, "open")
    assert.equal((await rpc("joy8_settle_match_v1", settlement(player, body.match_ref, "399900.00", 2, false))).state, "open")
    assert.deepEqual(await one("select balance,locked_balance from public.wallet_accounts where id=$1", [player.wallet_account_id]), {
      balance: "1019900.00",
      locked_balance: "1000000.00",
    })
    await denied(rpc("joy8_settle_match_v1", settlement(player, body.match_ref, "0.01", 3, false)), "JOY8_LIMIT_EXCEEDED")
    await denied(rpc("joy8_settle_match_v1", settlement(player, body.match_ref, "0.01", 3, true)), "JOY8_LIMIT_EXCEEDED")
    assert.equal((await one("select settlement_count from public.joy8_matches where match_ref=$1", [body.match_ref])).settlement_count, 2)
    assert.equal((await rpc("joy8_settle_match_v1", settlement(player, body.match_ref, null, 3, true))).state, "settled")
    assert.deepEqual(await one("select balance,locked_balance from public.wallet_accounts where id=$1", [player.wallet_account_id]), {
      balance: "1019900.00",
      locked_balance: "0.00",
    })
  })

  test("participant-funded matches keep the per-entry payout limit", async () => {
    await db.query(`update public.joy8_game_policies
      set funding_mode='participants',product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure,
        max_payout_amount=100,max_participants=2
      where game_id=$1`, [game])
    const player = await ready()
    const body = opening(player, "100.00", {
      product_participants: [{ account_ref: "bot-1", reserve: "100.00" }],
    })
    await rpc("joy8_open_match_v1", body)
    const result = await rpc("joy8_settle_match_v1", settlement(player, body.match_ref, "100.00", 1, true, {
      entries: [
        { kind: "player", account_ref: player.player, amount: "100.00", source: "gameplay" },
        { kind: "product", account_ref: "bot-1", amount: "-100.00", source: "gameplay" },
      ],
    }))
    assert.equal(result.state, "settled")
    assert.equal((await one("select balance from public.wallet_accounts where id=$1", [player.wallet_account_id])).balance, "20100.00")
  })
})
