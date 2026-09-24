import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createTestDatabase } from './fixtures/test-database.mjs'
import { loadCurrentPlatform } from './fixtures/platform-bundle.mjs'

const origin = 'https://joy8.cc'
let db, game, member, user
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const launch = (id = user, from = origin, slug = 'monster-lab') => one('select public.joy8_create_private_session($1,$2,$3) result', [slug, id, from])
async function isolated(action) {
  await db.exec('begin')
  try {
    await db.exec("update public.joy8_private_entries set enabled=true")
    await action()
  } finally { await db.exec('rollback') }
}
async function denied(action, pattern) {
  await db.exec('savepoint denial')
  await assert.rejects(action, pattern)
  await db.exec('rollback to savepoint denial')
}

before(async () => {
  db = await createTestDatabase()
  await loadCurrentPlatform(db)
  game = (await one("select id from public.games where slug='monster-lab'")).id
  user = (await one('insert into auth.users(is_anonymous) values(true) returning id')).id
  member = (await one('select * from public.joy8_resolve_member($1,true)', [user])).player_account_id
})
after(async () => db?.close())

test('entries start paused and hidden with no player allowlist', async () => {
  assert.deepEqual(await one('select published,launch_url from public.games where id=$1', [game]), { published: false, launch_url: null })
  assert.equal((await one('select enabled from public.joy8_private_entries where game_id=$1', [game])).enabled, false)
  assert.equal((await one("select to_regclass('public.joy8_private_players') table_name")).table_name, null)
  await db.exec('begin; set local role service_role')
  try { await denied(() => launch(), /JOY8_PRIVATE_ENTRY_DENIED/) } finally { await db.exec('rollback') }
})

test('public launch still rejects a hidden game', () => isolated(async () => {
  await denied(() => one("select * from public.create_game_session('monster-lab',$1)", [user]), /game is not available/)
}))

test('guest keeps the same identity and wallet on repeated entry without approval', () => isolated(async () => {
  await db.exec('set role service_role')
  const a = (await launch()).result, b = (await launch()).result
  await db.exec('reset role')
  assert.equal(a.player_account_ref, member)
  assert.equal(b.player_account_ref, member)
  assert.notEqual(a.launch_code, b.launch_code)
  assert.equal(a.wallet_account_id, undefined)
  assert.equal(a.launch_url, 'https://monster-lab-7aj.pages.dev/client/')
  assert.equal(a.game_name, 'Monster Lab')
  assert.equal(Number((await one('select count(*) n from public.wallet_accounts where player_account_id=$1', [member])).n), 1)
  assert.equal(Number((await one('select count(*) n from public.game_sessions where player_account_id=$1', [member])).n), 2)
}))

test('wrong origin, unknown game, disabled entry and published game are rejected', () => isolated(async () => {
  for (const from of [null, 'https://joy8.pages.dev', 'http://localhost:5173', 'https://www.joy8.cc']) await denied(() => launch(user, from), /JOY8_PRIVATE_ENTRY_DENIED/)
  await denied(() => launch(user, origin, 'missing-game'), /JOY8_PRIVATE_ENTRY_DENIED/)
  await db.query('update public.games set published=true where id=$1', [game])
  await denied(() => launch(), /JOY8_PRIVATE_ENTRY_DENIED/)
  await db.query('update public.games set published=false where id=$1', [game])
  await db.exec('update public.joy8_private_entries set enabled=false')
  await denied(() => launch(), /JOY8_PRIVATE_ENTRY_DENIED/)
  assert.equal(Number((await one('select count(*) n from public.game_sessions')).n), 0)
}))

test('any enrolled guest or registered member enters with their own identity and wallet', () => isolated(async () => {
  const first = (await launch()).result
  for (const anonymous of [true, false]) {
    const other = (await one('insert into auth.users(is_anonymous,email_confirmed_at) values($1,case when $1 then null else now() end) returning id', [anonymous])).id
    const otherMember = (await one('select * from public.joy8_resolve_member($1,true)', [other])).player_account_id
    const session = (await launch(other)).result
    assert.equal(session.player_account_ref, otherMember)
    assert.notEqual(session.player_account_ref, first.player_account_ref)
    assert.equal(session.account_type, anonymous ? 'guest' : 'registered')
  }
  assert.equal(Number((await one('select count(distinct player_account_id) n from public.game_sessions')).n), 3)
}))

test('missing identity and missing enrollment cannot create a wallet or session', () => isolated(async () => {
  await denied(() => launch(null), /verified member identity is required/)
  const other = (await one('insert into auth.users(is_anonymous) values(true) returning id')).id
  await denied(() => launch(other), /player membership is required/)
  assert.equal(Number((await one('select count(*) n from public.game_sessions')).n), 0)
  assert.equal(Number((await one('select count(*) n from public.player_accounts where auth_user_id=$1', [other])).n), 0)
}))

test('suspended player or disabled wallet policy cannot launch', () => isolated(async () => {
  await db.query("update public.player_accounts set status='suspended' where id=$1", [member])
  await denied(() => launch(), /player account is not active/)
  await db.query("update public.player_accounts set status='active' where id=$1", [member])
  await db.exec('update public.joy8_wallet_policies set enabled=false')
  await denied(() => launch(), /JOY8_GAME_NOT_READY/)
}))

test('browser roles cannot read entry configuration or issue sessions', () => isolated(async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await denied(() => one('select * from public.joy8_private_entries'), /permission denied/)
    await denied(() => launch(), /permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  await denied(() => one("select * from public.joy8_issue_game_session('monster-lab',$1)", [user]), /permission denied/)
}))

test('an exchange/renew-only backend exchanges once, sees the grant and cannot open a match', () => isolated(async () => {
  const key = 'b'.repeat(64)
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','renew'])", [game, key])
  const session = (await launch()).result
  const request = { version: 1, launch_code: session.launch_code }
  const result = (await one("select public.joy8_server_session_v1($1,'exchange',$2::jsonb) result", [key, JSON.stringify(request)])).result
  assert.equal(result.player_account_ref, member)
  assert.equal(Number((await one('select * from public.wallet_get_balance($1)', [result.gateway_token])).balance), 100)
  await denied(() => one("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [key, JSON.stringify(request)]), /JOY8_SESSION_INVALID/)
  await denied(() => one("select public.joy8_backend_game($1,'open')", [key]), /JOY8_BACKEND_UNAUTHORIZED/)
}))

test('published games use the two-argument public launch with fixed lifetimes', () => isolated(async () => {
  const publicGame = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one('select id from public.joy8_wallet_policies')).id
  await db.query('insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount) values($1,$2,true,1000,1000)', [publicGame, policy])
  await denied(() => one("select * from public.create_game_session('missing-url',$1)", [user]), /game is not available/)
  const result = await one("select * from public.create_game_session('test-game',$1)", [user])
  assert.equal(result.player_account_id, member)
  assert.equal(result.protocol, 'server-v1')
  assert.equal(result.currency, 'POINT')
  assert.deepEqual(await one('select extract(epoch from expires_at-created_at)::int ttl,extract(epoch from launch_code_expires_at-created_at)::int launch_ttl from public.game_sessions where id=$1', [result.session_id]), { ttl: 43200, launch_ttl: 120 })
  assert.equal((await one("select to_regprocedure('public.create_game_session(text,text,integer,text,uuid)') is null removed")).removed, true)
}))
