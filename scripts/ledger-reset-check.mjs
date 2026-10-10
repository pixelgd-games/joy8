import { googleIdentity } from "./fixtures/google-identity.mjs"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { randomBytes, randomUUID } from "node:crypto"
import { after, afterEach, before, beforeEach, test } from "node:test"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
const games = {}

before(async () => {
  await loadCurrentPlatform(db)
  const policy = (await one("update public.joy8_wallet_policies set initial_credit=1000,enabled=true returning id")).id
  await db.query("insert into public.games(name,slug,type,published,launch_url) values('Other','other-game','slot',true,'https://other.example/')")
  for (const slug of ["test-game", "other-game"]) {
    const id = (await one("select id from public.games where slug=$1", [slug])).id
    const secret = randomBytes(32).toString("hex")
    await db.query(`insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,max_participants,funding_mode)
      values($1,$2,true,10000,1000000,1,'platform')`, [id, policy])
    await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','open','settle','status','cancel'])", [id, secret])
    games[slug] = { id, secret }
  }
})
after(() => db.close())
beforeEach(() => db.exec("begin"))
afterEach(() => db.exec("rollback"))

const gateway = async (slug, route, body) => (await one("select public.joy8_server_request_v1($1,$2,10000,60,$3,$4::jsonb) result",
  [route, `ingress:${randomUUID()}`, games[slug].secret, JSON.stringify(body)])).result

