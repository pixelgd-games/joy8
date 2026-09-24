import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { randomBytes } from "node:crypto"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"
import { memberSql } from "./fixtures/member-database.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const secret = randomBytes(32).toString("hex")
const otherSecret = randomBytes(32).toString("hex")
let game, shared, policy, other, priorDemo, priorPlayer

before(async () => {
  await loadPlatformDatabase(db, async () => {
    await db.exec("begin")
    const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
    const member = await rpc("looty_resolve_member", [auth, true])
    const p = { auth, id: member.player_account_id }
    priorDemo = await launch(p)
    priorPlayer = p
    await db.exec("commit")
  })
  await loadProductAccounting(db)
  game = (await one("select id from public.games where slug='test-game'")).id
  shared = (await one("insert into public.games(name,slug,type,published,launch_url) values('Shared','shared','casual',true,'https://game.example/') returning id")).id
  other = (await one("insert into public.games(name,slug,type,published,launch_url) values('Independent','independent','casual',true,'https://game.example/') returning id")).id
  policy = (await one("update public.joy8_wallet_policies set initial_credit=1000,guest_initial_credit=1000,enabled=true returning id")).id
  for (const id of [game, shared, other]) {
    await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount) values($1,$2,true,1000)", [id, policy])
  }
  for (const [id, token] of [[game, secret], [other, otherSecret]]) {
    await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','renew','open','settle','status','cancel'],now()+interval '1 day')", [id, token])
  }
})
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))
after(() => db.close())

async function rpc(name, args, role = "service_role") {
  assert.match(name, /^[a-z0-9_]+$/)
  assert.ok(["service_role", "anon", "authenticated"].includes(role))
  await db.exec("savepoint rpc_call")
  try {
    await db.exec(`set local role ${role}`)
    const result = await db.query(`select * from public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")})`, args)
    await db.exec("reset role; release savepoint rpc_call")
    return result.rows[0]
  } catch (error) {
    await db.exec("rollback to savepoint rpc_call; release savepoint rpc_call")
    throw error
  }
}
const call = async (name, body, key = secret) => (await rpc(name, [key, JSON.stringify(body)]))[name]
const denied = (operation, message) => assert.rejects(operation, (error) => message ? error.message.includes(message) : Boolean(error.code))
async function player() {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  const member = await rpc("joy8_resolve_member", [auth, true])
  return { auth, id: member.player_account_id }
}
const launch = (p, slug = "test-game") => rpc("create_game_session", [slug, "POINT", 3600, null, p.auth])
const exchange = async (session, key = secret) => (await rpc("joy8_server_session_v1", [key, "exchange", JSON.stringify({ version: 1, launch_code: session.launch_code })])).joy8_server_session_v1
async function ready(p = null) {
  p ??= await player()
  const session = await launch(p)
  return { player: p, session, access: await exchange(session) }
}
async function readyFor(p, slug, key) {
  const session = await launch(p, slug)
  return { player: p, session, access: await exchange(session, key) }
}
const opening = (members, ref = "match-1") => ({ version: 1, match_ref: ref, rule_version: "rules-1", participants: members.map(m => ({ session_id: m.session.session_id, reserve: "100.00" })) })
const entry = (p, amount) => ({ kind: "player", account_ref: p.id, amount, source: "gameplay" })
const settlement = (a, b, ref = "match-1") => ({ version: 1, match_ref: ref, rule_version: "rules-1", operation_key: `settle:${ref}`, entries: [entry(a.player, "-90.00"), entry(b.player, "80.00"), { kind: "fee", account_ref: game, amount: "10.00", source: "fee" }] })
const wallet = p => one("select * from public.wallet_accounts where player_account_id=$1 and wallet_policy_id=$2", [p.id, policy])

test("all games share one durable player wallet", async () => {
  const p = await player()
  const a = await launch(p)
  const b = await launch(p, "shared")
  const c = await launch(p, "independent")
  assert.equal(a.wallet_account_id, b.wallet_account_id)
  assert.equal(a.wallet_account_id, c.wallet_account_id)
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where player_account_id=$1", [p.id])).n, 1)
  assert.equal((await wallet(p)).balance, "1000.00")
  assert.equal((await one("select count(*)::int n from public.wallet_transactions where wallet_account_id=$1", [a.wallet_account_id])).n, 1)
})

