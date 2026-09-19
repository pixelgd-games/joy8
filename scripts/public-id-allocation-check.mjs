import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberDatabase, memberSql } from "./fixtures/member-database.mjs"
import { applyJoy8Rebrand } from "./fixtures/joy8-rebrand.mjs"
import { hardeningSql } from "./fixtures/platform-hardening.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
let existing
before(async () => {
  await loadMemberDatabase(db, async () => {}, false)
  await applyJoy8Rebrand(db)
  for (const name of ["20260919130000_read_only_member_lookup.sql", "20260920100000_public_player_ids.sql"]) {
    await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  }
  existing = await one("insert into public.player_accounts(account_type) values('guest') returning id,public_id")
  await db.exec(await memberSql("../../supabase/migrations/20260920110000_public_id_allocation.sql"))
  await db.exec(await hardeningSql("allocation"))
})
after(() => db.close())

test("allocation replacement preserves identifiers, grants and the unique index", async () => {
  assert.deepEqual(await one("select id,public_id from public.player_accounts where id=$1", [existing.id]), existing)
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await one("select has_function_privilege($1,'public.joy8_allocate_public_player_id()','EXECUTE') allowed", [role])).allowed, false)
  }
  assert.equal((await one("select has_function_privilege('service_role','public.joy8_allocate_public_player_id()','EXECUTE') allowed")).allowed, true)
  await assert.rejects(db.query("insert into public.player_accounts(account_type,public_id) values('guest',$1)", [existing.public_id]), error => error.code === "23505")
})

test("a committed random collision is skipped without changing the prior player", async () => {
  await db.exec("select setseed(0.37)")
  const first = await one("insert into public.player_accounts(account_type) values('guest') returning public_id")
  await db.exec("select setseed(0.37)")
  const second = await one("insert into public.player_accounts(account_type) values('guest') returning public_id")
  assert.notEqual(first.public_id, second.public_id)
  assert.match(second.public_id, /^[1-9][0-9]{5}$/)
})

test("first enrollment returns the new profile immediately and retries preserve it without a wallet", async () => {
  const auth = await one("insert into auth.users(is_anonymous) values(true) returning id")
  await db.exec("set role service_role")
  try {
    assert.equal(await one("select * from public.joy8_resolve_member_profile($1,false)", [auth.id]), undefined)
    const member = await one("select * from public.joy8_resolve_member_profile($1,true)", [auth.id])
    assert.equal(member.account_type, "guest")
    assert.match(member.public_id, /^[1-9][0-9]{5}$/)
    assert.deepEqual(await one("select * from public.joy8_resolve_member_profile($1,true)", [auth.id]), member)
    assert.deepEqual(await one("select * from public.joy8_resolve_member_profile($1,false)", [auth.id]), member)
  } finally { await db.exec("reset role") }
  assert.equal((await one("select count(*)::int n from public.player_accounts where auth_user_id=$1", [auth.id])).n, 1)
  assert.equal((await one("select count(*)::int n from public.wallet_accounts")).n, 0)
})
