import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { loadMemberPlatformDatabase, reserveMemberWallet } from "./fixtures/member-platform.mjs"

const db = await createLocalPostgres()
const resolveSql = "select * from public.joy8_resolve_member($1::uuid, true)"
const lockSql = "select pg_advisory_xact_lock(hashtextextended($1::text, 0))"
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
let games

before(async () => { games = await loadMemberPlatformDatabase(db) })
after(() => db.close())

async function identity() {
  return (await one("insert into auth.users (is_anonymous) values (true) returning id")).id
}

async function serviceQuery(sql, values) {
  const client = await db.connect()
  try {
    await client.query("set role service_role")
    return (await client.query(sql, values)).rows
  } finally {
    await client.end()
  }
}

async function waitBlocked(clients) {
  const pids = clients.map((client) => client.processID)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const { count } = await one("select count(*)::int as count from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0", [pids])
    if (count === clients.length) return
    await delay(10)
  }
  assert.fail("Expected every competing connection to wait on a database lock")
}

async function blockedRace({ hold, holdValues, work, workValues, count = 8, release = "commit" }) {
  assert.ok(["commit", "rollback"].includes(release))
  const gate = await db.connect()
  const clients = []
  const pending = []
  try {
    await gate.query("begin")
    await gate.query(hold, holdValues)
    for (let i = 0; i < count; i++) {
      const client = await db.connect()
      clients.push(client)
      await client.query("set role service_role")
      pending.push(client.query(work, typeof workValues === "function" ? workValues(i) : workValues).then((value) => ({ rows: value.rows }), (error) => ({ error })))
    }
    await waitBlocked(clients)
    await gate.query(release)
    return await Promise.all(pending)
  } finally {
    await gate.query("rollback")
    await Promise.allSettled(pending)
    await Promise.allSettled(clients.map((client) => client.end()))
    await gate.end()
  }
}

function successful(results) {
  for (const result of results) assert.equal(result.error, undefined, result.error?.message)
  return results.map((result) => result.rows[0])
}

test("eight simultaneous enrollments create exactly one player", async () => {
  const id = await identity()
  const members = successful(await blockedRace({ hold: lockSql, holdValues: [id], work: resolveSql, workValues: [id] }))
  assert.equal(new Set(members.map((member) => member.player_account_id)).size, 1)
  assert.ok(members.every((member) => member.account_type === "guest"))
  assert.equal((await one("select count(*)::int as count from public.player_accounts where auth_user_id=$1", [id])).count, 1)
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where player_account_id=$1", [members[0].player_account_id])).n, 0)
})

