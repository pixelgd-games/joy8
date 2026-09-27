import { googleIdentity } from "./fixtures/google-identity.mjs"
import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberPlatformDatabase, reserveMemberWallet } from "./fixtures/member-platform.mjs"

const db = await createTestDatabase()
let existingAuth
let existingPlayer
let existingWallet
let games
const rows = async (sql, values = []) => (await db.query(sql, values)).rows
const one = async (sql, values = []) => (await rows(sql, values))[0]

async function asRole(role, sql, values = []) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role))
  await db.exec("savepoint role_call")
  try {
    await db.exec(`set local role ${role}`)
    const result = await rows(sql, values)
    await db.exec("reset role; release savepoint role_call")
    return result
  } catch (error) {
    await db.exec("rollback to savepoint role_call; release savepoint role_call")
    throw error
  }
}

const resolve = (id, enroll = false, role = "service_role") =>
  asRole(role, "select * from public.joy8_resolve_member($1::uuid, $2::boolean)", [id, enroll])
const launch = (id, { slug = "test-game" } = {}, role = "service_role") =>
  asRole(role, "select * from public.create_game_session($1, $2::uuid)", [slug, id])
const denied = (operation, code = "42501") => assert.rejects(operation, (error) => error.code === code)

async function identity() { return googleIdentity(db) }

async function enrolled(anonymous = true) {
  const id = await identity(anonymous)
  const [member] = await resolve(id, true)
  return { id, member }
}

before(async () => {
  games = await loadMemberPlatformDatabase(db)
  existingAuth = await googleIdentity(db)
  existingPlayer = (await one("insert into public.player_accounts (auth_user_id, account_type) values ($1, 'registered') returning id", [existingAuth])).id
  existingWallet = (await one("insert into public.wallet_accounts (player_account_id,wallet_policy_id) values ($1,$2) returning id", [existingPlayer, games.platformPolicy])).id
})

beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))
after(() => db.close())

test("reading an unenrolled identity creates no player or wallet", async () => {
  const id = await identity()
  assert.deepEqual(await resolve(id), [])
  await denied(launch(id))
  assert.equal((await one("select count(*)::int as count from public.player_accounts where auth_user_id=$1", [id])).count, 0)
})

test("repeated Google enrollment preserves one player and one enrollment wallet", async () => {
  const { id, member } = await enrolled()
  assert.equal(member.account_type, "registered")
  for (let i = 0; i < 5; i++) assert.deepEqual(await resolve(id, true), [member])
  assert.deepEqual(await resolve(id), [member])
  assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 1)
})



test("an existing unenrolled player keeps the shared wallet after explicit enrollment", async () => {
  assert.equal((await one("select member_enrolled_at from public.player_accounts where id=$1", [existingPlayer])).member_enrolled_at, null)
  assert.deepEqual(await resolve(existingAuth), [])
  await denied(launch(existingAuth))
  assert.equal((await resolve(existingAuth, true))[0].player_account_id, existingPlayer)
  assert.equal((await launch(existingAuth))[0].wallet_account_id, existingWallet)
  assert.equal((await one("select count(*)::int as count from public.wallet_transactions where wallet_account_id=$1", [existingWallet])).count, 0)
})

test("verified Auth identity alone does not enroll a player", async () => {
  const id = await identity(false)
  assert.deepEqual(await resolve(id), [])
  await denied(launch(id))
  assert.equal((await resolve(id, true))[0].account_type, "registered")
})

test("launch retries reuse a zero POINT wallet without an automatic grant", async () => {
  const { id, member } = await enrolled()
  const [first] = await launch(id)
  const [second] = await launch(id)
  assert.equal(first.player_account_id, member.player_account_id)
  assert.equal(first.wallet_account_id, second.wallet_account_id)
  assert.notEqual(first.session_id, second.session_id)
  assert.notEqual(first.launch_code, second.launch_code)
  const wallet = await one("select balance, locked_balance from public.wallet_accounts where id=$1", [first.wallet_account_id])
  assert.equal(Number(wallet.balance), 0)
  assert.equal(Number(wallet.locked_balance), 0)
  const grants = await rows("select amount, balance_before, balance_after from public.wallet_transactions where wallet_account_id=$1", [first.wallet_account_id])
  assert.equal(grants.length, 0)
  assert.equal(first.protocol, "server-v1")
})


test("missing, unverified, banned and deleted identities are rejected", async () => {
  await denied(resolve(null, true))
  await denied(resolve("00000000-0000-4000-8000-000000000099", true))
  for (const change of ["is_anonymous=false, email_confirmed_at=null", "banned_until=now()+interval '1 day'", "deleted_at=now()"]) {
    const id = await identity()
    await db.query(`update auth.users set ${change} where id=$1`, [id])
    await denied(resolve(id, true))
    assert.equal((await one("select count(*)::int as count from public.player_accounts where auth_user_id=$1", [id])).count, 0)
  }
})

test("inactive players and registered-to-guest downgrade are rejected", async () => {
  for (const status of ["suspended", "closed"]) {
    const { id, member } = await enrolled()
    await db.query("update public.player_accounts set status=$1 where id=$2", [status, member.player_account_id])
    await denied(resolve(id, true))
    await denied(launch(id))
  }
  const { id } = await enrolled(false)
  await db.query("update auth.users set is_anonymous=true where id=$1", [id])
  await denied(resolve(id, true))
})

