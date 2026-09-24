import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const sessionSql = await readFile("supabase/drafts/session-contract-cleanup.sql", "utf8")
const catalogSql = await readFile("supabase/drafts/catalog-metadata-cleanup.sql", "utf8")
let auth, game, player
before(async () => {
  for (const source of (await buildPlatformBundle()).sources) await db.exec(source.sql)
  const catalog = await readFile("supabase/migrations/20260710140000_secure_admin_game_access.sql", "utf8")
  await db.exec(catalog.slice(catalog.indexOf("create or replace function public.looty_public_games_v1()")).replaceAll("looty_", "joy8_"))
  auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  player = (await one("select * from public.joy8_resolve_member($1,true)", [auth])).player_account_id
  game = (await one("select id from public.games where slug='test-game'")).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,max_participants) select $1,id,true,1,1,1 from public.joy8_wallet_policies where currency='POINT'", [game])
})
after(() => db.close())

test("session cleanup refuses active entries and populated display names", async () => {
  await assert.rejects(db.exec(sessionSql), /REQUIRES_PAUSED_ENTRIES/)
  await db.exec("rollback; update public.games set published=false; update public.joy8_private_entries set enabled=false")
  await db.query("update public.player_accounts set display_name='retain-me' where id=$1", [player])
  await assert.rejects(db.exec(sessionSql), /DISPLAY_NAMES_NOT_EMPTY/)
  await db.exec("rollback")
  assert.equal((await one("select display_name from public.player_accounts where id=$1", [player])).display_name, "retain-me")
  await db.query("update public.player_accounts set display_name=null where id=$1", [player])
})

test("the single replacement session signature preserves identity, POINT, expiry and private-entry denial", async () => {
  await db.exec(sessionSql)
  assert.equal((await one("select to_regprocedure('public.create_game_session(text,text,integer,text,uuid)') is null removed")).removed, true)
  assert.equal((await one("select to_regprocedure('public.joy8_issue_game_session(text,text,integer,text,uuid)') is null removed")).removed, true)
  assert.equal((await one("select public.joy8_platform_health_v1() ready")).ready, true)
  await assert.rejects(one("select * from public.create_game_session('test-game',$1)", [auth]), /game is not available/)
  await assert.rejects(one("select public.joy8_create_private_session('monster-lab',$1,'https://joy8.cc')", [auth]), /PRIVATE_ENTRY_DENIED/)
  await db.query("update public.games set published=true where id=$1", [game])
  await db.exec("set role service_role")
  await assert.rejects(one("select * from public.joy8_issue_game_session('test-game',$1)", [auth]), /permission denied/)
  const session = await one("select * from public.create_game_session('test-game',$1)", [auth])
  assert.equal(session.player_account_id, player)
  assert.equal(session.currency, "POINT")
  assert.equal(session.protocol, "server-v1")
  await db.exec("reset role")
  assert.deepEqual(await one("select extract(epoch from expires_at-created_at)::int ttl,extract(epoch from launch_code_expires_at-created_at)::int launch_ttl from public.game_sessions where id=$1", [session.session_id]), { ttl: 3600, launch_ttl: 120 })
  assert.equal((await one("select count(*)::int n from public.player_accounts")).n, 1)
  assert.equal((await one("select coalesce(sum(balance),0)::text balance from public.wallet_accounts")).balance, "0.00")
  await db.exec("update public.joy8_private_entries set enabled=true where game_id=(select id from public.games where slug='monster-lab'); set role service_role")
  const privateSession = (await one("select public.joy8_create_private_session('monster-lab',$1,'https://joy8.cc') result", [auth])).result
  assert.equal(privateSession.player_account_ref, player)
  assert.equal(privateSession.currency, "POINT")
  assert.ok(privateSession.launch_code)
  assert.equal(Object.hasOwn(privateSession, "wallet_account_id"), false)
  await db.exec("reset role; update public.joy8_private_entries set enabled=false")
  await db.exec("set role authenticated")
  await assert.rejects(one("select * from public.create_game_session('test-game',$1)", [auth]), /permission denied/)
  await db.exec("reset role")
})

test("catalog cleanup guards live metadata and retains anonymous published-only browsing", async () => {
  await db.query("update public.games set supports_live=true where id=$1", [game])
  await assert.rejects(db.exec(catalogSql), /LIVE_METADATA_IN_USE/)
  await db.exec("rollback")
  await db.query("update public.games set supports_live=false where id=$1", [game])
  await db.exec(catalogSql)
  await db.exec("set role anon")
  const rows = (await db.query("select * from public.public_games_v1")).rows
  assert.deepEqual(rows.map(row => row.slug), ["test-game"])
  assert.equal(Object.hasOwn(rows[0], "supports_live"), false)
  await db.exec("reset role")
})
