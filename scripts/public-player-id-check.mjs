import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { applyJoy8Rebrand } from "./fixtures/joy8-rebrand.mjs"
import { loadMemberDatabase, memberSql } from "./fixtures/member-database.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const rows = async (sql, values = []) => (await db.query(sql, values)).rows
const one = async (sql, values = []) => (await rows(sql, values))[0]
let existingPlayerId

before(async () => {
  await loadMemberDatabase(db, async () => {}, false)
  const auth = await one("insert into auth.users (is_anonymous) values (true) returning id")
  existingPlayerId = (await one("insert into public.player_accounts (auth_user_id, account_type, member_enrolled_at) values ($1, 'guest', now()) returning id", [auth.id])).id
  await applyJoy8Rebrand(db)
  await db.exec(await memberSql("../../supabase/migrations/20260920100000_public_player_ids.sql"))
})

after(() => db.close())

test("existing and new players receive stable six-digit public IDs", async () => {
  const existing = await one("select public_id from public.player_accounts where id=$1", [existingPlayerId])
  assert.match(existing.public_id, /^[1-9][0-9]{5}$/)

  const created = []
  for (let index = 0; index < 100; index++) {
    created.push((await one("insert into public.player_accounts (account_type) values ('guest') returning public_id")).public_id)
  }
  assert.equal(new Set(created).size, created.length)
  assert.ok(created.every((publicId) => /^[1-9][0-9]{5}$/.test(publicId)))

  const registeredAuth = await one("insert into auth.users (is_anonymous, email_confirmed_at) values (false, now()) returning id")
  await db.query("update public.player_accounts set account_type='registered', auth_user_id=$2 where id=$1", [existingPlayerId, registeredAuth.id])
  assert.equal((await one("select public_id from public.player_accounts where id=$1", [existingPlayerId])).public_id, existing.public_id)
})

test("only the service role can resolve a public player profile", async () => {
  const authUserId = (await one("select auth_user_id from public.player_accounts where id=$1", [existingPlayerId])).auth_user_id
  await db.exec("set role authenticated")
  await assert.rejects(rows("select * from public.joy8_resolve_member_profile($1, false)", [authUserId]), /permission denied/i)
  await db.exec("reset role")

  await db.exec("set role service_role")
  const profile = await one("select * from public.joy8_resolve_member_profile($1, false)", [authUserId])
  await db.exec("reset role")
  assert.match(profile.public_id, /^[1-9][0-9]{5}$/)
})
