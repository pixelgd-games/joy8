import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const gameRoot = process.env.MAHJONG_REVIEW_ROOT
assert.ok(gameRoot && path.isAbsolute(gameRoot), 'Set MAHJONG_REVIEW_ROOT to the reviewed Mahjong repository')
const db = new PGlite({ extensions: { pgcrypto } })
try {
  const sources = JSON.parse(await readFile(path.join(gameRoot, 'server/fixtures/joy8-platform.json'), 'utf8'))
  for (const source of sources) {
    const sql = await readFile(source.path, 'utf8')
    assert.equal(createHash('sha256').update(sql).digest('hex'), source.sha256, source.path)
    await db.exec(sql)
  }
  for (const name of ['product-state', 'product-economy', 'product-accounting', 'product-lifecycle', 'product-runtime']) {
    await db.exec(await readFile(path.join(gameRoot, `server/sql/${name}.sql`), 'utf8'))
  }
  await db.exec(await readFile('supabase/migrations/20260918010700_mahjong_registration.sql', 'utf8'))
  const one = async sql => (await db.query(sql)).rows[0]
  assert.deepEqual(await one("select published,launch_url from public.games where slug='mahjong-clash'"), { published: false, launch_url: null })
  const wallet = await one("select p.enabled,p.initial_credit from public.joy8_wallet_policies p join public.joy8_game_policies gp on gp.wallet_policy_id=p.id join public.games g on g.id=gp.game_id where g.slug='mahjong-clash'")
  assert.equal(wallet.enabled, false)
  assert.equal(Number(wallet.initial_credit), 0)
  assert.deepEqual(await one("select rolcanlogin,rolsuper,rolbypassrls,rolinherit from pg_roles where rolname='mahjong_clash_runtime'"), { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolinherit: false })
  for (const table of ['public.wallet_accounts', 'public.joy8_backend_keys', 'mahjong_clash.ai_accounts', 'mahjong_clash.matches']) assert.equal(Number((await one(`select count(*) n from ${table}`)).n), 0)
  assert.equal((await one('select environment from mahjong_clash.economy_state')).environment, 'operational')
  for (const role of ['anon', 'authenticated', 'service_role', 'mahjong_clash_server']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(db.query('select * from public.joy8_backend_keys'), /permission denied/)
      if (role !== 'mahjong_clash_server') await assert.rejects(db.query('select * from mahjong_clash.integration_pending'), /permission denied/)
      else {
        await assert.rejects(db.query('update mahjong_clash.ai_accounts set balance=10000'), /permission denied/)
        await assert.rejects(db.query("select mahjong_clash.platform_accounting('open',null,'{}')"), /permission denied/)
      }
    } finally { await db.exec('reset role') }
  }
  await assert.rejects(db.exec(await readFile('supabase/migrations/20260918010700_mahjong_registration.sql', 'utf8')), /MAHJONG_REGISTRATION_REQUIRES_UNCONFIGURED_PRODUCT/)
  await db.exec('rollback')
  console.log('Mahjong installation review passed: current SQL sequence, hidden catalog, disabled zero-credit policy, restricted non-login role and no provisioned funds or keys.')
} finally { await db.close() }