for (const slug of ["test-game", "independent-game"]) {
  const launchSql = `select * from public.create_game_session('${slug}', 'POINT', 3600, null, $1::uuid)`

  test(`${slug}: eight simultaneous launches create one zero wallet without grants`, async () => {
    const id = await identity()
    const [member] = await serviceQuery(resolveSql, [id])
    const sessions = successful(await blockedRace({ hold: lockSql, holdValues: [id], work: launchSql, workValues: [id] }))
    assert.equal(new Set(sessions.map((session) => session.wallet_account_id)).size, 1)
    assert.equal(new Set(sessions.map((session) => session.session_id)).size, 8)
    assert.equal(new Set(sessions.map((session) => session.launch_code)).size, 8)
    assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 1)
    const ledger = await one("select count(*)::int as count, sum(amount) as amount from public.wallet_transactions where wallet_account_id=$1", [sessions[0].wallet_account_id])
    assert.equal(ledger.count, 0)
    assert.equal(Number((await one("select balance from public.wallet_accounts where id=$1", [sessions[0].wallet_account_id])).balance), 0)
  })

  test(`${slug}: concurrent promotion preserves the wallet, ledger and reservation`, async () => {
    const id = await identity()
    const [member] = await serviceQuery(resolveSql, [id])
    const policy = slug === "test-game" ? games.platformPolicy : games.gamePolicy
    await db.query("update public.joy8_wallet_policies set initial_credit=1000 where id=$1", [policy])
    let session
    try { [session] = await serviceQuery(launchSql, [id]) }
    finally { await db.query("update public.joy8_wallet_policies set initial_credit=0 where id=$1", [policy]) }
    await reserveMemberWallet(db, session, games.keys.get(session.game_id))
    const snapshot = async () => ({
      wallet: await one("select * from public.wallet_accounts where id=$1", [session.wallet_account_id]),
      ledger: (await db.query("select * from public.wallet_transactions where wallet_account_id=$1 order by id", [session.wallet_account_id])).rows,
      reservation: await one("select * from public.joy8_match_participants where wallet_account_id=$1", [session.wallet_account_id]),
    })
    const before = await snapshot()
    assert.equal(Number(before.wallet.balance), 1000)
    assert.equal(Number(before.wallet.locked_balance), 100)
    assert.equal(before.ledger.length, 1)
    assert.ok(before.reservation)
    const members = successful(await blockedRace({
      hold: "update auth.users set is_anonymous=false, email_confirmed_at=now() where id=$1",
      holdValues: [id], work: resolveSql, workValues: [id],
    }))
    assert.ok(members.every((current) => current.player_account_id === member.player_account_id && current.account_type === "registered"))
    const [registered] = await serviceQuery(launchSql, [id])
    assert.equal(registered.wallet_account_id, session.wallet_account_id)
    assert.deepEqual(await snapshot(), before)
  })

  test(`${slug}: rolled-back Auth promotion leaves queued launches as the same guest`, async () => {
    const id = await identity()
    const [member] = await serviceQuery(resolveSql, [id])
    const sessions = successful(await blockedRace({
      hold: "update auth.users set is_anonymous=false, email_confirmed_at=now() where id=$1",
      holdValues: [id], work: launchSql, workValues: [id], release: "rollback",
    }))
    assert.ok(sessions.every((session) => session.player_account_id === member.player_account_id && session.account_type === "guest"))
    assert.equal((await one("select upgraded_at from public.player_accounts where id=$1", [member.player_account_id])).upgraded_at, null)
    assert.equal(new Set(sessions.map((session) => session.wallet_account_id)).size, 1)
  })

  test(`${slug}: a wallet freeze committed first rejects waiting launches without replacement`, async () => {
    const id = await identity()
    const [member] = await serviceQuery(resolveSql, [id])
    const [session] = await serviceQuery(launchSql, [id])
    const results = await blockedRace({ hold: "update public.wallet_accounts set status='frozen' where id=$1", holdValues: [session.wallet_account_id], work: launchSql, workValues: [id] })
    assert.ok(results.every((result) => result.error?.code === "42501"))
    assert.equal((await one("select count(*)::int as count from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).count, 1)
    assert.equal((await one("select count(*)::int as count from public.game_sessions where player_account_id=$1", [member.player_account_id])).count, 1)
    assert.equal((await one("select count(*)::int as count from public.wallet_transactions where wallet_account_id=$1", [session.wallet_account_id])).count, 0)
  })

  test(`${slug}: a launch committed first lets the waiting freeze finish and blocks later launches`, async () => {
    const id = await identity()
    const [member] = await serviceQuery(resolveSql, [id])
    const policy = slug === "test-game" ? games.platformPolicy : games.gamePolicy
    await db.query("insert into public.wallet_accounts (player_account_id,wallet_policy_id) values ($1,$2)", [member.player_account_id, policy])
    successful(await blockedRace({
      hold: launchSql, holdValues: [id], count: 1,
      work: "update public.wallet_accounts set status='frozen' where player_account_id=$1 returning id",
      workValues: [member.player_account_id],
    }))
    await assert.rejects(serviceQuery(launchSql, [id]), (error) => error.code === "42501")
    assert.equal((await one("select count(*)::int as count from public.game_sessions where player_account_id=$1", [member.player_account_id])).count, 1)
  })
}

test("concurrent launches across three titles create exactly two zero wallet scopes", async () => {
  const id = await identity()
  const [member] = await serviceQuery(resolveSql, [id])
  const slugs = ["test-game", "shared-game", "independent-game"]
  const sessions = successful(await blockedRace({
    hold: lockSql, holdValues: [id], count: 9,
    work: "select * from public.create_game_session($2, 'POINT', 3600, null, $1::uuid)",
    workValues: index => [id, slugs[index % slugs.length]],
  }))
  const shared = sessions.filter(session => session.game_id !== games.independent)
  const independent = sessions.filter(session => session.game_id === games.independent)
  assert.equal(new Set(shared.map(session => session.wallet_account_id)).size, 1)
  assert.equal(new Set(independent.map(session => session.wallet_account_id)).size, 1)
  assert.notEqual(shared[0].wallet_account_id, independent[0].wallet_account_id)
  const wallets = (await db.query("select balance,locked_balance from public.wallet_accounts where player_account_id=$1", [member.player_account_id])).rows
  assert.equal(wallets.length, 2)
  assert.ok(wallets.every(wallet => Number(wallet.balance) === 0 && Number(wallet.locked_balance) === 0))
})

test("rolling back the first enrollment permits queued retries to create one player", async () => {
  const id = await identity()
  const members = successful(await blockedRace({ hold: resolveSql, holdValues: [id], work: resolveSql, workValues: [id], release: "rollback" }))
  assert.equal(new Set(members.map((member) => member.player_account_id)).size, 1)
  assert.equal((await one("select count(*)::int as count from public.player_accounts where auth_user_id=$1", [id])).count, 1)
})

test("locking one identity does not block a different player's enrollment", async () => {
  const first = await identity()
  const second = await identity()
  const gate = await db.connect()
  const client = await db.connect()
  try {
    await gate.query("begin")
    await gate.query(lockSql, [first])
    await client.query("set role service_role; set statement_timeout=2000")
    const result = await client.query(resolveSql, [second])
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].account_type, "guest")
  } finally {
    await gate.query("rollback")
    await gate.end()
    await client.end()
  }
})
