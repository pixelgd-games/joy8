import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createTestDatabase } from './fixtures/test-database.mjs'
import { loadPlatformDatabase } from './fixtures/platform-database.mjs'
import { credentialBundle } from './mahjong-credentials.mjs'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { applyJoy8Rebrand } from './fixtures/joy8-rebrand.mjs'
import { loadPlatformHardening } from './fixtures/platform-hardening.mjs'

let db, game, member, user
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const launch = (id = user, origin = 'http://localhost:5173', slug = 'mahjong-clash') => one('select public.joy8_create_private_session($1,$2,$3) result', [slug,id,origin])
async function isolated(action) {
  await db.exec('begin')
  try { await action() } finally { await db.exec('rollback') }
}
async function denied(action, pattern) {
  await db.exec('savepoint denial')
  await assert.rejects(action,pattern)
  await db.exec('rollback to savepoint denial')
}

before(async () => {
  db = await createTestDatabase()
  await loadPlatformDatabase(db, async () => {}, false)
  for (const name of ['20260918010000_wallet_ledger_cleanup.sql','20260918010100_continuous_settlement.sql','20260918010200_mahjong_state.sql','20260918010300_mahjong_economy.sql','20260918010400_mahjong_accounting.sql','20260918010500_mahjong_lifecycle.sql','20260918010600_mahjong_runtime.sql','20260918010700_mahjong_registration.sql']) {
    await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'))
  }
  await db.exec(await readFile('supabase/migrations/20260918010800_private_game_entry.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20260918010900_mahjong_identity_activation.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20260918011000_remove_test_player_allowlist.sql','utf8'))
  await applyJoy8Rebrand(db)
  await db.exec(await readFile('supabase/migrations/20260919130000_read_only_member_lookup.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20260919131000_cross_product_adapter_isolation.sql','utf8'))
  for (const name of ['20260920100000_public_player_ids.sql','20260920110000_public_id_allocation.sql','20260920111000_product_schema_registration.sql']) {
    await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'))
  }
  await loadPlatformHardening(db)
  game = (await one("select id from public.games where slug='mahjong-clash'")).id
  user = (await one('insert into auth.users(is_anonymous) values(true) returning id')).id
  member = (await one('select * from public.joy8_resolve_member($1,true)',[user])).player_account_id
})
after(async () => db?.close())

