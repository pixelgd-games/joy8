import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberPlatformDatabase } from "./fixtures/member-platform.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
let session, token
const active = async (...args) => (await db.query(`select * from public.joy8_active_session(${args.map((_, i) => `$${i + 1}`).join(",")})`, args)).rows

before(async () => {
  const games = await loadMemberPlatformDatabase(db)
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  await db.query("select * from public.joy8_resolve_member($1,true)", [auth])
  session = await one("select * from public.create_game_session('test-game',$1)", [auth])
  const access = await one("select public.joy8_server_session_v1($1,'exchange',$2::jsonb) result", [games.keys.get(games.game), JSON.stringify({ version: 1, launch_code: session.launch_code })])
  token = access.result.gateway_token
})
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))
after(() => db.close())

test("the internal session helper is security definer with an empty search path", async () => {
  const security = await one("select prosecdef,proconfig from pg_proc where oid='public.joy8_active_session(text,text)'::regprocedure")
  assert.equal(security.prosecdef, true)
  assert.ok(security.proconfig.includes('search_path=""'))
})

test("omitted scope resolves the same session as explicit balance", async () => {
  const result = await active(token)
  assert.equal(result.length, 1)
  assert.equal(result[0].session_id, session.session_id)
  assert.deepEqual(result, await active(token, "balance"))
  await db.exec("set local role service_role")
  const balance = await one("select * from public.wallet_get_balance($1)", [token])
  assert.equal(balance.wallet_account_id, session.wallet_account_id)
  assert.equal(Number(balance.balance), 0)
})

test("null and unsupported scopes never become unrestricted session access", async () => {
  for (const scope of [null, "", "bet", "payout", "renew", "BALANCE"]) assert.deepEqual(await active(token, scope), [])
  await db.query("update public.game_sessions set gateway_token_scopes=array['balance','bet','renew'] where id=$1", [session.session_id])
  assert.equal((await active(token, "balance")).length, 1)
  for (const scope of [null, "bet", "renew"]) assert.deepEqual(await active(token, scope), [])
})

test("the token must actually contain balance scope", async () => {
  await db.query("update public.game_sessions set gateway_token_scopes=array['renew'] where id=$1", [session.session_id])
  assert.deepEqual(await active(token), [])
  assert.deepEqual(await active(token, "balance"), [])
})

test("missing and incorrect credentials return no session", async () => {
  for (const invalid of [null, "", "invalid-fixture-token"]) assert.deepEqual(await active(invalid), [])
})

for (const [name, update] of [
  ["expired token", "update public.game_sessions set gateway_token_expires_at=now()-interval '1 second'"],
  ["expired session", "update public.game_sessions set expires_at=now()-interval '1 second',created_at=now()-interval '1 hour'"],
  ["revoked session", "update public.game_sessions set status='revoked'"],
  ["suspended player", "update public.player_accounts set status='suspended'"],
  ["frozen wallet", "update public.wallet_accounts set status='frozen'"],
  ["closed wallet", "update public.wallet_accounts set status='closed'"],
]) test(`${name} blocks both default and explicit balance access`, async () => {
  await db.exec(update)
  assert.deepEqual(await active(token), [])
  assert.deepEqual(await active(token, "balance"), [])
})

test("browser and service roles cannot invoke the internal helper directly", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal((await one("select has_function_privilege($1,'public.joy8_active_session(text,text)','EXECUTE') allowed", [role])).allowed, false)
    await db.exec("savepoint scope_role")
    await db.exec(`set local role ${role}`)
    await assert.rejects(active(token), error => error.code === "42501")
    await db.exec("rollback to savepoint scope_role; release savepoint scope_role")
  }
})
