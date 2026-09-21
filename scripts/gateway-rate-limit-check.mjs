import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { setTimeout } from "node:timers/promises"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const original = { fetch: globalThis.fetch, deno: globalThis.Deno, log: console.log }
const identities = new Map()
let handler, authCalls = 0, settlementCalls = 0, unavailable = false, subjectUnavailable = false, subjectOverride, game
const secret = "a".repeat(64), rotated = "b".repeat(64), otherSecret = "c".repeat(64)
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const admit = (route, request = {}, key = secret, auth = null, client = db) => client.query("select public.joy8_admit_gateway_request($1,$2::jsonb,$3,$4) result", [route, JSON.stringify(request), key, auth]).then(result => result.rows[0].result)

before(async () => {
  for (const source of (await buildPlatformBundle()).sources) await db.exec(source.sql)
  game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("update public.joy8_wallet_policies set enabled=true,initial_credit=1000 returning id")).id
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount) values($1,$2,true,1000,1000)", [game, policy])
  for (const key of [secret, rotated]) await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','renew','open','settle','status','cancel'],now()+interval '1 day')", [game,key])
  const otherGame = (await one("select id from public.games where slug='hidden-game'")).id
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.joy8_hash_secret($2),array['exchange','renew','open','settle','status','cancel'],now()+interval '1 day')", [otherGame,otherSecret])
  for (let index = 0; index < 31; index++) {
    const { rows } = await db.query("insert into auth.users(is_anonymous) values(true) returning id")
    identities.set(`test-member-${index}`, rows[0].id)
  }
  globalThis.Deno = {
    env: { get: name => ({ SUPABASE_URL: "https://supabase.example", SUPABASE_SERVICE_ROLE_KEY: "test-service", SUPABASE_ANON_KEY: "test-anon" })[name] },
    serve: callback => { handler = callback },
  }
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      authCalls++
      const id = identities.get(options.headers.Authorization.replace(/^Bearer /, ""))
      return id ? Response.json({ id }) : Response.json({}, { status: 401 })
    }
    const name = url.split("/").at(-1)
    const args = JSON.parse(options.body)
    if (name === "joy8_consume_gateway_rate_limit") {
      if (unavailable) return Response.json({}, { status: 503 })
      const { rows } = await db.query("select public.joy8_consume_gateway_rate_limit($1,$2,$3) allowed", [args.p_key, args.p_limit, args.p_window_seconds])
      return Response.json(rows[0].allowed)
    }
    if (name === "joy8_admit_gateway_request") {
      if (subjectUnavailable) return Response.json({}, { status: 503 })
      if (subjectOverride !== undefined) return Response.json(subjectOverride)
      return Response.json(await admit(args.p_route,args.p_request,args.p_secret,args.p_auth_user_id))
    }
    if (name === "joy8_resolve_member_profile") {
      const { rows } = await db.query("select * from public.joy8_resolve_member_profile($1,$2)", [args.p_auth_user_id, args.p_enroll])
      return Response.json(rows)
    }
    if (name === "joy8_settle_match_v1") {
      settlementCalls++
      try {
        return Response.json((await one("select public.joy8_settle_match_v1($1,$2::jsonb) result", [args.p_secret,JSON.stringify(args.p_request)])).result)
      } catch (error) { return Response.json({ message: error.message, code: error.code }, { status: 400 }) }
    }
    throw new Error(`Unexpected upstream RPC ${name}`)
  }
  console.log = () => {}
  await import("../supabase/functions/joy8-gateway/index.ts")
})

after(async () => {
  globalThis.fetch = original.fetch
  if (original.deno === undefined) delete globalThis.Deno
  else globalThis.Deno = original.deno
  console.log = original.log
  await db.close()
})

const post = (route, address, token, body = {}) => handler(new Request(`https://gateway.example/${route}`, {
  method: "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": address, authorization: `Bearer ${token}`,
    ...(route.startsWith("server-") ? {} : { origin: "https://joy8.cc", apikey: "test-anon" }) },
  body: JSON.stringify(body),
}))

async function startWindow(seconds, minimum = 10) {
  const { rows } = await db.query("select extract(epoch from clock_timestamp())::double precision epoch")
  const remaining = seconds - rows[0].epoch % seconds
  if (remaining < minimum) await setTimeout(Math.ceil(remaining * 1000) + 50)
  return Math.floor(Number((await db.query("select extract(epoch from clock_timestamp())::double precision epoch")).rows[0].epoch) / seconds)
}

async function assertSameWindow(start, seconds) {
  const { rows } = await db.query("select extract(epoch from clock_timestamp())::double precision epoch")
  assert.equal(Math.floor(rows[0].epoch / seconds), start, "Diagnostic crossed a rate window; result cannot establish the configured ceiling")
}

async function freshSession() {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  await db.query("select * from public.joy8_resolve_member($1,true)", [auth])
  return one("select * from public.create_game_session('test-game','POINT',3600,null,$1)", [auth])
}