test('activation keeps catalog hidden, removes player allowlist and creates no funds or credentials', async () => {
  assert.deepEqual(await one('select published,launch_url from public.games where id=$1',[game]),{published:false,launch_url:null})
  assert.equal((await one("select to_regclass('public.joy8_private_players') table_name")).table_name,null)
  for (const table of ['wallet_accounts','wallet_transactions','game_sessions','joy8_backend_keys']) assert.equal(Number((await one(`select count(*) n from public.${table}`)).n),0)
  assert.equal((await one("select rolcanlogin from pg_roles where rolname='mahjong_clash_runtime'")).rolcanlogin,false)
  const policy = await one('select max_entry_amount,max_participants from public.joy8_game_policies where game_id=$1',[game])
  assert.equal(Number(policy.max_entry_amount),1)
  assert.equal(policy.max_participants,4)
})
test('public launch still rejects a hidden game', () => isolated(async () => {
  await denied(()=>one("select * from public.create_game_session('mahjong-clash','POINT',3600,null,$1)",[user]),/game is not available/)
  assert.equal(Number((await one('select count(*) n from public.wallet_accounts')).n),0)
}))
test('guest gets same identity and zero wallet on repeated test entry without approval', () => isolated(async () => {
  await db.exec('set role service_role')
  const a=(await launch()).result, b=(await launch()).result
  await db.exec('reset role')
  assert.equal(a.player_account_ref,member)
  assert.equal(b.player_account_ref,member)
  assert.notEqual(a.launch_code,b.launch_code)
  assert.equal(a.wallet_account_id,undefined)
  assert.equal(a.launch_url,'http://localhost:4391/')
  assert.equal(Number((await one('select count(*) n from public.wallet_accounts')).n),1)
  assert.equal(Number((await one('select balance from public.wallet_accounts')).balance),0)
  assert.equal(Number((await one('select count(*) n from public.wallet_transactions')).n),0)
}))
test('wrong origin, unknown game, disabled entry and published game are rejected', () => isolated(async () => {
  for (const origin of [null,'https://joy8.pages.dev','http://localhost:5174','http://127.0.0.1:5173']) await denied(()=>launch(user,origin),/JOY8_PRIVATE_ENTRY_DENIED/)
  await denied(()=>launch(user,'http://localhost:5173','missing-game'),/JOY8_PRIVATE_ENTRY_DENIED/)
  await db.query('update public.games set published=true where id=$1',[game])
  await denied(()=>launch(),/JOY8_PRIVATE_ENTRY_DENIED/)
  await db.query('update public.games set published=false where id=$1',[game])
  await db.exec('update public.joy8_private_entries set enabled=false')
  await denied(()=>launch(),/JOY8_PRIVATE_ENTRY_DENIED/)
  assert.equal(Number((await one('select count(*) n from public.wallet_accounts')).n),0)
}))
test('any enrolled guest or registered member can enter with their own identity and wallet', () => isolated(async () => {
  const first=(await launch()).result
  for (const anonymous of [true,false]) {
    const other=(await one('insert into auth.users(is_anonymous,email_confirmed_at) values($1,case when $1 then null else now() end) returning id',[anonymous])).id
    const otherMember=(await one('select * from public.joy8_resolve_member($1,true)',[other])).player_account_id
    const session=(await launch(other)).result
    assert.equal(session.player_account_ref,otherMember)
    assert.notEqual(session.player_account_ref,first.player_account_ref)
    assert.equal(session.account_type,anonymous?'guest':'registered')
  }
  assert.equal(Number((await one('select count(*) n from public.wallet_accounts')).n),3)
  assert.equal(Number((await one('select sum(balance) balance from public.wallet_accounts')).balance),0)
}))
test('missing identity and missing enrollment cannot create a wallet or session', () => isolated(async () => {
  await denied(()=>launch(null),/verified member identity is required/)
  const other=(await one('insert into auth.users(is_anonymous) values(true) returning id')).id
  await denied(()=>launch(other),/player membership is required/)
  for (const table of ['wallet_accounts','game_sessions']) assert.equal(Number((await one(`select count(*) n from public.${table}`)).n),0)
}))
test('suspended player or disabled wallet cannot launch', () => isolated(async () => {
  await db.query("update public.player_accounts set status='suspended' where id=$1",[member])
  await denied(()=>launch(),/player account is not active/)
  await db.query("update public.player_accounts set status='active' where id=$1",[member])
  await db.exec('update public.joy8_wallet_policies set enabled=false')
  await denied(()=>launch(),/JOY8_GAME_NOT_READY/)
}))
test('browser and game roles cannot read entry configuration or issue sessions', () => isolated(async () => {
  for (const role of ['anon','authenticated','mahjong_clash_server','mahjong_clash_runtime']) {
    await db.exec(`set role ${role}`)
    await denied(()=>one('select * from public.joy8_private_entries'),/permission denied/)
    await denied(()=>launch(),/permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  await denied(()=>one("select * from public.joy8_issue_game_session('mahjong-clash','POINT',3600,null,$1)",[user]),/permission denied/)
}))
test('identity-only backend exchanges once, sees zero balance and cannot open a match', () => isolated(async () => {
  const key='b'.repeat(64)
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','renew'],now()+interval '1 day')",[game,key])
  const session=(await launch()).result
  const request={version:1,launch_code:session.launch_code}
  const result=(await one("select public.joy8_server_session_v1($1,'exchange',$2::jsonb) result",[key,JSON.stringify(request)])).result
  assert.equal(result.player_account_ref,member)
  assert.equal(Number((await one('select * from public.wallet_get_balance($1)',[result.gateway_token])).balance),0)
  await denied(()=>one("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)",[key,JSON.stringify(request)]),/JOY8_SESSION_INVALID/)
  await denied(()=>one("select public.joy8_backend_game($1,'open')",[key]),/JOY8_BACKEND_UNAUTHORIZED/)
}))
test('published game keeps the public launch contract', () => isolated(async () => {
  const publicGame=(await one("select id from public.games where slug='test-game'")).id
  const policy=(await one('insert into public.joy8_wallet_policies(game_id,enabled) values($1,true) returning id',[publicGame])).id
  await db.query('insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount) values($1,$2,true,1000)',[publicGame,policy])
  const result=await one("select * from public.create_game_session('test-game','POINT',3600,null,$1)",[user])
  assert.equal(result.player_account_id,member)
  assert.equal(result.protocol,'server-v1')
}))

test('credential provisioning is repeatable, restricted, expiring and cannot rotate another key', async () => {
  const backendKey=randomBytes(32).toString('hex'),password=randomBytes(32).toString('hex')
  const input={gameId:game,dbHost:'db.lsazydefvnuqglultqii.supabase.co',backendKey,password,expiresAt:new Date(Date.now()+7*86400000).toISOString()}
  const bundle=credentialBundle(input)
  await db.exec(bundle.sql)
  await db.exec(bundle.sql)
  assert.deepEqual((await one('select scopes from public.joy8_backend_keys')).scopes,['exchange','renew'])
  assert.equal(Number((await one('select count(*) n from public.joy8_backend_keys')).n),1)
  assert.equal((await one("select rolcanlogin from pg_roles where rolname='mahjong_clash_runtime'")).rolcanlogin,true)
  assert.equal((await one("select has_table_privilege('mahjong_clash_runtime','public.wallet_accounts','SELECT') allowed")).allowed,false)
  if (db.connect) {
    const admin=await db.connect()
    const options=admin.connectionParameters
    const runtime=new pg.Client({host:options.host,port:options.port,database:options.database,user:'mahjong_clash_runtime',password})
    try {
      await runtime.connect()
      await runtime.query('set role mahjong_clash_server')
      assert.equal((await runtime.query('select mahjong_clash.runtime_readiness() result')).rows[0].result.game_enabled,true)
      await assert.rejects(runtime.query('select * from public.wallet_accounts'),/permission denied/)
    } finally { await runtime.end();await admin.end() }
  }
  await assert.rejects(db.exec(credentialBundle({...input,backendKey:randomBytes(32).toString('hex')}).sql),/MAHJONG_CREDENTIAL_PREREQUISITES_FAILED/)
  await db.exec('rollback')
  for(const table of ['wallet_accounts','wallet_transactions','game_sessions']) assert.equal(Number((await one(`select count(*) n from public.${table}`)).n),0)
  assert.throws(()=>credentialBundle({...input,dbHost:'other-project.supabase.co'}),/Invalid restricted configuration/)
})
