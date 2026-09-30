import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { createMemberState } from "../src/member/state.js"
import { createMemberService } from "../src/member/service.js"
import { fetchWithTimeout } from "../src/lib/request.js"

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const session = id => ({ user: { id } })

test("identity changes clear data immediately and reject late previous-user responses", async () => {
  const a = deferred(), b = deferred(), shown = []
  let reads = 0, resets = 0
  const state = createMemberState({ readMember: () => (++reads === 1 ? a.promise : b.promise),
    onReset: () => { resets++; shown.length = 0 }, onMember: (user, member) => shown.push([user.id, member.public_id]), onPending() {} })
  const first = state.update(session("A"))
  await Promise.resolve()
  const second = state.update(session("B"))
  assert.equal(resets, 2)
  await Promise.resolve()
  b.resolve({ public_id: "222222" })
  await second
  a.resolve({ public_id: "111111" })
  await first
  assert.deepEqual(shown, [["B", "222222"]])
  await state.update(null)
  assert.equal(state.member, null)
  assert.deepEqual(shown, [])
})

test("same-user events share one pending lookup and do not refresh resolved UI", async () => {
  const response = deferred()
  let reads = 0, renders = 0
  const state = createMemberState({ readMember: () => { reads++; return response.promise },
    onReset() {}, onMember() { renders++ }, onPending() {} })
  const first = state.update(session("A"))
  const second = state.update(session("A"))
  response.resolve({ public_id: "111111" })
  await Promise.all([first, second])
  await state.update(session("A"))
  assert.equal(reads, 1)
  assert.equal(renders, 1)
  await state.update(session("A"), null, true)
  assert.equal(reads, 2)
})

test("explicit enrollment supersedes a pending pre-enrollment lookup", async () => {
  const response = deferred(), shown = []
  const state = createMemberState({ readMember: () => response.promise,
    onReset: () => shown.push(null), onMember: (_, member) => shown.push(member.public_id), onPending() {} })
  const pending = state.update(session("A"))
  await state.update(session("A"), { public_id: "111111" })
  response.resolve(null)
  await pending
  assert.equal(state.member.public_id, "111111")
  assert.equal(shown.at(-1), "111111")
})

test("membership coalesces only in-flight reads and separates identities", async () => {
  let user = "A", calls = 0
  const response = deferred()
  const client = { auth: { getSession: async () => ({ data: { session: session(user) } }) },
    functions: { invoke: () => { calls++; return response.promise } } }
  const service = createMemberService(client, { origin: "https://joy8.example" })
  const reads = [service.membership(), service.membership()]
  await setImmediate()
  assert.equal(calls, 1)
  user = "B"
  reads.push(service.membership())
  await setImmediate()
  response.resolve({ data: { member: { public_id: "111111" } } })
  await Promise.all(reads)
  assert.equal(calls, 2)
  await service.membership()
  assert.equal(calls, 3)
})

test("browser request deadline includes a stalled response body and preserves caller cancellation", async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) { signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }) },
    }))
    await assert.rejects(fetchWithTimeout("https://fixture.test", {}, 20), { name: "TimeoutError" })
    globalThis.fetch = async (_url, { signal }) => new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
    const controller = new AbortController()
    const pending = fetchWithTimeout("https://fixture.test", { signal: controller.signal }, 1000)
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    globalThis.fetch = async () => Response.json({ ok: true })
    assert.deepEqual(await (await fetchWithTimeout("https://fixture.test")).json(), { ok: true })
  } finally { globalThis.fetch = original }
})

test("late enrollment cannot complete after the Auth identity changes", async () => {
  let user = "A"
  const response = deferred()
  const client = { auth: { getSession: async () => ({ data: { session: session(user) } }) },
    functions: { invoke: () => response.promise } }
  const service = createMemberService(client, { origin: "https://joy8.example" })
  const enrollment = service.membership(true)
  await setImmediate()
  user = "B"
  response.resolve({ data: { member: { public_id: "111111" } } })
  await assert.rejects(enrollment, /identity changed/)
})