async function table(ref) {
  const session = await freshSession()
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [secret,JSON.stringify({version:1,launch_code:session.launch_code})])
  await db.query("select public.joy8_open_match_v1($1,$2::jsonb)", [secret,JSON.stringify({version:1,match_ref:ref,rule_version:"rules-1",participants:[{session_id:session.session_id,reserve:"1000.00"}]})])
  return {version:1,match_ref:ref,rule_version:"rules-1",operation_key:ref+":1",settlement_no:1,final:true,entries:[]}
}

async function clearLimits() { await db.exec("truncate public.gateway_rate_limits") }

async function fillBucket(key, limit, seconds) {
  await db.query("select public.joy8_consume_gateway_rate_limit($1,$2,$3)", [key,limit,seconds])
  await db.query("update public.gateway_rate_limits set request_count=$2 where bucket_key_hash=public.joy8_hash_secret($1)", [key,limit])
}

test("31 players sharing an IP have independent enrollment budgets; changing IP cannot reset one player's budget", async () => {
  const window = await startWindow(300)
  for (const token of identities.keys()) assert.equal((await post("enroll-member", "192.0.2.10", token)).status, 200)
  for (let n=1; n<30; n++) assert.equal((await post("enroll-member", "192.0.2.10", "test-member-0")).status, 200)
  const denied = await post("enroll-member", "192.0.2.11", "test-member-0")
  assert.equal(denied.status, 429)
  assert.equal(denied.headers.get("retry-after"), "300")
  assert.equal((await post("enroll-member", "192.0.2.10", "test-member-1")).status, 200)
  assert.equal((await one("select count(*)::int n from public.player_accounts")).n,31)
  assert.equal((await one("select count(*)::int n from public.wallet_accounts")).n,0)
  await assertSameWindow(window,300)
})

test("100 tables on one backend/IP each admit 30 real idempotent settlements without sharing a table budget", async () => {
  const bodies = []
  for (let n=0;n<100;n++) bodies.push(await table(`table-${n}`))
  await clearLimits()
  const window = await startWindow(60,45)
  const beforeCalls = settlementCalls
  for (let round=0;round<30;round++) {
    for (const body of bodies) {
      const result = await post("server-settle-v1","192.0.2.20",secret,body)
      assert.equal(result.status,200,JSON.stringify(await result.json()))
    }
  }
  await assertSameWindow(window,60)
  assert.equal(settlementCalls-beforeCalls,3000)
  assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n,100)
  assert.equal((await one("select count(*)::int n from public.wallet_accounts where balance<>1000 or locked_balance<>0")).n,0)
  const denied = await post("server-settle-v1","192.0.2.21",rotated,{...bodies[0],operation_key:"different-operation"})
  assert.equal(denied.status,429)
  assert.equal(denied.headers.get("retry-after"),"60")
  assert.equal(settlementCalls-beforeCalls,3000)
  const extra = await table("independent-table")
  assert.equal((await post("server-settle-v1","192.0.2.20",secret,extra)).status,200)
})