test("zero opening credit creates no grant and frozen wallet cannot be replaced", async () => {
  await db.query("update public.joy8_wallet_policies set initial_credit=0,guest_initial_credit=0 where id=$1", [policy])
  const p = await player()
  const s = await launch(p)
  assert.equal((await wallet(p)).balance, "0.00")
  assert.equal((await one("select count(*)::int n from public.wallet_transactions where wallet_account_id=$1", [s.wallet_account_id])).n, 0)
  await db.query("update public.wallet_accounts set status='frozen' where id=$1", [s.wallet_account_id])
  await denied(launch(p), "JOY8_WALLET_INACTIVE")
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where player_account_id=$1", [p.id])).n, 1)
})

test("operational launch is backend-only, one-time and bound to its game", async () => {
  const p = await player(), s = await launch(p)
  await denied(rpc("exchange_game_launch_code", [s.launch_code, 3600]), "does not exist")
  await denied(exchange(s, otherSecret), "JOY8_SESSION_INVALID")
  const access = await exchange(s)
  assert.deepEqual(access.scopes, ["balance"])
  await denied(exchange(s), "JOY8_SESSION_INVALID")
  await denied(rpc("wallet_payout", [access.gateway_token, "bad", 500, "bad", "{}"]), "does not exist")
  await db.query("update public.joy8_backend_keys set revoked_at=now() where game_id=$1", [game])
  await denied(rpc("joy8_server_session_v1", [secret, "renew", JSON.stringify({ version: 1, session_id: s.session_id })]), "JOY8_BACKEND_UNAUTHORIZED")
})

test("renewal rotates the balance token without changing the player or wallet", async () => {
  const a = await ready()
  const next = (await rpc("joy8_server_session_v1", [secret, "renew", JSON.stringify({ version: 1, session_id: a.session.session_id })])).joy8_server_session_v1
  assert.notEqual(next.gateway_token, a.access.gateway_token)
  assert.equal(next.player_account_ref, a.player.id)
  await denied(rpc("wallet_get_balance", [a.access.gateway_token]), "game session is not active")
  assert.equal((await rpc("wallet_get_balance", [next.gateway_token])).balance, "1000.00")
})

test("opening holds funds once and prevents concurrent occupation of shared wallets", async () => {
  const a = await ready(), b = await ready()
  const request = opening([a, b])
  const first = await call("joy8_open_match_v1", request)
  assert.deepEqual(await call("joy8_open_match_v1", request), first)
  assert.equal((await wallet(a.player)).locked_balance, "100.00")
  assert.equal((await rpc("wallet_get_balance", [a.access.gateway_token])).balance, "900.00")
  await denied(call("joy8_open_match_v1", opening([a], "match-2")), "JOY8_WALLET_OCCUPIED")
  await denied(call("joy8_open_match_v1", { ...request, rule_version: "changed" }), "JOY8_IDEMPOTENCY_CONFLICT")
})

test("cross-game reservations share occupancy and settlement keeps the source game", async () => {
  const firstPlayer = await player(), secondPlayer = await player()
  const firstGame = await readyFor(firstPlayer, "test-game", secret)
  const otherGameSamePlayer = await readyFor(firstPlayer, "independent", otherSecret)
  const otherGameSecondPlayer = await readyFor(secondPlayer, "independent", otherSecret)
  assert.equal(firstGame.session.wallet_account_id, otherGameSamePlayer.session.wallet_account_id)
  await call("joy8_open_match_v1", opening([firstGame], "first-game"))
  await denied(call("joy8_open_match_v1", opening([otherGameSamePlayer], "other-game"), otherSecret), "JOY8_WALLET_OCCUPIED")
  await call("joy8_settle_match_v1", {
    version: 1, match_ref: "first-game", rule_version: "rules-1",
    operation_key: "settle:first-game", entries: [],
  })
  await call("joy8_open_match_v1", opening([otherGameSamePlayer, otherGameSecondPlayer], "other-game"), otherSecret)
  const request = {
    version: 1, match_ref: "other-game", rule_version: "rules-1", operation_key: "settle:other-game",
    entries: [entry(firstPlayer, "-25.00"), entry(secondPlayer, "25.00")],
  }
  const result = await call("joy8_settle_match_v1", request, otherSecret)
  assert.deepEqual(await call("joy8_settle_match_v1", request, otherSecret), result)
  const source = await one("select count(*)::int rows,count(distinct game_id)::int games,bool_and(game_id=$2) correct_game from public.wallet_transactions where source_ref=$1", [result.settlement_id, other])
  assert.deepEqual(source, { rows: 2, games: 1, correct_game: true })
})

