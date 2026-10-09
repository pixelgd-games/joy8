import { googleIdentity } from "./fixtures/google-identity.mjs"
import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberPlatformDatabase, reserveMemberWallet } from "./fixtures/member-platform.mjs"

const db = await createTestDatabase()
let games
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]

async function asRole(role, sql, values = []) {
  await db.exec("savepoint role_call")
  try {
    await db.exec(`set local role ${role}`)
    const result = await one(sql, values)
    await db.exec("reset role; release savepoint role_call")
    return result
  } catch (error) {
    await db.exec("rollback to savepoint role_call; release savepoint role_call")
    throw error
  }
}

const wallet = (id, role = "service_role") => asRole(role, "select public.joy8_member_wallet_v1($1::uuid) result", [id]).then(row => row.result.wallet)
const enroll = async () => {
  const id = await googleIdentity(db)
  const member = await one("select * from public.joy8_resolve_member_profile($1,true)", [id])
  return { id, member }
}

before(async () => {
  games = await loadMemberPlatformDatabase(db)
  await db.exec("update public.joy8_wallet_policies set initial_credit=1000")
})
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))
after(() => db.close())

test("an enrolled member reads the shared POINT wallet without changing it", async () => {
  const { id, member } = await enroll()
  const before = await one("select balance::text,updated_at from public.wallet_accounts where player_account_id=$1", [member.player_account_id])
  assert.deepEqual(await wallet(id), { currency: "POINT", status: "active", balance: "1000.00", available_balance: "1000.00" })
  assert.deepEqual(await one("select balance::text,updated_at from public.wallet_accounts where player_account_id=$1", [member.player_account_id]), before)
})

test("reserved POINT stays in the balance and leaves the available amount", async () => {
  const { id } = await enroll()
  const session = await one("select * from public.create_game_session('test-game',$1)", [id])
  await reserveMemberWallet(db, session, games.keys.get(games.game))
  assert.deepEqual(await wallet(id), { currency: "POINT", status: "active", balance: "1000.00", available_balance: "900.00" })
})

test("unenrolled, inactive, banned and deleted identities receive no wallet", async () => {
  assert.equal(await wallet(await googleIdentity(db)), null)
  assert.equal(await wallet("00000000-0000-4000-8000-000000000099"), null)
  const inactive = await enroll()
  await db.query("update public.player_accounts set status='suspended' where id=$1", [inactive.member.player_account_id])
  assert.equal(await wallet(inactive.id), null)
  for (const change of ["banned_until=now()+interval '1 day'", "deleted_at=now()"]) {
    const { id } = await enroll()
    await db.query(`update auth.users set ${change} where id=$1`, [id])
    assert.equal(await wallet(id), null)
  }
})

test("browser roles cannot read member wallets", async () => {
  const { id } = await enroll()
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(wallet(id, role), error => error.code === "42501")
  }
})

const lobby = (id, role = "service_role") => asRole(role, "select public.joy8_member_lobby_v1($1::uuid) result", [id]).then(row => row.result)

test("the lobby snapshot returns the member, wallet and first mailbox page in one call", async () => {
  const { id, member } = await enroll()
  const snapshot = await lobby(id)
  assert.deepEqual(snapshot.result.member, { player_account_ref: member.player_account_id, public_id: member.public_id, account_type: "registered" })
  assert.deepEqual(snapshot.result.wallet, await wallet(id))
  assert.deepEqual(snapshot.result.mail, { items: [], unread: 0, offset: 0 })
})

test("the lobby snapshot reports non-members and rejects inactive identities", async () => {
  assert.deepEqual(await lobby(await googleIdentity(db)), { result: { member: null } })
  const { id } = await enroll()
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [id])
  assert.deepEqual(await lobby(id), { admission_error: "JOY8_PLAYER_INACTIVE" })
})

test("the lobby snapshot uses the member request budget", async () => {
  const { id } = await enroll()
  for (let index = 0; index < 120; index++) assert.ok((await lobby(id)).result.member)
  assert.deepEqual(await lobby(id), { limited: true, retry_after: 60 })
})

test("browser roles cannot read the lobby snapshot", async () => {
  const { id } = await enroll()
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(lobby(id, role), error => error.code === "42501")
  }
})