test("frozen and closed wallets cannot be replaced or credited again", async () => {
  for (const status of ["frozen", "closed"]) {
    const { id, member } = await enrolled()
    const [session] = await launch(id)
    await db.query("update public.wallet_accounts set status=$1 where id=$2", [status, session.wallet_account_id])
    await denied(launch(id))
    assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 1)
    assert.equal((await one("select count(*)::int as count from public.wallet_transactions where wallet_account_id=$1", [session.wallet_account_id])).count, 0)
  }
})

test("the database rejects duplicate player wallets even when the original is closed", async () => {
  const { id, member } = await enrolled()
  const [session] = await launch(id)
  await db.query("update public.wallet_accounts set status='closed' where id=$1", [session.wallet_account_id])
  await denied(launch(id))
  await denied(db.query("insert into public.wallet_accounts (player_account_id,wallet_policy_id) values ($1,$2)", [member.player_account_id, games.platformPolicy]), "23505")
})

test("a session insert failure rolls back the session", async () => {
  const { id, member } = await enrolled()
  await db.exec("alter table public.game_sessions add constraint test_failure check (false)")
  await denied(launch(id), "23514")
  assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 1)
  assert.equal((await one("select count(*)::int as count from public.game_sessions where player_account_id=$1", [member.player_account_id])).count, 0)
  assert.equal((await one("select count(*)::int as count from public.wallet_transactions")).count, 0)
})

test("browser roles cannot enroll, launch, or write protected player and wallet tables", async () => {
  const { id } = await enrolled()
  for (const role of ["anon", "authenticated"]) {
    await denied(resolve(id, true, role))
    await denied(launch(id, {}, role))
    for (const table of ["player_accounts", "wallet_accounts", "wallet_transactions", "game_sessions"]) {
      await denied(asRole(role, `select * from public.${table}`))
      const grants = await one("select has_table_privilege($1, $2, 'INSERT') as insert, has_table_privilege($1, $2, 'UPDATE') as update, has_table_privilege($1, $2, 'DELETE') as delete", [role, `public.${table}`])
      assert.deepEqual(grants, { insert: false, update: false, delete: false })
    }
  }
})

test("launch secrets are hashed and expire within the fixed session lifetime", async () => {
  const { id } = await enrolled()
  const [session] = await launch(id)
  assert.match(session.launch_code, /^[0-9a-f]{64}$/)
  const stored = await one("select launch_code_hash=public.joy8_hash_secret($1) as hash_matches, launch_code_hash<>$1 as not_plain, extract(epoch from launch_code_expires_at-created_at)::int as launch_ttl, extract(epoch from expires_at-created_at)::int as ttl from public.game_sessions where id=$2", [session.launch_code, session.session_id])
  assert.deepEqual(stored, { hash_matches: true, not_plain: true, launch_ttl: 120, ttl: 43200 })
})

test("unavailable games create no additional wallet or session", async () => {
  const { id, member } = await enrolled()
  for (const slug of ["unknown-game", "hidden-game", "missing-url", " ", "Test Game"]) await denied(launch(id, { slug }), "P0002")
  assert.equal((await one("select count(*)::int as count from public.game_sessions where player_account_id=$1", [member.player_account_id])).count, 0)
  assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 1)
})

test("member checks use the deployed accounting schema without Demo objects", async () => {
  const schema = await one("select to_regclass('public.game_rounds') old_rounds, to_regprocedure('public.record_demo_wallet_initial_credit()') demo_credit, exists(select 1 from information_schema.columns where table_schema='public' and table_name='game_sessions' and column_name='wallet_mode') wallet_mode, to_regprocedure('public.joy8_platform_health_v1()') health")
  assert.equal(schema.old_rounds, null)
  assert.equal(schema.demo_credit, null)
  assert.equal(schema.wallet_mode, false)
  assert.notEqual(schema.health, null)
})

test("all games reuse one zero-balance wallet", async () => {
  const { id, member } = await enrolled()
  const [first] = await launch(id)
  const [shared] = await launch(id, { slug: "shared-game" })
  const [independent] = await launch(id, { slug: "independent-game" })
  assert.equal(first.wallet_account_id, shared.wallet_account_id)
  assert.equal(first.wallet_account_id, independent.wallet_account_id)
  assert.equal(independent.player_account_id, member.player_account_id)
  const wallets = await rows("select balance,locked_balance from public.wallet_accounts where player_account_id=$1", [member.player_account_id])
  assert.equal(wallets.length, 1)
  assert.ok(wallets.every(wallet => Number(wallet.balance) === 0 && Number(wallet.locked_balance) === 0))
})

test("unconfigured and disabled policies reject launch without a session", async () => {
  const { id, member } = await enrolled()
  await denied(launch(id, { slug: "unconfigured-game" }))
  await db.query("update public.joy8_game_policies set enabled=false where game_id=$1", [games.game])
  await denied(launch(id))
  await db.query("update public.joy8_wallet_policies set enabled=false where id=$1", [games.platformPolicy])
  await denied(launch(id, { slug: "independent-game" }))
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).n, 1)
  assert.equal((await one("select count(*)::int n from public.game_sessions where player_account_id=$1", [member.player_account_id])).n, 0)
})