test("atomic settlement preserves conservation, records fees and retries without duplicating", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  const request = settlement(a, b)
  const first = await call("joy8_settle_match_v1", request)
  assert.deepEqual(await call("joy8_settle_match_v1", request), first)
  assert.equal((await wallet(a.player)).balance, "910.00")
  assert.equal((await wallet(b.player)).balance, "1080.00")
  assert.equal((await wallet(a.player)).locked_balance, "0.00")
  assert.equal((await one("select balance from public.joy8_fee_accounts where game_id=$1", [game])).balance, "10.00")
  const status = (await rpc("joy8_match_status_v1", [secret, JSON.stringify({ version: 1, match_ref: "match-1" }), false])).joy8_match_status_v1
  assert.deepEqual(status.result, first)
  await denied(call("joy8_settle_match_v1", { ...request, product_commit: { changed: true } }), "JOY8_IDEMPOTENCY_CONFLICT")
})

test("unauthorized participants, decimals, imbalanced totals and excess loss roll back", async () => {
  const a = await ready(), b = await ready(), outsider = await player()
  await call("joy8_open_match_v1", opening([a, b]))
  for (const entries of [
    [entry(a.player, "-90.00"), entry(outsider, "90.00")],
    [entry(a.player, "-100.001"), entry(b.player, "100.001")],
    [entry(a.player, "-90.00"), entry(b.player, "91.00")],
    [entry(a.player, "-101.00"), entry(b.player, "101.00")],
  ]) await denied(call("joy8_settle_match_v1", { ...settlement(a, b), entries }))
  assert.equal((await wallet(a.player)).balance, "1000.00")
  assert.equal((await wallet(a.player)).locked_balance, "100.00")
  assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n, 0)
})

test("durable match can settle after session expiry and player suspension", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  await db.query("update public.game_sessions set expires_at=now()-interval '1 second'")
  await db.query("update public.player_accounts set status='suspended' where id=$1", [a.player.id])
  assert.equal((await call("joy8_settle_match_v1", settlement(a, b))).state, "settled")
})

test("frozen wallet blocks settlement without partial writes; cancellation releases only reservations", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  await db.query("update public.wallet_accounts set status='frozen' where player_account_id=$1", [b.player.id])
  await denied(call("joy8_settle_match_v1", settlement(a, b)), "JOY8_WALLET_INACTIVE")
  assert.equal((await wallet(a.player)).balance, "1000.00")
  assert.equal((await wallet(a.player)).locked_balance, "100.00")
  const args = [secret, JSON.stringify({ version: 1, match_ref: "match-1" }), true]
  assert.equal((await rpc("joy8_match_status_v1", args)).joy8_match_status_v1.state, "cancelled")
  assert.equal((await rpc("joy8_match_status_v1", args)).joy8_match_status_v1.state, "cancelled")
  assert.equal((await wallet(a.player)).balance, "1000.00")
  assert.equal((await wallet(a.player)).locked_balance, "0.00")
})

test("browser roles cannot call trusted functions even with a valid test backend key", async () => {
  for (const role of ["anon", "authenticated"]) {
    await denied(rpc("joy8_open_match_v1", [secret, "{}"], role))
    await denied(rpc("joy8_settle_match_v1", [secret, "{}"], role))
    await denied(rpc("joy8_server_session_v1", [secret, "exchange", "{}"], role))
  }
})

test("committed settlement and operational ledger cannot be edited", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  const result = await call("joy8_settle_match_v1", settlement(a, b))
  for (const sql of [
    "update public.joy8_settlements set result='{}'::jsonb",
    "delete from public.joy8_settlement_entries",
    "update public.wallet_transactions set amount=1",
  ]) {
    await db.exec("savepoint immutable")
    await denied(db.exec(sql), "JOY8_ACCOUNTING_IMMUTABLE")
    await db.exec("rollback to savepoint immutable; release savepoint immutable")
  }
  assert.ok(result.settlement_id)
})

