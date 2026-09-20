import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, describe, test } from "node:test"
import { randomBytes, randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"
import { memberSql } from "./fixtures/member-database.mjs"
import { applyJoy8Rebrand } from "./fixtures/joy8-rebrand.mjs"
import { loadPlatformHardening } from "./fixtures/platform-hardening.mjs"

const native = process.env.JOY8_TEST_ENGINE === "postgres17"
const db = await createTestDatabase()
const secret = randomBytes(32).toString("hex")
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const settleSql = "select public.joy8_settle_match_v1($1,$2::jsonb) result"
const openSql = "select public.joy8_open_match_v1($1,$2::jsonb) result"
let game, policy

before(async () => {
  await loadPlatformDatabase(db, async () => {}, false)
  await db.exec(await memberSql("../../supabase/migrations/20260918010000_wallet_ledger_cleanup.sql"))
  await db.exec(await memberSql("../../supabase/migrations/20260918010100_continuous_settlement.sql"))
  await applyJoy8Rebrand(db)
  await db.exec(await memberSql("../../supabase/migrations/20260919130000_read_only_member_lookup.sql"))
  await db.exec(await memberSql("../../supabase/migrations/20260919131000_cross_product_adapter_isolation.sql"))
  for (const name of ["20260920100000_public_player_ids.sql", "20260920110000_public_id_allocation.sql", "20260920111000_product_schema_registration.sql"]) {
    await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  }
  await loadPlatformHardening(db)
  await db.exec(await memberSql("../../supabase/migrations/20260920170000_shared_point_wallet.sql"))
  await loadProductAccounting(db)
  await db.exec(`
    set role fixture_product_owner;
    create table fixture_product.commits(match_id uuid, number integer, primary key(match_id,number));
    create or replace function fixture_product.accounting(action text, match_id uuid, payload jsonb)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare item jsonb; amount numeric; reservations jsonb; next_reservations jsonb;
    begin
      perform ref from fixture_product.accounts order by ref for update;
      if action='open' then
        reservations:=coalesce(payload->'request'->'product_participants','[]'::jsonb);
        for item in select value from jsonb_array_elements(reservations) loop
          amount:=(item->>'reserve')::numeric;
          update fixture_product.accounts set locked=locked+amount
            where ref=item->>'account_ref' and locked=0 and balance>=amount;
          if not found then raise exception 'JOY8_ADAPTER_REJECTED'; end if;
        end loop;
        insert into fixture_product.matches values(match_id,'open',reservations,null);
      else
        select reserves into strict reservations from fixture_product.matches where id=match_id and state='open' for update;
        for item in select value from jsonb_array_elements(reservations) loop
          update fixture_product.accounts set locked=locked-(item->>'reserve')::numeric where ref=item->>'account_ref';
        end loop;
        if action='settle' then
          for item in select value from jsonb_array_elements(payload->'request'->'entries') where value->>'kind'='product' loop
            update fixture_product.accounts set balance=balance+(item->>'amount')::numeric where ref=item->>'account_ref';
          end loop;
          next_reservations:=payload->'next_product_participants';
          for item in select value from jsonb_array_elements(next_reservations) loop
            update fixture_product.accounts set locked=locked+(item->>'reserve')::numeric where ref=item->>'account_ref';
          end loop;
          insert into fixture_product.commits values(match_id,(payload->'request'->>'settlement_no')::integer);
          update fixture_product.matches set reserves=next_reservations,
            state=case when (payload->'request'->>'final')::boolean then 'settled' else 'open' end,
            settlement_id=(payload->>'settlement_id')::uuid where id=match_id;
        else
          update fixture_product.matches set state='cancelled' where id=match_id;
        end if;
      end if;
      if payload->'request'->'product_commit'->>'fail'='true' then raise exception 'JOY8_ADAPTER_REJECTED'; end if;
      return jsonb_build_object('committed',true);
    end;
    $$;
    reset role;
  `)
  game = (await one("select id from public.games where slug='test-game'")).id
  policy = (await one("update public.joy8_wallet_policies set initial_credit=1000,enabled=true returning id")).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount) values($1,$2,true,5000)", [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','renew','open','settle','status','cancel'],now()+interval '1 day')", [game, secret])
})
after(() => db.close())

