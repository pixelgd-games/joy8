import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { setTimeout } from "node:timers/promises"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const original = { fetch: globalThis.fetch, deno: globalThis.Deno, log: console.log }
const identities = new Map()
let handler, authCalls = 0, settlementCalls = 0, unavailable = false

before(async () => {
  for (const source of (await buildPlatformBundle()).sources) await db.exec(source.sql)
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
    if (name === "joy8_resolve_member_profile") {
      const { rows } = await db.query("select * from public.joy8_resolve_member_profile($1,$2)", [args.p_auth_user_id, args.p_enroll])
      return Response.json(rows)
    }
    if (name === "joy8_settle_match_v1") {
      settlementCalls++
      return Response.json({ admitted: true })
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

async function startWindow(seconds) {
  const { rows } = await db.query("select extract(epoch from clock_timestamp())::double precision epoch")
  const remaining = seconds - rows[0].epoch % seconds
  if (remaining < 10) await setTimeout(Math.ceil(remaining * 1000) + 50)
  return Math.floor(Number((await db.query("select extract(epoch from clock_timestamp())::double precision epoch")).rows[0].epoch) / seconds)
}

async function assertSameWindow(start, seconds) {
  const { rows } = await db.query("select extract(epoch from clock_timestamp())::double precision epoch")
  assert.equal(Math.floor(rows[0].epoch / seconds), start, "Diagnostic crossed a rate window; result cannot establish the configured ceiling")
}

test("31 distinct valid identities on one address share the enrollment budget; a second address remains independent", async () => {
  const window = await startWindow(300)
  const responses = []
  for (const token of identities.keys()) responses.push(await post("enroll-member", "192.0.2.10", token))
  await assertSameWindow(window, 300)
  assert.deepEqual(responses.map(response => response.status), [...Array(30).fill(200), 429])
  assert.equal(responses.at(-1).headers.get("retry-after"), "300")
  assert.equal(authCalls, 30)
  assert.equal((await db.query("select count(*)::int n from public.player_accounts")).rows[0].n, 30)
  assert.equal((await post("enroll-member", "192.0.2.11", "test-member-30")).status, 200)
  assert.equal((await db.query("select count(*)::int n from public.player_accounts")).rows[0].n, 31)
  assert.equal((await db.query("select count(*)::int n from public.wallet_accounts")).rows[0].n, 0)
})

test("the 121st settlement request is rejected before the stubbed accounting upstream regardless of distinct match refs", async () => {
  const window = await startWindow(60)
  const responses = []
  for (let index = 0; index < 121; index++) responses.push(await post("server-settle-v1", "192.0.2.20", "a".repeat(64), { version: 1, match_ref: `test-match-${index}` }))
  await assertSameWindow(window, 60)
  assert.deepEqual(responses.map(response => response.status), [...Array(120).fill(200), 429])
  assert.equal(responses.at(-1).headers.get("retry-after"), "60")
  assert.equal(settlementCalls, 120)
  assert.equal((await post("server-settle-v1", "192.0.2.21", "a".repeat(64), { version: 1, match_ref: "independent" })).status, 200)
  assert.equal(settlementCalls, 121)
})

test("rate-limit storage failure prevents authentication, enrollment and accounting dispatch", async () => {
  const previousAuth = authCalls, previousSettlements = settlementCalls
  unavailable = true
  try {
    assert.equal((await post("enroll-member", "192.0.2.30", "test-member-0")).status, 503)
    assert.equal((await post("server-settle-v1", "192.0.2.30", "a".repeat(64))).status, 503)
    assert.equal(authCalls, previousAuth)
    assert.equal(settlementCalls, previousSettlements)
  } finally { unavailable = false }
})