test("product balances and commit marker roll back together with players and fees", async () => {
  await db.query("update public.joy8_game_policies set product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [game])
  const a = await ready()
  const opened = await call("joy8_open_match_v1", { ...opening([a]), product_participants: [{ account_ref: "bot-1", reserve: "100.00" }] })
  const request = { version: 1, match_ref: "match-1", rule_version: "rules-1", operation_key: "product-settle", entries: [entry(a.player, "80.00"), { kind: "product", account_ref: "bot-1", amount: "-90.00", source: "gameplay" }, { kind: "fee", account_ref: game, amount: "10.00", source: "fee" }], product_commit: { fail: true } }
  await denied(call("joy8_settle_match_v1", request), "JOY8_ADAPTER_REJECTED")
  assert.equal((await wallet(a.player)).balance, "1000.00")
  assert.equal((await wallet(a.player)).locked_balance, "100.00")
  assert.equal(Number((await one("select balance from fixture_product.accounts")).balance), 1000)
  assert.equal((await one("select state from fixture_product.matches where id=$1", [opened.match_id])).state, "open")
  assert.equal((await one("select count(*)::int n from public.joy8_fee_accounts")).n, 0)
  assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n, 0)
  request.product_commit = {}
  const result = await call("joy8_settle_match_v1", request)
  assert.deepEqual(await call("joy8_settle_match_v1", request), result)
  assert.equal((await wallet(a.player)).balance, "1080.00")
  assert.equal(Number((await one("select balance from fixture_product.accounts")).balance), 910)
  assert.equal(Number((await one("select locked from fixture_product.accounts")).locked), 0)
  assert.equal((await one("select settlement_id from fixture_product.matches")).settlement_id, result.settlement_id)
  const reconciliationSql = (await memberSql("../sql/platform-reconciliation.sql")).replace("begin read only;", "").replace("commit;", "")
  const reconciliation = (await one(reconciliationSql)).reconciliation
  for (const [key, value] of Object.entries(reconciliation)) assert.equal(value, 0, key)
})

test("adapter owner cannot inherit platform authority and runtime cannot execute it", async () => {
  await db.query("update public.joy8_game_policies set product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [game])
  const a = await ready()
  await db.exec("grant select on public.wallet_accounts to fixture_product_owner")
  await denied(call("joy8_open_match_v1", opening([a])), "JOY8_ADAPTER_UNAVAILABLE")
  await db.exec("revoke select on public.wallet_accounts from fixture_product_owner")
  assert.equal((await one("select has_function_privilege('fixture_product_runtime','fixture_product.accounting(text,uuid,jsonb)','EXECUTE') allowed")).allowed, false)
  assert.equal((await one("select has_table_privilege('fixture_product_runtime','public.wallet_accounts','UPDATE') allowed")).allowed, false)
})

test("adapter owner cannot access another registered product schema", async () => {
  await db.exec(`
    create role fixture_other_owner nologin;
    create schema fixture_other authorization fixture_other_owner;
    set role fixture_other_owner;
    create table fixture_other.accounts(ref text primary key);
    create function fixture_other.accounting(action text, match_id uuid, payload jsonb)
    returns jsonb language sql security definer set search_path='' as $$
      select jsonb_build_object('committed',true)
    $$;
    revoke all on function fixture_other.accounting(text,uuid,jsonb) from public;
    reset role;
    insert into public.joy8_product_schemas values('fixture_other');
  `)
  await db.query("update public.joy8_game_policies set product_adapter='fixture_product.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [game])
  await db.query("update public.joy8_game_policies set product_adapter='fixture_other.accounting(text,uuid,jsonb)'::regprocedure where game_id=$1", [other])
  await db.exec("grant select on fixture_other.accounts to fixture_product_owner")
  const a = await ready()
  const request = { ...opening([a]), product_participants: [{ account_ref: "bot-1", reserve: "100.00" }] }
  await denied(call("joy8_open_match_v1", request), "JOY8_ADAPTER_UNAVAILABLE")
  assert.equal((await one("select count(*)::int n from public.joy8_matches")).n, 0)
  await db.exec("revoke select on fixture_other.accounts from fixture_product_owner")
  await db.exec("grant execute on function fixture_other.accounting(text,uuid,jsonb) to fixture_product_owner")
  await denied(call("joy8_open_match_v1", request), "JOY8_ADAPTER_UNAVAILABLE")
  await db.exec("revoke execute on function fixture_other.accounting(text,uuid,jsonb) from fixture_product_owner")
  await db.exec("grant create on schema fixture_other to fixture_product_owner")
  await denied(call("joy8_open_match_v1", request), "JOY8_ADAPTER_UNAVAILABLE")
  await db.exec("revoke create on schema fixture_other from fixture_product_owner")
  assert.equal((await call("joy8_open_match_v1", request)).state, "open")
})

test("draw releases holds without manufacturing ledger entries", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  assert.equal((await call("joy8_settle_match_v1", { ...settlement(a, b), entries: [] })).state, "settled")
  assert.equal((await wallet(a.player)).balance, "1000.00")
  assert.equal((await wallet(a.player)).locked_balance, "0.00")
  assert.equal((await one("select count(*)::int n from public.joy8_settlement_entries")).n, 0)
})

test("noncanonical player IDs cannot bypass matching between validation and accounting", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  const request = settlement(a, b)
  request.entries[0].account_ref = `{${a.player.id}}`
  await denied(call("joy8_settle_match_v1", request), "JOY8_INVALID_ENTRY")
  assert.equal((await wallet(a.player)).balance, "1000.00")
})

