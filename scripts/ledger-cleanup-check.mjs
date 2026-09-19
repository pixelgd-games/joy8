import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberPlatformDatabase, reserveMemberWallet } from "./fixtures/member-platform.mjs"
import { memberSql } from "./fixtures/member-database.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const cleanup = await memberSql("../../supabase/migrations/20260918010000_wallet_ledger_cleanup.sql")
const continuous = await memberSql("../../supabase/migrations/20260918010100_continuous_settlement.sql")
let fixture, session, key, beforeRows, beforeFunction

const definition = () => one("select prosrc,proacl,proowner,prosecdef,proconfig from pg_proc where oid='public.looty_settle_match_v1(text,jsonb)'::regprocedure")
const ledger = async () => (await db.query("select * from public.wallet_transactions order by id")).rows
const call = async (name, request) => {
  await db.exec("set role service_role")
  try {
    return (await one(`select public.${name}($1,$2::jsonb) result`, [key, JSON.stringify(request)])).result
  } finally {
    await db.exec("reset role")
  }
}
const settle = ref => ({
  version: 1, match_ref: ref, rule_version: "member-test-v1", operation_key: `settle:${ref}`,
  entries: [
    { kind: "player", account_ref: session.player_account_id, amount: "-10.00", source: "gameplay" },
    { kind: "fee", account_ref: fixture.game, amount: "10.00", source: "fee" },
  ],
})

before(async () => {
  fixture = await loadMemberPlatformDatabase(db, false)
  key = fixture.keys.get(fixture.game)
  await db.query("update public.looty_wallet_policies set initial_credit=1000 where id=$1", [fixture.platformPolicy])
  await db.query("update public.looty_backend_keys set scopes=array['exchange','open','settle'] where game_id=$1", [fixture.game])
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  await db.query("select public.looty_resolve_member($1,true)", [auth])
  session = await one("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])
  await reserveMemberWallet(db, session, key, "looty")
  await call("looty_settle_match_v1", settle(session.session_id))
  beforeRows = await ledger()
  beforeFunction = await definition()
})
after(() => db.close())

test("cleanup refuses nonempty metadata and preserves the old schema and records", async () => {
  await db.exec("begin")
  await db.query(`insert into public.wallet_transactions(wallet_account_id,type,amount,balance_before,balance_after,idempotency_key,metadata)
    values($1,'adjustment',1,990,991,'metadata-guard','{"retain":true}')`, [session.wallet_account_id])
  await assert.rejects(db.exec(cleanup), /LOOTY_LEDGER_METADATA_NOT_EMPTY/)
  await db.exec("rollback")
  assert.deepEqual(await ledger(), beforeRows)
})

test("cleanup refuses open matches without changing reservations", async () => {
  await db.exec("begin")
  await call("looty_open_match_v1", { version: 1, match_ref: "still-open", rule_version: "member-test-v1", participants: [{ session_id: session.session_id, reserve: "100.00" }] })
  await assert.rejects(db.exec(cleanup), /LOOTY_OPEN_MATCHES/)
  await db.exec("rollback")
  assert.equal((await one("select locked_balance from public.wallet_accounts where id=$1", [session.wallet_account_id])).locked_balance, "0.00")
  assert.deepEqual(await definition(), beforeFunction)
})

test("continuous settlement refuses application before ledger cleanup", async () => {
  await assert.rejects(db.exec(continuous), /LOOTY_LEDGER_CLEANUP_REQUIRED/)
  await db.exec("rollback")
  assert.deepEqual(await ledger(), beforeRows)
})

test("cleanup preserves ledger values, balances, security and settlement logic while renaming the reference", async () => {
  const walletBefore = await one("select * from public.wallet_accounts where id=$1", [session.wallet_account_id])
  await db.exec(cleanup)
  assert.deepEqual(await ledger(), beforeRows.map(({ round_id, metadata, ...row }) => ({ ...row, match_ref: round_id })))
  assert.deepEqual(await one("select * from public.wallet_accounts where id=$1", [session.wallet_account_id]), walletBefore)
  assert.deepEqual(await definition(), { ...beforeFunction, prosrc: beforeFunction.prosrc.replace("game_id,round_id,game_session_id", "game_id,match_ref,game_session_id") })
  const columns = (await db.query("select attname from pg_attribute where attrelid='public.wallet_transactions'::regclass and attnum>0 and not attisdropped")).rows.map(row => row.attname)
  assert.ok(columns.includes("match_ref"))
  assert.ok(!columns.includes("round_id") && !columns.includes("metadata"))
  assert.equal((await one("select to_regclass('public.wallet_transactions_game_round_idx') old_index")).old_index, null)
  assert.match((await one("select pg_get_indexdef('public.wallet_transactions_game_match_idx'::regclass) definition")).definition, /\(game_id, match_ref\)/)
})

test("service-role settlement writes match_ref and remains exactly once after cleanup", async () => {
  const ref = "after-cleanup"
  await call("looty_open_match_v1", { version: 1, match_ref: ref, rule_version: "member-test-v1", participants: [{ session_id: session.session_id, reserve: "100.00" }] })
  const first = await call("looty_settle_match_v1", settle(ref))
  const repeat = await call("looty_settle_match_v1", settle(ref))
  assert.deepEqual(first, repeat)
  const rows = (await db.query("select match_ref,source_ref,amount from public.wallet_transactions where match_ref=$1", [ref])).rows
  assert.deepEqual(rows, [{ match_ref: ref, source_ref: first.settlement_id, amount: "10.00" }])
  assert.equal((await one("select balance from public.wallet_accounts where id=$1", [session.wallet_account_id])).balance, "980.00")
})

test("ledger and RPC remain protected and committed records stay immutable", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(db.query("select public.looty_settle_match_v1($1,'{}')", [key]), error => error.code === "42501")
      await assert.rejects(db.query("insert into public.wallet_transactions default values"), error => error.code === "42501")
    } finally {
      await db.exec("reset role")
    }
  }
  const rows = await ledger()
  await assert.rejects(db.exec("update public.wallet_transactions set match_ref='changed'"))
  await assert.rejects(db.exec("delete from public.wallet_transactions"))
  assert.deepEqual(await ledger(), rows)
})

test("cleanup cannot overwrite the continuous settlement extension", async () => {
  await db.exec(continuous)
  const continuousFunction = await definition()
  await assert.rejects(db.exec(cleanup), /LOOTY_LEDGER_CLEANUP_ORDER/)
  await db.exec("rollback")
  assert.deepEqual(await definition(), continuousFunction)
})
