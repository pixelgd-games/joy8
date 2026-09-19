import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { readFile } from "node:fs/promises"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const migration = await readFile(new URL("../supabase/drafts/20260920150000_mahjong_runtime_balance.sql", import.meta.url), "utf8")
let player, beforeHash
const fingerprint = async () => (await one(`select md5(jsonb_build_object(
  'wallets',(select jsonb_agg(to_jsonb(w)) from public.wallet_accounts w),
  'transactions',(select jsonb_agg(to_jsonb(t)) from public.wallet_transactions t),
  'bindings',(select jsonb_agg(to_jsonb(b)) from mahjong_clash.integration_players b),
  'games',(select jsonb_agg(to_jsonb(g) order by id) from public.games g),
  'configuration',(select to_jsonb(c) from mahjong_clash.lifecycle_config c)
)::text) hash`)).hash

before(async () => {
  const { sources } = await buildPlatformBundle()
  const cut = sources.findIndex(source => source.path.endsWith("20260919100000_joy8_rebrand.sql"))
  for (const source of sources.slice(0, cut)) await db.exec(source.sql)
  for (const name of ["20260918010200_mahjong_state", "20260918010300_mahjong_economy", "20260918010400_mahjong_accounting", "20260918010500_mahjong_lifecycle", "20260918010600_mahjong_runtime"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"))
  }
  for (const source of sources.slice(cut)) await db.exec(source.sql)
  const game = (await one("select id from public.games where slug='test-game'")).id
  await db.query("insert into mahjong_clash.lifecycle_config values(true,$1,'rules-1')", [game])
  await db.exec("insert into mahjong_clash.economy_state(singleton,environment,version) values(true,'local-test','economy-1')")
  await db.exec("insert into public.joy8_product_schemas values('mahjong_clash')")
  const policy = (await one("insert into public.joy8_wallet_policies(game_id,enabled,initial_credit) values($1,true,30000) returning id", [game])).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount,product_adapter) values($1,$2,true,1000000,'mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure)", [game, policy])
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  player = (await one("select * from public.joy8_resolve_member($1,true)", [auth])).player_account_id
  const session = await one("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])
  const key = "b".repeat(64)
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange'],now()+interval '1 day')", [game, key])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2)", [key, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  await db.query("select mahjong_clash.bind_runtime_identity($1,$2)", [session.session_id, player])
  assert.equal(Number((await one("select mahjong_clash.runtime_balance($1) value", [player])).value), 30000)
  beforeHash = await fingerprint()
})
after(() => db.close())

test("the forward migration upgrades the installed numeric contract without changing player, wallet or configuration data", async () => {
  await db.exec(migration)
  assert.equal(await fingerprint(), beforeHash)
  const wallet = (await one("select mahjong_clash.runtime_balance($1) value", [player])).value
  assert.deepEqual(wallet, { balance: "30000.00", total_balance: "30000.00", locked_balance: "0.00", match_id: null, reserved_balance: "0" })
  assert.equal((await one("select mahjong_clash.runtime_readiness() value")).value.version, 2)
  const permissions = (await db.query("select role,has_function_privilege(role,'mahjong_clash.runtime_balance(uuid)','EXECUTE') allowed from unnest(array['anon','authenticated','service_role','mahjong_clash_server']) role")).rows
  assert.deepEqual(permissions.map(row => row.allowed), [false, false, false, true])
  await db.exec("set role mahjong_clash_server")
  try {
    assert.equal((await one("select mahjong_clash.lock_runtime_economy() version")).version, "economy-1")
    await assert.rejects(db.query("select * from mahjong_clash.economy_state for update"), /permission denied/)
    await assert.rejects(db.query("update mahjong_clash.economy_state set water=999"), /permission denied/)
  } finally { await db.exec("reset role") }
  const lockPermissions = (await db.query("select role,has_function_privilege(role,'mahjong_clash.lock_runtime_economy()','EXECUTE') allowed from unnest(array['anon','authenticated','service_role','mahjong_clash_server']) role")).rows
  assert.deepEqual(lockPermissions.map(row => row.allowed), [false, false, false, true])
  assert.equal((await one("select count(*)::int n from public.joy8_product_ddl_checks")).n, 0)
  const postflight = await db.exec(await readFile(new URL("./sql/mahjong-readiness.sql", import.meta.url), "utf8"))
  const report = postflight.flatMap(result => result.rows || []).find(row => row.mahjong_readiness)?.mahjong_readiness
  assert.equal(report.runtime_contract.length, 3)
  assert.ok(report.runtime_contract.every(fn => fn.security_definer && fn.runtime_execute && !fn.anon_execute && !fn.member_execute && !fn.gateway_execute))
})