test("unverified, revoked, wrong-product and invented subjects cannot acquire a valid table's budget", async () => {
  await clearLimits()
  const request = {version:1,match_ref:"table-0"}
  assert.equal((await admit("server-settle-v1",request,"d".repeat(64))).error,"JOY8_BACKEND_UNAUTHORIZED")
  assert.equal((await admit("server-settle-v1",request,otherSecret)).error,"JOY8_MATCH_NOT_FOUND")
  assert.equal((await admit("server-settle-v1",{...request,match_ref:"invented"})).error,"JOY8_MATCH_NOT_FOUND")
  await db.query("update public.joy8_backend_keys set revoked_at=now() where key_hash=public.joy8_hash_secret($1)",[rotated])
  assert.equal((await admit("server-settle-v1",request,rotated)).error,"JOY8_BACKEND_UNAUTHORIZED")
  await db.query("update public.joy8_backend_keys set revoked_at=null where key_hash=public.joy8_hash_secret($1)",[rotated])
  assert.equal((await admit("server-settle-v1",request)).allowed,true)
  const id = (await one("select id from public.joy8_matches where match_ref='table-0'")).id
  assert.equal((await one("select sum(request_count)::int n from public.gateway_rate_limits where bucket_key_hash=public.joy8_hash_secret($1)",[`match:${id}:settle`])).n,1)
  for (const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`)
    try { await assert.rejects(admit("member",{},null,identities.get("test-member-0")),/permission denied/) }
    finally { await db.exec("reset role") }
  }
  await db.exec("set role service_role")
  try { assert.equal((await admit("server-status-v1",request)).allowed,true) }
  finally { await db.exec("reset role") }
  assert.equal((await one("select to_regclass('public.game_sessions_game_launch_code_idx') is not null present")).present,true)
})

test("exchange and renewal share one verified Session budget across key rotation; other Sessions are independent", async () => {
  await clearLimits()
  const first=await freshSession(), second=await freshSession()
  const window=await startWindow(60)
  for(let n=0;n<29;n++) assert.equal((await admit("server-exchange-v1",{version:1,launch_code:first.launch_code})).allowed,true)
  const exchanged=(await one("select public.joy8_server_session_v1($1,'exchange',$2::jsonb) result",[secret,JSON.stringify({version:1,launch_code:first.launch_code})])).result
  assert.equal((await admit("server-renew-v1",{version:1,session_id:first.session_id},rotated)).allowed,true)
  assert.equal((await admit("server-renew-v1",{version:1,session_id:first.session_id})).allowed,false)
  assert.equal((await admit("server-exchange-v1",{version:1,launch_code:second.launch_code})).allowed,true)
  assert.equal((await admit("server-exchange-v1",{version:1,launch_code:second.launch_code},otherSecret)).error,"JOY8_SESSION_INVALID")
  for(let n=0;n<120;n++) assert.equal((await admit("balance",{gateway_token:exchanged.gateway_token},null)).allowed,true)
  const renewed=(await one("select public.joy8_server_session_v1($1,'renew',$2::jsonb) result",[secret,JSON.stringify({version:1,session_id:first.session_id})])).result
  assert.equal((await admit("balance",{gateway_token:renewed.gateway_token},null)).allowed,false)
  await assertSameWindow(window,60)
})

test("backend identity budgets survive key rotation and reject excessive traffic without limiting another product", async () => {
  await clearLimits()
  const window=await startWindow(60)
  await fillBucket(`backend:${game}`,6000,60)
  assert.equal((await admit("server-open-v1",{version:1},rotated)).allowed,false)
  assert.equal((await admit("server-open-v1",{version:1},otherSecret)).allowed,true)
  await assertSameWindow(window,60)
})

test("IP only supplies the coarse shared ingress cap, and both rate stores fail closed", async () => {
  await clearLimits()
  const window=await startWindow(60)
  await fillBucket("ingress:192.0.2.30",10000,60)
  assert.equal((await post("enroll-member","192.0.2.30","test-member-0")).status,429)
  assert.equal((await post("enroll-member","192.0.2.31","test-member-0")).status,200)
  for(const mode of ["ingress","subject"]) {
    const previousAuth=authCalls, previousSettlements=settlementCalls
    unavailable=mode==="ingress"; subjectUnavailable=mode==="subject"
    try {
      assert.equal((await post("enroll-member","192.0.2.31","test-member-0")).status,503)
      assert.equal((await post("server-settle-v1","192.0.2.31",secret,{version:1,match_ref:"table-0"})).status,503)
      assert.equal(authCalls,previousAuth+(mode==="subject"?1:0))
      assert.equal(settlementCalls,previousSettlements)
    } finally { unavailable=false; subjectUnavailable=false }
  }
  await assertSameWindow(window,60)
})

test("competing PostgreSQL connections cannot exceed a single table's 30-request allowance", {skip:!db.connect}, async () => {
  await clearLimits()
  const clients=await Promise.all(Array.from({length:8},()=>db.connect()))
  const window=await startWindow(60)
  try {
    const results=(await Promise.all(clients.map(async client => {
      const responses=[]
      for(let n=0;n<6;n++) responses.push(await admit("server-settle-v1",{version:1,match_ref:"table-0"},secret,null,client))
      return responses
    }))).flat()
    assert.equal(results.filter(result=>result.allowed).length,30)
    assert.equal(results.filter(result=>result.allowed===false).length,18)
    await assertSameWindow(window,60)
  } finally { await Promise.all(clients.map(client=>client.end())) }
})

test("failed settlement RPCs consume the verified table budget without creating ledger records", async () => {
  await clearLimits()
  const window=await startWindow(60)
  const beforeCount=(await one("select count(*)::int n from public.joy8_settlements")).n
  for(let n=0;n<30;n++) assert.equal((await post("server-settle-v1","192.0.2.60",secret,{version:1,match_ref:"table-0"})).status,400)
  assert.equal((await post("server-settle-v1","192.0.2.60",secret,{version:1,match_ref:"table-0"})).status,429)
  assert.equal((await one("select count(*)::int n from public.joy8_settlements")).n,beforeCount)
  await assertSameWindow(window,60)
})

test("malformed admission replies fail closed before accounting and disclose no unknown error", async () => {
  await clearLimits()
  const beforeCalls=settlementCalls
  try {
    for(const value of [null,{},[],{allowed:"true"},{allowed:false,retry_after:0},{allowed:true,error:"private database detail"},{error:"toString"}]) {
      subjectOverride=value
      const response=await post("server-settle-v1","192.0.2.50",secret,{version:1,match_ref:"table-0"})
      assert.equal(response.status,503)
      assert.deepEqual(await response.json(),{error:"Gateway rate limit is unavailable"})
    }
    assert.equal(settlementCalls,beforeCalls)
  } finally { subjectOverride=undefined }
})
