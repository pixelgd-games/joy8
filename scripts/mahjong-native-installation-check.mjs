import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createLocalPostgres } from './fixtures/local-postgres.mjs'

const root = process.env.MAHJONG_REVIEW_ROOT
assert.ok(root && path.isAbsolute(root))
const db = await createLocalPostgres()
try {
  const sources = JSON.parse(await readFile(path.join(root,'server/fixtures/looty-platform.json'),'utf8'))
  for (const source of sources) await db.exec(source.sql)
  await db.exec(`create role looty_migrator nologin createrole;
    grant create on database postgres to looty_migrator;
    grant usage on schema public,auth,extensions to looty_migrator;
    grant select,references on all tables in schema public,auth to looty_migrator;
    alter table public.games owner to looty_migrator;
    alter table public.looty_wallet_policies owner to looty_migrator;
    alter function public.looty_product_adapter(regprocedure,text,uuid,jsonb) owner to looty_migrator;
    set role looty_migrator`)
  for (const name of ['state','economy','accounting','lifecycle','runtime']) {
    await db.exec(await readFile(path.join(root,`server/sql/product-${name}.sql`),'utf8'))
  }
  await db.exec(await readFile('supabase/migrations/20260918010700_mahjong_registration.sql','utf8'))
  for (const role of ['mahjong_clash_accounting_owner','mahjong_clash_lifecycle_owner']) {
    const value = (await db.query("select has_schema_privilege($1,'mahjong_clash','CREATE') writable,pg_has_role(current_user,$1,'SET') settable,pg_has_role(current_user,$1,'USAGE') inherited",[role])).rows[0]
    assert.deepEqual(value,{writable:false,settable:false,inherited:false})
  }
  assert.equal((await db.query("select has_function_privilege(current_user,'mahjong_clash.platform_accounting(text,uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,true)
  assert.equal((await db.query("select has_function_privilege('mahjong_clash_server','mahjong_clash.platform_accounting(text,uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,false)
  await assert.rejects(db.query("select public.looty_product_adapter('mahjong_clash.platform_accounting(text,uuid,jsonb)'::regprocedure,'invalid',null,'{}')"),/MAHJONG_ADAPTER_REQUEST/)
  assert.equal((await db.query('select count(*)::int n from public.wallet_accounts')).rows[0].n,0)
  assert.equal((await db.query("select published from public.games where slug='mahjong-clash'")).rows[0].published,false)
  console.log('PostgreSQL 17 non-superuser installation passed; temporary owner privileges removed, platform callback permitted, runtime callback denied, no wallets funded.')
} finally { await db.close() }
