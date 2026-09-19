import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import pg from 'pg'

let client
let stage='configuration'
try {
  const gameRoot=process.env.MAHJONG_REVIEW_ROOT
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw new Error('Reviewed game root required')
  const { runtimeConfig, restrictRuntime }=await import(pathToFileURL(path.join(gameRoot,'server/postgres-state-store.mjs')))
  const env=parseEnv(await readFile(path.join(gameRoot,'.env.joy8.local'),'utf8'))
  const config=runtimeConfig(env)
  if (env.MAHJONG_DB_CA_FILE) config.ssl.ca=await readFile(env.MAHJONG_DB_CA_FILE,'utf8')
  client=new pg.Client(config)
  client.on('error',()=>{})
  stage='TLS connection'
  await client.connect()
  stage='role restrictions'
  await restrictRuntime(client)
  stage='readiness'
  await client.query('begin read only')
  const state=(await client.query('select mahjong_clash.runtime_readiness() result')).rows[0]?.result
  if (!state || state.game_id!==env.MAHJONG_JOY8_GAME_ID || state.environment!=='operational'
    || !state.continuous || !state.wallet_enabled || !state.game_enabled || Number(state.initial_credit)!==0
    || state.adapter!=='mahjong_clash.platform_accounting(text,uuid,jsonb)') throw new Error('Incomplete activation')
  await client.query('rollback')
  console.log('Restricted Mahjong TLS connection and zero-credit readiness passed. No sessions, wallets, gameplay or AI funding were created.')
} catch (error) {
  const code=/^[A-Z0-9_]{1,50}$/.test(error?.code || '') ? error.code : 'CHECK_FAILED'
  console.error(`Restricted connection check stopped at ${stage} (${code}). No credential values are displayed.`)
  process.exitCode=1
} finally { await client?.end().catch(()=>{}) }