async function rpc(name, args, role = "service_role") {
  assert.match(name, /^[a-z0-9_]+$/)
  assert.ok(["service_role", "anon", "authenticated"].includes(role))
  await db.exec("savepoint rpc_call")
  try {
    await db.exec(`set local role ${role}`)
    const result = await one(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)
    await db.exec("reset role; release savepoint rpc_call")
    return result.result
  } catch (error) {
    await db.exec("rollback to savepoint rpc_call; release savepoint rpc_call")
    throw error
  }
}
const call = (name, body, key = secret) => rpc(name, [key, JSON.stringify(body)])
const denied = (promise, code) => assert.rejects(promise, error => error.message.includes(code))
async function ready() {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  const p = await one("select * from public.joy8_resolve_member($1,true)", [auth])
  const s = await one("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [secret, JSON.stringify({ version: 1, launch_code: s.launch_code })])
  return { ...s, player: p.player_account_id }
}
const opening = (players, ref = randomUUID()) => ({ version: 1, match_ref: ref, rule_version: "rules-1", participants: players.map(p => ({ session_id: p.session_id, reserve: "1000.00" })) })
const entry = (p, amount) => ({ kind: "player", account_ref: p.player, amount, source: "gameplay" })
const settlement = (players, ref, number = 1, final = false) => ({ version: 1, match_ref: ref, rule_version: "rules-1", operation_key: `${ref}:hand:${number}`, settlement_no: number, final, entries: [entry(players[0], "-100.00"), entry(players[1], "90.00"), { kind: "fee", account_ref: game, amount: "10.00", source: "fee" }] })
const wallet = p => one("select balance,locked_balance from public.wallet_accounts where id=$1", [p.wallet_account_id])
const state = ref => rpc("joy8_match_status_v1", [secret, JSON.stringify({ version: 1, match_ref: ref }), false])
const cancel = ref => rpc("joy8_match_status_v1", [secret, JSON.stringify({ version: 1, match_ref: ref }), true])
async function table() {
  const players = [await ready(), await ready()]
  const body = opening(players)
  const opened = await call("joy8_open_match_v1", body)
  return { players, body, id: opened.match_id }
}
const reconcile = async (openMatches = 0) => {
  const query = (await memberSql("../sql/platform-reconciliation.sql")).replace("begin read only;", "").replace("commit;", "")
  const result = (await one(query)).reconciliation
  for (const [key, value] of Object.entries(result)) assert.equal(value, key === "open_matches" ? openMatches : 0, key)
}

describe("local continuous settlement SQL", () => {
  beforeEach(() => db.exec("begin"))
  afterEach(() => db.exec("rollback"))

  test("each hand posts immediately while the table remains occupied; final hand releases", async () => {
    const { players, body } = await table()
    const first = await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    assert.equal(first.state, "open")
    assert.equal(first.settlement_no, 1)
    assert.equal(first.final, false)
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "900.00" })
    assert.deepEqual(await wallet(players[1]), { balance: "1090.00", locked_balance: "1090.00" })
    await denied(call("joy8_open_match_v1", opening([players[0]])), "JOY8_WALLET_OCCUPIED")
    await reconcile(1)
    const last = await call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true))
    assert.equal(last.state, "settled")
    assert.deepEqual(await wallet(players[0]), { balance: "800.00", locked_balance: "0.00" })
    assert.deepEqual(await wallet(players[1]), { balance: "1180.00", locked_balance: "0.00" })
    assert.equal((await one("select balance from public.joy8_fee_accounts where game_id=$1", [game])).balance, "20.00")
    assert.equal((await state(body.match_ref)).settlement_count, 2)
    assert.equal((await call("joy8_open_match_v1", opening([players[1]]))).state, "open")
    await reconcile(1)
  })

  test("historical retry returns its saved response without rolling back the latest state", async () => {
    const { players, body } = await table()
    const request = settlement(players, body.match_ref)
    const first = await call("joy8_settle_match_v1", request)
    const last = await call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true))
    assert.deepEqual(await call("joy8_settle_match_v1", request), first)
    const current = await state(body.match_ref)
    assert.equal(current.state, "settled")
    assert.deepEqual(current.result, last)
    assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n, 2)
    await denied(call("joy8_settle_match_v1", { ...request, final: true }), "JOY8_IDEMPOTENCY_CONFLICT")
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 3, true)), "JOY8_MATCH_FINALIZED")
  })

  test("duplicates under a new key, skipped hands and out-of-order hands cannot post", async () => {
    const { players, body } = await table()
    const request = settlement(players, body.match_ref)
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 2)), "JOY8_SETTLEMENT_SEQUENCE")
    await call("joy8_settle_match_v1", request)
    await denied(call("joy8_settle_match_v1", { ...request, operation_key: "duplicate-new-key" }), "JOY8_SETTLEMENT_SEQUENCE")
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 3)), "JOY8_SETTLEMENT_SEQUENCE")
    assert.equal((await wallet(players[0])).balance, "900.00")
  })

  test("sequence and final are mandatory and strictly typed with no old-shape fallback", async () => {
    const { players, body } = await table()
    const request = settlement(players, body.match_ref)
    for (const value of [undefined, null, 0, -1, 1.5, "1", true, 1000000000]) {
      await denied(call("joy8_settle_match_v1", { ...request, settlement_no: value }), "JOY8_INVALID_REQUEST")
    }
    for (const value of [undefined, null, 0, "false"]) {
      await denied(call("joy8_settle_match_v1", { ...request, final: value }), "JOY8_INVALID_REQUEST")
    }
    await denied(call("joy8_settle_match_v1", { ...request, extra: true }), "JOY8_INVALID_REQUEST")
    assert.equal((await state(body.match_ref)).settlement_count, 0)
  })

  test("expired sessions and suspended players do not interrupt existing obligations", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    await db.exec("update public.game_sessions set expires_at=now()-interval '1 second'; update public.player_accounts set status='suspended'")
    await denied(call("joy8_open_match_v1", opening(players)), "JOY8_PLAYER_INACTIVE")
    assert.equal((await call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true))).state, "settled")
    assert.equal((await wallet(players[0])).balance, "800.00")
  })

  test("revoked backend key cannot continue a table; replacement game key can finish it", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    await db.query("update public.joy8_backend_keys set revoked_at=now() where game_id=$1", [game])
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true)), "JOY8_BACKEND_UNAUTHORIZED")
    const replacement = randomBytes(32).toString("hex")
    await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['settle'],now()+interval '1 day')", [game, replacement])
    assert.equal((await call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true), replacement)).state, "settled")
  })

  test("a zero remaining reserve still occupies the seat and rejects further loss", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", { ...settlement(players, body.match_ref), entries: [entry(players[0], "-1000.00"), entry(players[1], "1000.00")] })
    assert.deepEqual(await wallet(players[0]), { balance: "0.00", locked_balance: "0.00" })
    await denied(call("joy8_open_match_v1", opening([players[0]])), "JOY8_WALLET_OCCUPIED")
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 2)), "JOY8_INVALID_ENTRY")
    await call("joy8_settle_match_v1", { ...settlement(players, body.match_ref, 2, true), entries: [] })
    assert.equal((await one("select count(*)::int n from public.joy8_match_participants where released_at is null")).n, 0)
  })

  test("loss is capped by current reserve, including winnings from earlier hands", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    await denied(call("joy8_settle_match_v1", { ...settlement(players, body.match_ref, 2), entries: [entry(players[0], "-901.00"), entry(players[1], "901.00")] }), "JOY8_INVALID_ENTRY")
    await call("joy8_settle_match_v1", { ...settlement(players, body.match_ref, 2, true), entries: [entry(players[0], "1090.00"), entry(players[1], "-1090.00")] })
    assert.equal((await wallet(players[0])).balance, "1990.00")
    assert.equal((await wallet(players[1])).balance, "0.00")
  })

  test("partial reservation preserves outside available funds while rolling winnings forward", async () => {
    const players = [await ready(), await ready()]
    const body = opening(players)
    for (const p of body.participants) p.reserve = "100.00"
    await call("joy8_open_match_v1", body)
    await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "0.00" })
    assert.deepEqual(await wallet(players[1]), { balance: "1090.00", locked_balance: "190.00" })
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 2)), "JOY8_INVALID_ENTRY")
  })

  test("voiding the unfinished remainder preserves all prior hand payments", async () => {
    const { players, body } = await table()
    const first = await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    const ended = await cancel(body.match_ref)
    assert.equal(ended.state, "cancelled")
    assert.equal(ended.settlement_count, 1)
    assert.deepEqual(ended.result, first)
    assert.deepEqual(await cancel(body.match_ref), ended)
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "0.00" })
    assert.equal((await one("select balance from public.joy8_fee_accounts")).balance, "10.00")
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true)), "JOY8_MATCH_FINALIZED")
    await reconcile()
  })

  test("draw can retain occupancy and a final empty settlement can close a table", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", { ...settlement(players, body.match_ref), entries: [] })
    assert.deepEqual(await wallet(players[0]), { balance: "1000.00", locked_balance: "1000.00" })
    await call("joy8_settle_match_v1", { ...settlement(players, body.match_ref, 2, true), entries: [] })
    assert.equal((await one("select count(*)::int n from public.joy8_settlement_entries")).n, 0)
    assert.equal((await wallet(players[0])).locked_balance, "0.00")
  })

  test("single-hand game settles and releases using the same explicit contract", async () => {
    const { players, body } = await table()
    const first = await call("joy8_settle_match_v1", settlement(players, body.match_ref, 1, true))
    assert.equal(first.state, "settled")
    assert.equal((await wallet(players[0])).locked_balance, "0.00")
    await denied(cancel(body.match_ref), "JOY8_MATCH_FINALIZED")
  })

  test("frozen wallet rolls back the next hand but never undoes the previous hand", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    await db.query("update public.wallet_accounts set status='frozen' where id=$1", [players[1].wallet_account_id])
    await denied(call("joy8_settle_match_v1", settlement(players, body.match_ref, 2)), "JOY8_WALLET_INACTIVE")
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "900.00" })
    assert.equal((await state(body.match_ref)).settlement_count, 1)
    await db.query("update public.wallet_accounts set status='active' where id=$1", [players[1].wallet_account_id])
    await call("joy8_settle_match_v1", settlement(players, body.match_ref, 2, true))
    await reconcile()
  })

  test("browser roles and foreign backend cannot settle; entries and rules remain validated", async () => {
    const { players, body } = await table()
    const request = settlement(players, body.match_ref)
    for (const role of ["anon", "authenticated"]) await denied(rpc("joy8_settle_match_v1", [secret, JSON.stringify(request)], role), "permission denied")
    await denied(call("joy8_settle_match_v1", request, "0".repeat(64)), "JOY8_BACKEND_UNAUTHORIZED")
    await denied(call("joy8_settle_match_v1", { ...request, rule_version: "wrong" }), "JOY8_RULE_MISMATCH")
    for (const amount of [100, "100.001", "1e2"]) await denied(call("joy8_settle_match_v1", { ...request, entries: [{ ...request.entries[0], amount }] }), "JOY8_INVALID_AMOUNT")
    await denied(call("joy8_settle_match_v1", { ...request, entries: [entry(players[0], "1.00")] }), "JOY8_UNBALANCED_SETTLEMENT")
    await denied(call("joy8_settle_match_v1", { ...request, entries: [{ ...request.entries[0], account_ref: randomUUID() }, ...request.entries.slice(1)] }), "JOY8_INVALID_ENTRY")
  })

  test("AI, fee, human balances and durable product markers advance or roll back together", async () => {
    await db.query("update public.joy8_game_policies set product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [game])
    const human = await ready()
    const body = { ...opening([human]), product_participants: [{ account_ref: "bot-1", reserve: "1000.00" }] }
    const opened = await call("joy8_open_match_v1", body)
    const request = { ...settlement([human, human], body.match_ref), entries: [entry(human, "90.00"), { kind: "product", account_ref: "bot-1", amount: "-100.00", source: "gameplay" }, { kind: "fee", account_ref: game, amount: "10.00", source: "fee" }], product_commit: {} }
    const first = await call("joy8_settle_match_v1", request)
    assert.deepEqual(await call("joy8_settle_match_v1", request), first)
    assert.equal(Number((await one("select locked from fixture_product.accounts")).locked), 900)
    assert.equal((await one("select state from fixture_product.matches where id=$1", [opened.match_id])).state, "open")
    const next = { ...request, operation_key: "second", settlement_no: 2, final: true }
    await denied(call("joy8_settle_match_v1", { ...next, product_commit: { fail: true } }), "JOY8_ADAPTER_REJECTED")
    assert.deepEqual(await wallet(human), { balance: "1090.00", locked_balance: "1090.00" })
    assert.equal(Number((await one("select balance from fixture_product.accounts")).balance), 900)
    assert.equal((await one("select count(*)::int n from fixture_product.commits")).n, 1)
    assert.equal((await state(body.match_ref)).settlement_count, 1)
    await call("joy8_settle_match_v1", next)
    assert.equal(Number((await one("select balance from fixture_product.accounts")).balance), 800)
    assert.equal(Number((await one("select locked from fixture_product.accounts")).locked), 0)
    assert.equal((await one("select count(*)::int n from fixture_product.commits")).n, 2)
    await reconcile()
  })

  test("cancellation releases updated AI holds without refunding completed transfers", async () => {
    await db.query("update public.joy8_game_policies set product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [game])
    const human = await ready(), body = opening([human])
    body.product_participants = [{ account_ref: "bot-1", reserve: "1000.00" }]
    await call("joy8_open_match_v1", body)
    await call("joy8_settle_match_v1", { ...settlement([human, human], body.match_ref), entries: [entry(human, "-100.00"), { kind: "product", account_ref: "bot-1", amount: "100.00", source: "gameplay" }] })
    assert.equal(Number((await one("select locked from fixture_product.accounts")).locked), 1100)
    await cancel(body.match_ref)
    const ai = await one("select balance,locked from fixture_product.accounts")
    assert.equal(Number(ai.balance), 1100)
    assert.equal(Number(ai.locked), 0)
    assert.equal((await wallet(human)).balance, "900.00")
  })

  test("all committed hand records and ledger entries stay immutable", async () => {
    const { players, body } = await table()
    await call("joy8_settle_match_v1", settlement(players, body.match_ref))
    for (const sql of ["update public.joy8_settlements set settlement_no=9", "delete from public.joy8_settlement_entries", "update public.wallet_transactions set amount=1"]) {
      await db.exec("savepoint immutable")
      await denied(db.exec(sql), "JOY8_ACCOUNTING_IMMUTABLE")
      await db.exec("rollback to savepoint immutable; release savepoint immutable")
    }
    await reconcile(1)
  })

  test("draft refuses to change the contract underneath an open table", async () => {
    const { players, body } = await table()
    const sql = (await memberSql("../../supabase/migrations/20260918010100_continuous_settlement.sql"))
      .replaceAll("LOOTY", "JOY8")
      .replaceAll("Looty", "Joy8")
      .replaceAll("looty", "joy8")
      .replace("begin;", "")
      .replace(/\ncommit;\s*$/, "")
    await db.exec("savepoint migration_guard")
    await denied(db.exec(sql), "JOY8_OPEN_MATCHES")
    await db.exec("rollback to savepoint migration_guard; release savepoint migration_guard")
    assert.equal((await state(body.match_ref)).state, "open")
    assert.deepEqual(await wallet(players[0]), { balance: "1000.00", locked_balance: "1000.00" })
  })
})