async function play(auth, player, slug, reserve, amount) {
  const session = await one(`select * from public.create_game_session('${slug}',$1)`, [auth])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [games[slug].secret, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  const match = randomUUID()
  assert.equal((await gateway(slug, "server-open-v1", { version: 1, match_ref: match, rule_version: "v1", participants: [{ session_id: session.session_id, reserve }] })).result.state, "open")
  assert.equal((await gateway(slug, "server-settle-v1", { version: 1, match_ref: match, rule_version: "v1", operation_key: `${match}:1`, settlement_no: 1, final: true,
    entries: [{ kind: "player", account_ref: player, amount, source: "gameplay" }] })).result.state, "settled")
}

async function member() {
  const auth = await googleIdentity(db)
  const player = (await one("select * from public.joy8_resolve_member($1,true)", [auth])).player_account_id
  return { auth, player }
}

const balance = async player => (await one("select balance::text from public.wallet_accounts where player_account_id=$1", [player])).balance

const planSql = readFileSync(new URL("./sql/ledger-reset-plan.sql", import.meta.url), "utf8").replace(/^begin read only;\s*/, "")
async function reset(game = null) {
  const plan = (await db.query(planSql)).rows.find(row => row.expected.game_id === game)
  assert.equal(Number(plan.open_matches), 0)
  return (await one("select public.joy8_operator_reset_ledger($1::jsonb,$2) result", [plan.expected, game])).result
}
async function reconciled() {
  const rows = await one(`select
    (select count(*)::int from public.wallet_accounts w where w.balance<>(select coalesce(sum(t.balance_after-t.balance_before),0) from public.wallet_transactions t where t.wallet_account_id=w.id)) wallets,
    (select count(*)::int from public.wallet_accounts w where w.locked_balance<>0) locked`)
  assert.deepEqual(rows, { wallets: 0, locked: 0 })
}

test("a game-scoped reset removes only that game's history and reverses its effect on balances", async () => {
  const { auth, player } = await member()
  await play(auth, player, "test-game", "100.00", "50.00")
  await play(auth, player, "other-game", "100.00", "-30.00")
  assert.equal(await balance(player), "1020.00")
  const result = await reset(games["test-game"].id)
  assert.equal(result.joy8_matches, 1)
  assert.equal(result.wallet_transactions, 1)
  assert.equal(await balance(player), "970.00")
  assert.deepEqual((await db.query("select g.slug from public.joy8_matches m join public.games g on g.id=m.game_id")).rows, [{ slug: "other-game" }])
  assert.deepEqual((await db.query("select g.slug from public.game_sessions s join public.games g on g.id=s.game_id")).rows, [{ slug: "other-game" }])
  assert.equal((await one("select count(*)::int n from public.wallet_transactions where source_type='initial_grant'")).n, 1)
  await reconciled()
})

test("a full reset empties every ledger and the next enrollment grants the welcome POINT again", async () => {
  const { auth, player } = await member()
  await play(auth, player, "test-game", "100.00", "50.00")
  await play(auth, player, "other-game", "100.00", "-30.00")
  const result = await reset()
  assert.equal(result.wallet_transactions, 3)
  assert.equal(result.joy8_matches, 2)
  assert.equal(result.game_sessions, 2)
  for (const table of ["wallet_transactions", "game_sessions", "joy8_matches", "joy8_match_participants", "joy8_settlements", "joy8_settlement_entries", "joy8_mail_messages"]) {
    assert.equal((await one(`select count(*)::int n from public.${table}`)).n, 0, table)
  }
  assert.equal(await balance(player), "0.00")
  await reconciled()
  await one("select * from public.joy8_resolve_member($1,true)", [auth])
  assert.equal(await balance(player), "1000.00")
  for (const trigger of ["joy8_wallet_transactions_immutable", "joy8_settlements_immutable", "joy8_settlement_entries_immutable", "joy8_mail_message_history"]) {
    assert.equal((await one("select tgenabled from pg_trigger where tgname=$1", [trigger])).tgenabled, "O", trigger)
  }
})

test("stale counts, an unknown game and a balance that would turn negative stop without changes", async () => {
  const { auth, player } = await member()
  await play(auth, player, "test-game", "100.00", "5000.00")
  await play(auth, player, "other-game", "6000.00", "-6000.00")
  assert.equal(await balance(player), "0.00")
  const stale = async () => one("select public.joy8_operator_reset_ledger($1::jsonb,null)", [JSON.stringify({ game_id: null, wallet_transactions: 1 })])
  for (const [run, code] of [[stale, "JOY8_LEDGER_RESET_STALE"],
    [() => one("select public.joy8_operator_reset_ledger('{}'::jsonb,$1)", [randomUUID()]), "JOY8_LEDGER_RESET_GAME_NOT_FOUND"],
    [() => reset(games["test-game"].id), "JOY8_LEDGER_RESET_NEGATIVE_BALANCE"]]) {
    await db.exec("savepoint rejected")
    await assert.rejects(run(), error => error.message.includes(code))
    await db.exec("rollback to savepoint rejected")
  }
  assert.equal((await one("select count(*)::int n from public.joy8_matches")).n, 2)
  assert.equal(await balance(player), "0.00")
})

test("sessions still referenced by product data are kept and reported while the ledger is cleared", async () => {
  const { auth, player } = await member()
  await play(auth, player, "test-game", "100.00", "50.00")
  await db.exec("create table public.reset_probe(session_id uuid references public.game_sessions(id))")
  await play(auth, player, "other-game", "100.00", "-30.00")
  await db.exec("insert into public.reset_probe select id from public.game_sessions where game_id=(select id from public.games where slug='test-game')")
  assert.equal((await reset()).game_sessions_kept, 1)
  assert.equal((await one("select count(*)::int n from public.joy8_matches")).n, 0)
  assert.equal((await one("select count(*)::int n from public.game_sessions")).n, 1)
  await db.exec("delete from public.reset_probe")
  assert.equal((await reset(games["test-game"].id)).game_sessions_kept, 0)
  assert.equal((await one("select count(*)::int n from public.game_sessions")).n, 0)
  assert.equal((await one("select tgenabled from pg_trigger where tgname='joy8_wallet_transactions_immutable'")).tgenabled, "O")
})

test("only the database owner can run the reset", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal((await one("select has_function_privilege($1,'public.joy8_operator_reset_ledger(jsonb,uuid)','execute') ok", [role])).ok, false, role)
  }
})
