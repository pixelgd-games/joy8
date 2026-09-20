import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { performance } from "node:perf_hooks"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"
import { applyJoy8Rebrand } from "./fixtures/joy8-rebrand.mjs"
import { memberSql } from "./fixtures/member-database.mjs"
import { hardeningSql } from "./fixtures/platform-hardening.mjs"

const db = await createLocalPostgres()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const secret = randomBytes(32).toString("hex")
const samples = 100
const results = []
const summarize = values => {
  const sorted = values.toSorted((a, b) => a - b)
  return Object.fromEntries([["median_ms", 0.5], ["p95_ms", 0.95]].map(([name, percentile]) =>
    [name, Number(sorted[Math.ceil(sorted.length * percentile) - 1].toFixed(3))]))
}

try {
  await loadPlatformDatabase(db, async () => {}, false)
  for (const name of ["20260918010000_wallet_ledger_cleanup.sql", "20260918010100_continuous_settlement.sql"]) {
    await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  }
  await applyJoy8Rebrand(db)
  for (const name of ["20260919130000_read_only_member_lookup.sql", "20260919131000_cross_product_adapter_isolation.sql", "20260920100000_public_player_ids.sql", "20260920110000_public_id_allocation.sql", "20260920111000_product_schema_registration.sql"]) {
    await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  }
  await db.exec(await memberSql("../../supabase/migrations/20260920170000_shared_point_wallet.sql"))
  await loadProductAccounting(db)
  await db.exec("update fixture_product.accounts set balance=100000")
  const game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("update public.joy8_wallet_policies set initial_credit=1000,enabled=true returning id")).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount,product_adapter) values($1,$2,true,5000,'fixture_product.accounting(text,uuid,jsonb)'::regprocedure)", [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','open','settle'],now()+interval '1 day')", [game, secret])
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  const member = await one("select * from public.joy8_resolve_member($1,true)", [auth])
  const session = await one("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [secret, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  const baselineValidation = (await one("select pg_get_functiondef('public.joy8_validate_product_adapter(regprocedure)'::regprocedure) body")).body
  const currentValidation = await hardeningSql("validation")
  let installed = 1
  for (const products of [1, 5, 10]) {
    while (installed < products) {
      const schema = `benchmark_product_${installed++}`
      await db.exec(`begin; create role ${schema}_owner nologin;
        create schema ${schema} authorization ${schema}_owner; set local role ${schema}_owner;
        ${Array.from({ length: 22 }, (_, i) => `create table ${schema}.table_${i}(id bigint generated always as identity primary key);`).join("\n")}
        ${Array.from({ length: 32 }, (_, i) => `create function ${schema}.function_${i}() returns int language sql as $$ select 1 $$; revoke execute on function ${schema}.function_${i}() from public;`).join("\n")}
        reset role; insert into public.joy8_product_schemas values('${schema}'); commit`)
    }
    for (const variant of ["baseline", "current"]) {
      await db.exec(variant === "baseline" ? baselineValidation : currentValidation)
      const validation = []
      const settlement = []
      for (let i = -10; i < samples; i++) {
        const started = performance.now()
        await db.query("select public.joy8_validate_product_adapter('fixture_product.accounting(text,uuid,jsonb)'::regprocedure)")
        if (i >= 0) validation.push(performance.now() - started)
        const ref = `benchmark-${variant}-${products}-${i}`
        await db.query("select public.joy8_open_match_v1($1,$2::jsonb)", [secret, JSON.stringify({
          version: 1, match_ref: ref, rule_version: "benchmark",
          participants: [{ session_id: session.session_id, reserve: "100.00" }],
          product_participants: [{ account_ref: "bot-1", reserve: "100.00" }],
        })])
        const settleStarted = performance.now()
        const settled = await one("select public.joy8_settle_match_v1($1,$2::jsonb) result", [secret, JSON.stringify({
          version: 1, match_ref: ref, rule_version: "benchmark", operation_key: ref,
          settlement_no: 1, final: true,
          entries: [
            { kind: "player", account_ref: member.player_account_id, amount: "1.00", source: "gameplay" },
            { kind: "product", account_ref: "bot-1", amount: "-1.00", source: "gameplay" },
          ],
        })])
        if (i >= 0) settlement.push(performance.now() - settleStarted)
        assert.equal(settled.result.state, "settled")
      }
      results.push({ variant, products, samples, validation: summarize(validation), settlement: summarize(settlement) })
    }
  }
  const reconciliation = (await memberSql("../sql/platform-reconciliation.sql")).replace("begin read only;", "").replace("commit;", "")
  for (const [key, value] of Object.entries((await one(reconciliation)).reconciliation)) assert.equal(value, 0, key)
  console.log(JSON.stringify({
    engine: (await one("show server_version")).server_version,
    scope: "Local PostgreSQL, synthetic product accounting and catalog sizes, sequential committed settlement RPCs; excludes Gateway, hosted latency and Mahjong gameplay",
    extraProductSize: { tables: 22, sequences: 22, functions: 32 }, results,
  }, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally { await db.close() }