async function race(hold, holdValues, works, release = "commit") {
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

describe("PostgreSQL 17 competing connections", { skip: !native }, () => {
  async function setup() {
    const players = [await ready(), await ready()], body = opening(players)
    await db.query(openSql, [secret, JSON.stringify(body)])
    return { players, body }
  }
  test("simultaneous retries of the same intermediate hand credit exactly once", async () => {
    const { players, body } = await setup(), request = settlement(players, body.match_ref)
    const works = Array.from({ length: 4 }, () => [settleSql, [secret, JSON.stringify(request)]])
    const results = await race("select pg_advisory_xact_lock(hashtextextended($1,1))", [`${game}:${body.match_ref}`], works)
    for (const r of results) assert.equal(r.error, undefined, r.error?.message)
    assert.equal(new Set(results.map(r => r.rows[0].result.settlement_id)).size, 1)
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "900.00" })
  })
  test("a competing new table cannot steal a wallet between hands", async () => {
    const { players, body } = await setup(), request = settlement(players, body.match_ref)
    const results = await race(settleSql, [secret, JSON.stringify(request)], [[openSql, [secret, JSON.stringify(opening([players[0]]))]]])
    assert.match(results[0].error.message, /JOY8_WALLET_OCCUPIED/)
    assert.equal((await wallet(players[0])).balance, "900.00")
  })
  test("different operation keys for the same hand cannot double debit", async () => {
    const { players, body } = await setup(), request = settlement(players, body.match_ref)
    const results = await race(settleSql, [secret, JSON.stringify(request)], [[settleSql, [secret, JSON.stringify({ ...request, operation_key: "changed-key" })]]])
    assert.match(results[0].error.message, /JOY8_SETTLEMENT_SEQUENCE/)
    assert.equal((await wallet(players[0])).balance, "900.00")
  })
  test("rollback lets a waiting identical request commit the intermediate hand once", async () => {
    const { players, body } = await setup(), values = [secret, JSON.stringify(settlement(players, body.match_ref))]
    const results = await race(settleSql, values, [[settleSql, values]], "rollback")
    assert.equal(results[0].error, undefined)
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "900.00" })
  })
  test("cancellation waits for the hand and releases only the updated reservation", async () => {
    const { players, body } = await setup()
    const results = await race(settleSql, [secret, JSON.stringify(settlement(players, body.match_ref))], [["select public.joy8_match_status_v1($1,$2::jsonb,true) result", [secret, JSON.stringify({ version: 1, match_ref: body.match_ref })]]])
    assert.equal(results[0].error, undefined)
    assert.equal(results[0].rows[0].result.state, "cancelled")
    assert.equal(results[0].rows[0].result.settlement_count, 1)
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "0.00" })
  })
  test("the next hand waits for the prior hand and uses its updated funds", async () => {
    const { players, body } = await setup()
    const next = settlement(players, body.match_ref, 2, true)
    next.entries = [entry(players[0], "1090.00"), entry(players[1], "-1090.00")]
    const results = await race(settleSql, [secret, JSON.stringify(settlement(players, body.match_ref))], [[settleSql, [secret, JSON.stringify(next)]]])
    assert.equal(results[0].error, undefined, results[0].error?.message)
    assert.equal(results[0].rows[0].result.settlement_no, 2)
    assert.deepEqual(await wallet(players[0]), { balance: "1990.00", locked_balance: "0.00" })
  })
  test("cancellation committed first rejects a waiting hand without posting it", async () => {
    const { players, body } = await setup()
    await db.query(settleSql, [secret, JSON.stringify(settlement(players, body.match_ref))])
    const results = await race("select public.joy8_match_status_v1($1,$2::jsonb,true)", [secret, JSON.stringify({ version: 1, match_ref: body.match_ref })], [[settleSql, [secret, JSON.stringify(settlement(players, body.match_ref, 2, true))]]])
    assert.match(results[0].error.message, /JOY8_MATCH_FINALIZED/)
    assert.deepEqual(await wallet(players[0]), { balance: "900.00", locked_balance: "0.00" })
  })
})
