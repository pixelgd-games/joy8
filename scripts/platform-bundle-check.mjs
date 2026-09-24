import assert from "node:assert/strict"
import { after, test } from "node:test"
import { buildPlatformBundle, validatePlatformBundle } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const bundle = await buildPlatformBundle()
const db = await createTestDatabase()
after(() => db.close())

test("platform bundle classifies the entire migration directory and rejects missing or altered SQL", () => {
  validatePlatformBundle(bundle)
  for (const mutate of [
    copy => copy.sources.pop(),
    copy => copy.sources.reverse(),
    copy => copy.sources.push(copy.sources[0]),
    copy => { copy.sources[0].sql += "select 1;" },
  ]) {
    const copy = structuredClone(bundle)
    mutate(copy)
    assert.throws(() => validatePlatformBundle(copy))
  }
  assert.ok(!bundle.sources.some(source => /clear_prelaunch|retired_catalog|identity_activation/.test(source.path)))
})

test("the complete exported fixture installs current member, session, accounting, registry and DDL behavior", async () => {
  for (const source of bundle.sources) await db.exec(source.sql)
  const one = async sql => (await db.query(sql)).rows[0]
  assert.equal((await one("select exists(select 1 from pg_attribute where attrelid='public.player_accounts'::regclass and attname='public_id' and not attisdropped) value")).value, true)
  for (const name of ["joy8_product_schemas", "joy8_product_ddl_checks", "joy8_private_entries", "gateway_rate_limits"]) {
    assert.notEqual((await one(`select to_regclass('public.${name}') value`)).value, null)
  }
  assert.equal((await one("select to_regprocedure('public.joy8_resolve_branded_entry(text,text)') is not null value")).value, true)
  for (const name of ["joy8_product_ddl_guard", "joy8_product_drop_guard"]) {
    assert.equal((await one(`select exists(select 1 from pg_event_trigger where evtname='${name}' and evtenabled='O') value`)).value, true)
  }
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  assert.equal((await db.query("select * from public.joy8_resolve_member($1,false)", [auth])).rows.length, 0)
  const member = (await db.query("select * from public.joy8_resolve_member_profile($1,true)", [auth])).rows[0]
  assert.match(member.public_id, /^\d{6}$/)
  assert.deepEqual(await one("select count(*)::int n,sum(balance)::text balance from public.wallet_accounts"), { n: 1, balance: "100.00" })
  assert.deepEqual(await one("select initial_credit::text member,guest_initial_credit::text guest from public.joy8_wallet_policies"), { member: "1000.00", guest: "100.00" })
  assert.equal((await one("select to_regclass('public.joy8_payout_budgets') value")).value, null)
  assert.equal((await one("select exists(select 1 from pg_attribute where attrelid='public.joy8_game_policies'::regclass and attname='min_bet_amount' and not attisdropped) value")).value, true)
  assert.equal((await one("select count(*)::int n from public.joy8_product_ddl_checks")).n, 0)
  assert.equal((await one("select exists(select 1 from pg_attribute where attrelid='public.games'::regclass and attname='supports_live' and not attisdropped) value")).value, false)
  assert.equal((await one("select exists(select 1 from pg_attribute where attrelid='public.player_accounts'::regclass and attname='display_name' and not attisdropped) value")).value, false)
  assert.equal((await one("select bool_and(not enabled) value from public.joy8_private_entries")).value, true)
  await db.exec("update public.games set published=true where slug='test-game'")
  await db.exec("begin; set local role anon")
  try {
    assert.deepEqual((await db.query("select slug from public.public_games_v1")).rows, [{ slug: "test-game" }])
    await assert.rejects(db.query("select * from public.games"), /permission denied/)
  } finally { await db.exec("rollback") }
})