test("health reads dependencies without creating business records", async () => {
  assert.equal((await rpc("joy8_platform_health_v1", [])).joy8_platform_health_v1, true)
  assert.equal((await one("select count(*)::int n from public.joy8_matches")).n, 0)
})

test("reset removes test financial data while preserving identities and catalog", async () => {
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where id=$1", [priorDemo.wallet_account_id])).n, 0)
  assert.equal((await one("select count(*)::int n from public.wallet_transactions where source_type<>'initial_grant'")).n, 0)
  assert.equal((await one("select count(*)::int n from public.game_sessions")).n, 0)
  assert.equal((await one("select auth_user_id from public.player_accounts where id=$1", [priorPlayer.id])).auth_user_id, priorPlayer.auth)
  assert.equal((await one("select to_regclass('public.game_rounds') old_rounds")).old_rounds, null)
  const fresh = await launch(priorPlayer)
  assert.notEqual(fresh.wallet_account_id, priorDemo.wallet_account_id)
  assert.equal(fresh.player_account_id, priorPlayer.id)
})

test("missing or disabled game policy never falls back to a test wallet", async () => {
  const p = await player()
  await db.query("insert into public.games(name,slug,type,published,launch_url) values('Unconfigured','unconfigured','casual',true,'https://game.example/')")
  await denied(launch(p, "unconfigured"), "JOY8_GAME_NOT_READY")
  await db.query("update public.joy8_game_policies set enabled=false where game_id=$1", [game])
  await denied(launch(p), "JOY8_GAME_NOT_READY")
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where player_account_id=$1", [p.id])).n, 1)
  assert.equal((await one("select count(*)::int n from public.game_sessions where player_account_id=$1", [p.id])).n, 0)
})

test("keys cannot cross games, exceed scopes or outlive expiry", async () => {
  const a = await ready(), b = await ready()
  await call("joy8_open_match_v1", opening([a, b]))
  await denied(call("joy8_settle_match_v1", settlement(a, b), otherSecret), "JOY8_MATCH_NOT_FOUND")
  await db.query("update public.joy8_backend_keys set scopes=array['status'] where game_id=$1", [game])
  await denied(call("joy8_settle_match_v1", settlement(a, b)), "JOY8_BACKEND_UNAUTHORIZED")
  await db.query("update public.joy8_backend_keys set expires_at=now()-interval '1 second' where game_id=$1", [game])
  await denied(rpc("joy8_match_status_v1", [secret, JSON.stringify({ version: 1, match_ref: "match-1" }), false]), "JOY8_BACKEND_UNAUTHORIZED")
})

test("new accounting tables and internal helpers have no public or service bypass", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const grants = await one("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'joy8_%' and has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')", [role])
    assert.equal(grants.n, 0, role)
    await denied(rpc("joy8_backend_game", [secret, "settle"], role))
  }
})
