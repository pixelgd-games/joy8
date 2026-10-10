import assert from "node:assert/strict"
import { before, after, beforeEach, afterEach, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { createMemberService, memberErrorMessage } from "../src/member/service.js"

const db = await createTestDatabase()
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
let admin, game
before(async () => {
  await loadCurrentPlatform(db)
  admin = (await one("insert into auth.users(email,email_confirmed_at) values('review@example.test',now()) returning id")).id
  await db.query("insert into auth.identities values($1,'google')", [admin])
  await db.exec("insert into public.admin_users(email) values('review@example.test'); insert into public.joy8_email_allowlist(email) values('review@example.test')")
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [admin, JSON.stringify({ app_metadata: { provider: "google" } })])
  game = (await one("select id from public.games where slug='test-game'")).id
  await db.query("update public.games set published=false,thumbnail='/games/test-game/cover.webp' where id=$1", [game])
  await db.query("insert into public.joy8_private_entries(game_id,entry_origin,launch_url,enabled) values($1,'https://joy8.cc','https://game.example/',true)", [game])
})
after(() => db.close())
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))

async function configure() {
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,funding_mode) select $1,id,true,1000,100000,'platform' from public.joy8_wallet_policies", [game])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret(repeat('a',64)),array['exchange','renew','open','settle','status','cancel'])", [game])
}
async function denied(sql, args = [], pattern = /row-level security/) {
  await db.exec("savepoint rejection")
  await assert.rejects(db.query(sql, args), pattern)
  await db.exec("rollback to savepoint rejection")
}
const readiness = (mode = "joy8") => one("select public.joy8_game_readiness($1,'test-game','https://game.example/','/games/test-game/cover.webp',$2) missing", [game, mode])

test("member 429 reaches its actionable localized message", async () => {
  const service = createMemberService({ auth: { getSession: async () => ({ data: { session: { user: {} } } }) },
    functions: { invoke: async () => ({ error: { context: { status: 429 } } }) } }, { origin: "https://joy8.cc" })
  await assert.rejects(service.membership(), error => memberErrorMessage(error) === "操作太頻繁，請稍後再試。")
})

test("RLS denies direct unready publication and reports missing configuration", async () => {
  await db.exec("set local role authenticated")
  assert.deepEqual((await readiness()).missing, ["game_policy", "wallet_policy", "backend_key"])
  await denied("update public.games set published=true where id=$1", [game])
  await denied("insert into public.games(name,slug,type,published,launch_url,thumbnail) values('Unready','unready','slot',true,'https://game.example/','/games/unready/cover.webp')")
})

test("ready publication succeeds; revoked keys, disabled policies and invalid metadata block updates without blocking unpublish", async () => {
  await configure()
  await db.exec("set local role authenticated")
  assert.deepEqual((await readiness()).missing, [])
  await db.query("update public.games set published=true where id=$1", [game])
  await denied("update public.games set launch_url='http://game.example/' where id=$1", [game])
  await denied("update public.games set thumbnail=null where id=$1", [game])
  await db.exec("reset role; update public.joy8_backend_keys set revoked_at=now()")
  await db.exec("set local role authenticated")
  assert.ok((await readiness()).missing.includes("backend_key"))
  await denied("update public.games set name='Changed' where id=$1", [game])
  await db.query("update public.games set published=false where id=$1", [game])
  await db.exec("reset role; update public.joy8_game_policies set enabled=false")
  await db.exec("set local role authenticated")
  assert.ok((await readiness()).missing.includes("game_policy"))
})

test("trial links publish without wallet configuration and never issue a game session", async () => {
  await db.exec("set local role authenticated")
  assert.deepEqual((await readiness("trial")).missing, [])
  assert.deepEqual((await readiness("demo")).missing, ["launch_mode"])
  await db.query("update public.games set launch_mode='trial',published=true where id=$1", [game])
  await denied("update public.games set launch_url='http://game.example/' where id=$1", [game])
  await denied("update public.games set launch_mode='joy8' where id=$1", [game])
  await db.query("insert into public.games(name,slug,type,published,launch_url,thumbnail,launch_mode) values('Trial','trial-game','arcade',true,'https://trial.example/','/games/trial-game/cover.webp','trial')")
  await db.exec("reset role; set local role anon")
  assert.deepEqual((await db.query("select slug,launch_mode from public.public_games_v1 order by slug")).rows, [{ slug: "test-game", launch_mode: "trial" }, { slug: "trial-game", launch_mode: "trial" }])
  await db.exec("reset role")
  await db.query("select * from public.joy8_resolve_member($1,true)", [admin])
  await db.exec("set local role service_role")
  await denied("select * from public.create_game_session('test-game',$1)", [admin], /game is not available/)
  await db.exec("reset role")
  await db.exec("set local role authenticated")
  await denied("update public.games set launch_mode='demo' where id=$1", [game])
  await denied("update public.games set published=false,launch_mode='demo' where id=$1", [game], /games_launch_mode_check/)
})

test("independent entry keeps its explicit origin and enabled gate after publication and shares the same member", async () => {
  await configure()
  const member = await one("select * from public.joy8_resolve_member($1,true)", [admin])
  for (const published of [false, true]) {
    await db.query("update public.games set published=$1 where id=$2", [published, game])
    await db.exec("set local role service_role")
    const meta = await one("select public.joy8_resolve_branded_entry('test-game','https://joy8.cc') result")
    const session = await one("select public.joy8_create_private_session('test-game',$1,'https://joy8.cc') result", [admin])
    assert.equal(meta.result.game_id, game)
    assert.equal(session.result.player_account_ref, member.player_account_id)
    await denied("select public.joy8_resolve_branded_entry('test-game','https://evil.example')", [], /JOY8_PRIVATE_ENTRY_DENIED/)
    await db.exec("reset role")
  }
  await db.exec("update public.joy8_private_entries set enabled=false")
  await denied("select public.joy8_resolve_branded_entry('test-game','https://joy8.cc')", [], /JOY8_PRIVATE_ENTRY_DENIED/)
  await denied("select public.joy8_create_private_session('test-game',$1,'https://joy8.cc')", [admin], /JOY8_PRIVATE_ENTRY_DENIED/)
})

test("direct admin RPC shares a database rate budget and leaves unauthenticated callers denied", async () => {
  await db.exec("set local role authenticated")
  for (let i = 0; i < 30; i++) assert.ok((await one("select public.joy8_admin_mail('list','{}') result")).result.items)
  const response = (await one("select public.joy8_admin_mail('list','{}') result")).result
  assert.deepEqual(response, { error: "JOY8_RATE_LIMITED", retry_after: 60 })
  assert.equal((await one("select current_setting('response.status') status")).status, "429")
  await db.query("select set_config('request.jwt.claim.sub','',true)")
  await denied("select public.joy8_admin_mail('list','{}')", [], /JOY8_MAIL_FORBIDDEN/)
})

test("new functions default to private and runtime helpers have fixed empty search paths", async () => {
  await db.exec("create function public.review_private() returns integer language sql as $$ select 1 $$")
  for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await one("select has_function_privilege($1,'public.review_private()','execute') ok", [role])).ok, false)
  const rows = (await db.query("select proname,proconfig from pg_proc where oid in ('public.joy8_consume_gateway_rate_limit(text,integer,integer)'::regprocedure,'public.joy8_cleanup_gateway_runtime()'::regprocedure)")).rows
  assert.ok(rows.every(row => row.proconfig.includes('search_path=""')))
})
