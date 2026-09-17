import assert from "node:assert/strict"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { loadMemberDatabase } from "./fixtures/member-database.mjs"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"

const db = process.env.LOOTY_MEMBER_TEST_ENGINE === "postgres17"
  ? await createLocalPostgres()
  : new PGlite({ extensions: { pgcrypto } })
const legacyAuth = "00000000-0000-4000-8000-000000000001"
let legacyPlayer
let legacyWallet
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
  asRole(role, "select * from public.looty_resolve_member($1::uuid, $2::boolean)", [id, enroll])
const launch = (id, { slug = "test-game", currency = "POINT", seconds = 3600, name = null } = {}, role = "service_role") =>
  asRole(role, "select * from public.create_game_session($1, $2, $3, $4, $5::uuid)", [slug, currency, seconds, name, id])
const denied = (operation, code = "42501") => assert.rejects(operation, (error) => error.code === code)

async function identity(anonymous = true) {
  return (await one("insert into auth.users (is_anonymous, email_confirmed_at) values ($1, case when $1 then null else now() end) returning id", [anonymous])).id
}

async function enrolled(anonymous = true) {
  const id = await identity(anonymous)
  const [member] = await resolve(id, true)
  return { id, member }
}

before(async () => {
  await loadMemberDatabase(db, async () => {
    await db.query("insert into auth.users (id, is_anonymous) values ($1, true)", [legacyAuth])
    legacyPlayer = (await one("insert into public.player_accounts (auth_user_id, account_type) values ($1, 'guest') returning id", [legacyAuth])).id
    legacyWallet = (await one("insert into public.wallet_accounts (player_account_id) values ($1) returning id", [legacyPlayer])).id
  })
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

test("repeated guest enrollment preserves one player without provisioning a wallet", async () => {
  const { id, member } = await enrolled()
  assert.equal(member.account_type, "guest")
  for (let i = 0; i < 5; i++) assert.deepEqual(await resolve(id, true), [member])
  assert.deepEqual(await resolve(id), [member])
  assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 0)
})

test("old player and wallet survive migration but require explicit enrollment", async () => {
  assert.equal((await one("select member_enrolled_at from public.player_accounts where id=$1", [legacyPlayer])).member_enrolled_at, null)
  assert.deepEqual(await resolve(legacyAuth), [])
  await denied(launch(legacyAuth))
  assert.equal((await resolve(legacyAuth, true))[0].player_account_id, legacyPlayer)
  assert.equal((await launch(legacyAuth))[0].wallet_account_id, legacyWallet)
  assert.equal((await one("select count(*)::int as count from public.wallet_transactions where wallet_account_id=$1", [legacyWallet])).count, 1)
})

test("verified Auth identity alone does not enroll a player", async () => {
  const id = await identity(false)
  assert.deepEqual(await resolve(id), [])
  await denied(launch(id))
  assert.equal((await resolve(id, true))[0].account_type, "registered")
})

test("launch retries reuse wallet and grant initial Demo credit once", async () => {
  const { id, member } = await enrolled()
  const [first] = await launch(id)
  const [second] = await launch(id)
  assert.equal(first.player_account_id, member.player_account_id)
  assert.equal(first.wallet_account_id, second.wallet_account_id)
  assert.notEqual(first.session_id, second.session_id)
  assert.notEqual(first.launch_code, second.launch_code)
  const wallet = await one("select balance, locked_balance from public.wallet_accounts where id=$1", [first.wallet_account_id])
  assert.equal(Number(wallet.balance), 10000)
  assert.equal(Number(wallet.locked_balance), 0)
  const grants = await rows("select amount, balance_before, balance_after from public.wallet_transactions where wallet_account_id=$1", [first.wallet_account_id])
  assert.equal(grants.length, 1)
  assert.equal(Number(grants[0].amount), 10000)
  assert.equal(Number(grants[0].balance_before), 0)
  assert.equal(Number(grants[0].balance_after), 10000)
})

test("guest promotion preserves player, wallet, balance, locks and ledger", async () => {
  const { id, member } = await enrolled()
  const [guest] = await launch(id)
  await db.query("update public.wallet_accounts set balance=8750, locked_balance=250 where id=$1", [guest.wallet_account_id])
  const beforeWallet = await one("select * from public.wallet_accounts where id=$1", [guest.wallet_account_id])
  const beforeLedger = await rows("select * from public.wallet_transactions where wallet_account_id=$1", [guest.wallet_account_id])
  await db.query("update auth.users set is_anonymous=false, email_confirmed_at=now() where id=$1", [id])
  const [promoted] = await resolve(id)
  assert.equal(promoted.player_account_id, member.player_account_id)
  assert.equal(promoted.account_type, "registered")
  const upgraded = await one("select upgraded_at from public.player_accounts where id=$1", [member.player_account_id])
  assert.ok(upgraded.upgraded_at)
  const [registered] = await launch(id)
  assert.equal(registered.wallet_account_id, guest.wallet_account_id)
  assert.equal(registered.account_type, "registered")
  assert.deepEqual(await one("select * from public.wallet_accounts where id=$1", [guest.wallet_account_id]), beforeWallet)
  assert.deepEqual(await rows("select * from public.wallet_transactions where wallet_account_id=$1", [guest.wallet_account_id]), beforeLedger)
  await resolve(id, true)
  assert.deepEqual(await one("select upgraded_at from public.player_accounts where id=$1", [member.player_account_id]), upgraded)
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
    assert.equal((await one("select count(*)::int as count from public.wallet_transactions where wallet_account_id=$1", [session.wallet_account_id])).count, 1)
  }
})

test("ambiguous wallets fail instead of selecting an active replacement", async () => {
  const { id, member } = await enrolled()
  const [session] = await launch(id)
  await db.query("update public.wallet_accounts set status='closed' where id=$1", [session.wallet_account_id])
  await db.query("insert into public.wallet_accounts (player_account_id, balance) values ($1, 0)", [member.player_account_id])
  await denied(launch(id))
})

test("a session insert failure rolls back wallet, initial credit and name changes", async () => {
  const { id, member } = await enrolled()
  await db.exec("alter table public.game_sessions add constraint test_failure check (false)")
  await denied(launch(id, { name: "Test player" }), "23514")
  assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 0)
  assert.equal((await one("select count(*)::int as count from public.wallet_transactions")).count, 1)
  assert.equal((await one("select display_name from public.player_accounts where id=$1", [member.player_account_id])).display_name, null)
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

test("launch secrets are hashed and expire within session lifetime", async () => {
  const { id } = await enrolled()
  for (const seconds of [60, 3600]) {
    const [session] = await launch(id, { seconds })
    assert.match(session.launch_code, /^[0-9a-f]{64}$/)
    const stored = await one("select launch_code_hash=public.looty_hash_secret($1) as hash_matches, launch_code_hash<>$1 as not_plain, launch_code_expires_at<=expires_at as bounded, extract(epoch from launch_code_expires_at-now())::int as ttl from public.game_sessions where id=$2", [session.launch_code, session.session_id])
    assert.deepEqual(stored, { hash_matches: true, not_plain: true, bounded: true, ttl: Math.min(seconds, 120) })
  }
})

test("unavailable games and invalid launch input create no wallet", async () => {
  const { id, member } = await enrolled()
  for (const slug of ["unknown-game", "hidden-game", "missing-url"]) await denied(launch(id, { slug }), "P0002")
  for (const options of [{ slug: " " }, { seconds: 59 }, { seconds: 86401 }, { currency: " " }, { name: "x".repeat(121) }]) await denied(launch(id, options), "22023")
  assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 0)
})
