import assert from "node:assert/strict"
import { test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberDatabase, memberSql } from "./fixtures/member-database.mjs"

for (const [name, setup, expected] of [
  ["non-test session", "update public.game_sessions set wallet_mode='platform'", "LOOTY_RESET_REQUIRES_TEST_ONLY_DATA"],
  ["outstanding reservation", "update public.wallet_accounts set locked_balance=10", "LOOTY_RESET_HAS_OUTSTANDING_RESERVATIONS"],
  ["external cascading dependency", "create table public.other_product_data(id uuid references public.wallet_accounts(id) on delete cascade); insert into public.other_product_data select id from public.wallet_accounts", "LOOTY_RESET_HAS_EXTERNAL_DEPENDENCIES"],
]) test(`cutover refuses ${name} and retains all data and old schema`, async () => {
  const db = await createTestDatabase("pglite")
  try {
    await loadMemberDatabase(db, async () => {}, false)
    const auth = (await db.query("insert into auth.users(is_anonymous) values(true) returning id")).rows[0].id
    await db.query("select * from public.looty_resolve_member($1,true)", [auth])
    const session = (await db.query("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])).rows[0]
    await db.exec(setup)
    await assert.rejects(db.exec(await memberSql("../../supabase/migrations/20260917090000_scoped_wallets.sql")), error => error.message === expected)
    await db.exec("rollback")
    assert.equal((await db.query("select balance from public.wallet_accounts where id=$1", [session.wallet_account_id])).rows[0].balance, "10000.00")
    assert.equal((await db.query("select count(*)::int n from public.wallet_transactions")).rows[0].n, 1)
    assert.notEqual((await db.query("select to_regprocedure('public.wallet_payout(text,text,numeric,text,jsonb)') fn")).rows[0].fn, null)
    assert.notEqual((await db.query("select to_regclass('public.game_rounds') old_table")).rows[0].old_table, null)
  } finally { await db.close() }
})
