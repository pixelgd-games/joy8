import assert from "node:assert/strict"
import { randomUUID, randomBytes } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { restoreSnapshot } from "./restore-snapshot.mjs"

const directory = process.argv[2]
assert.ok(directory, "Supply an ignored hosted snapshot directory; this check only connects to its local restore")
const report = { environment: "isolated local PostgreSQL 17 restored from hosted snapshot", scenarios: [] }
const key = randomBytes(32).toString("hex")
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]

await restoreSnapshot(directory, async db => {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const game = (await one("select id from public.games where slug='mahjong-clash'")).id
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','renew','open','settle','status','cancel'])", [game, key])
  const samples = []
  for (let i = 0; i < 25; i++) {
    const auth = randomUUID(), email = `${auth}@example.test`
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,is_anonymous) values($1,$2,now(),'{\"provider\":\"google\",\"providers\":[\"google\"]}',false)", [auth, email])
    await db.query("insert into auth.identities(provider_id,user_id,provider,identity_data) values($1::text,$1::uuid,'google',$2)", [auth, JSON.stringify({ sub: auth, email, email_verified: true })])
    await db.query("insert into public.joy8_email_allowlist(email) values($1)", [email])
    const member = await one("select * from public.joy8_resolve_member($1,true)", [auth])
    const session = await one("select * from public.create_game_session('mahjong-clash',$1)", [auth])
    await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [key, JSON.stringify({ version: 1, launch_code: session.launch_code })])
    await db.query("select mahjong_clash.bind_runtime_identity($1,$2)", [session.session_id, member.player_account_id])
    const wallet = await one("select id,balance from public.wallet_accounts where player_account_id=$1", [member.player_account_id])
    const seats = [{ kind: "human", player: member.player_account_id, session: session.session_id, wallet: wallet.id, points: Number(wallet.balance) }]
    for (let j = 0; j < 3; j++) {
      const ai = randomUUID()
      const funded = (await one("select mahjong_clash.fund_runtime_ai($1,$2,$3) result", [ai, `Capacity ${i}-${j}`, `capacity-fund:${ai}`])).result
      seats.push({ kind: "ai", ai, points: Number(funded.balance) })
    }
    samples.push({ seats, owner: randomUUID(), client: await db.connect() })
  }
  const total = "select ((select coalesce(sum(balance),0) from public.wallet_accounts)+(select coalesce(sum(balance),0) from mahjong_clash.ai_accounts)+(select coalesce(sum(balance),0) from public.joy8_fee_accounts))::text value"
  const before = (await one(total)).value
  const stages = ["prepare", "open", "hand", "result", "settle", "retry"]
  for (const concurrency of [1, 5, 25]) {
    const durations = Object.fromEntries(stages.map(stage => [stage, []]))
    let lockSamples = 0, maxLockWaiters = 0, stop = false
    const monitor = await db.connect()
    const observing = (async () => {
      while (!stop) {
        const count = (await monitor.query("select count(*)::int n from pg_stat_activity where datname=current_database() and application_name='joy8-capacity' and wait_event_type='Lock'")).rows[0].n
        if (count) lockSamples++
        maxLockWaiters = Math.max(maxLockWaiters, count)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })()
    const started = performance.now()
    try {
      await Promise.all(samples.slice(0, concurrency).map(async sample => {
        const { client } = sample
        await client.query("set application_name='joy8-capacity'")
        const measured = async (stage, sql, args) => {
          const start = performance.now()
          const result = (await client.query(sql, args)).rows[0].result
          durations[stage].push(performance.now() - start)
          return result
        }
        for (let iteration = 0; iteration < 4; iteration++) {
          for (const seat of sample.seats) {
            const sql = seat.kind === "human" ? "select balance from public.wallet_accounts where id=$1" : "select balance from mahjong_clash.ai_accounts where id=$1"
            seat.points = Number((await client.query(sql, [seat.wallet || seat.ai])).rows[0].balance)
          }
          const match = randomUUID()
          const prepared = await measured("prepare", "select mahjong_clash.prepare_match($1,$2,$3) result", [match, sample.owner, JSON.stringify({ format: "hand", stake: "low", seats: sample.seats })])
          const opened = await measured("open", "select public.joy8_open_match_v1($1,$2) result", [key, JSON.stringify(prepared.request)])
          assert.equal(opened.state, "open")
          const lease = [match, sample.owner, prepared.lease.fence, prepared.lease.revision]
          await measured("hand", "select mahjong_clash.open_hand($1,$2,$3,$4,1,0,0,0) result", lease)
          let result = { type: "draw", endReason: "format-complete", settlement: { gain: 0, fee: 0, deltas: [0, 0, 0, 0], payments: [] } }
          if (iteration < 3) {
            const winnerIndex = iteration % 2
            const normalized = { type: "win", winnerIndex, payments: [0, 1, 2, 3].filter(i => i !== winnerIndex).map(payerIndex => ({ payerIndex, requiredAmount: 100 })) }
            const answer = (await client.query("select mahjong_clash.calculate_hand_economy($1,$2,$3,(select version from mahjong_clash.economy_state where singleton)) result", [JSON.stringify(sample.seats.map(seat => seat.points)), JSON.stringify(["human", "ai", "ai", "ai"]), JSON.stringify(normalized)])).rows[0].result
            result = { type: "win", winnerIndex, selfDraw: true, endReason: "format-complete", settlement: { gain: answer.grossWin, fee: answer.winnerFee, deltas: answer.deltas, payments: answer.payments } }
          }
          const pending = await measured("result", "select mahjong_clash.prepare_result($1,$2,$3,$4,1,$5) result", [...lease, JSON.stringify(result)])
          assert.equal(pending.action, "settle")
          const settled = await measured("settle", "select public.joy8_settle_match_v1($1,$2) result", [key, JSON.stringify(pending.request)])
          assert.equal(settled.state, "settled")
          assert.equal(settled.settlement_no, 1)
          const retried = await measured("retry", "select public.joy8_settle_match_v1($1,$2) result", [key, JSON.stringify(pending.request)])
          assert.deepEqual(retried, settled)
        }
      }))
    } finally {
      stop = true
      await observing
      await monitor.end()
    }
    const elapsedMs = performance.now() - started
    report.scenarios.push({ concurrency, hands: concurrency * 4, wins: concurrency * 3, draws: concurrency, elapsedMs: Math.round(elapsedMs), handsPerSecond: Number((concurrency * 4000 / elapsedMs).toFixed(2)), lockSamples, maxLockWaiters,
      stages: Object.fromEntries(stages.map(stage => [stage, { count: durations[stage].length, p50Ms: Number(percentile(durations[stage], .5).toFixed(2)), p95Ms: Number(percentile(durations[stage], .95).toFixed(2)), maxMs: Number(Math.max(...durations[stage]).toFixed(2)) }])) })
    console.log(`Capacity scenario: ${concurrency} concurrent tables, ${concurrency * 3} wins and ${concurrency} draws, no rejected requests.`)
  }
  assert.equal((await one(total)).value, before, "Human, AI and fee balances must conserve total points")
  const result = await db.exec(await readFile("scripts/sql/platform-reconciliation.sql", "utf8"))
  const reconciliation = result.flatMap(row => row.rows || []).find(row => row.reconciliation).reconciliation
  for (const name of ["wallet_ledger_mismatches", "reservation_mismatches", "fee_mismatches", "unbalanced_settlements", "finalized_with_reservations"]) assert.equal(reconciliation[name], 0, name)
  report.reconciliation = reconciliation
  report.completed = true
})
await writeFile(path.join(path.resolve(directory), "capacity-result.json"), JSON.stringify(report, null, 2), { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
