import assert from "node:assert/strict"
import test from "node:test"
import { mountGameFrame } from "../src/pages/game/iframe.js"
import { createBrandedEntryRequests } from "../src/member/branded-entry.js"

function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const prior = Object.fromEntries(["window", "document", "location"].map(key => [key, globalThis[key]]))
  const listeners = new Map()
  const messages = []
  const failures = []
  let loads = 0
  let frameLoad
  const frame = {
    contentWindow: { postMessage: (...args) => messages.push(args) },
    setAttribute() {},
    addEventListener: (_, fn) => { frameLoad = fn },
    remove() { this.removed = true },
  }
  globalThis.location = { origin: "https://joy8.cc" }
  globalThis.document = { createElement: () => frame }
  globalThis.window = {
    setTimeout, clearTimeout,
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: event => listeners.delete(event),
  }
  t.after(() => Object.assign(globalThis, prior))
  const controller = mountGameFrame({
    gameRoot: { append() {} }, gameUrl: "https://game.example/", timeoutMs: 30000,
    launch: { joy8_launch_code: "test-only-code" },
    onLoad: () => loads++, onTimeout: reason => failures.push(reason), ...options,
  })
  const ready = (overrides = {}) => listeners.get("message")?.({
    source: frame.contentWindow, origin: "https://game.example",
    data: { type: "joy8-launch-ready-v1", protocol: "server-v1" }, ...overrides,
  })
  return { controller, frame, messages, failures, listeners, ready, load: () => frameLoad(), loads: () => loads }
}

for (const loaded of [false, true]) test(`missing handshake fails visibly with document loaded=${loaded}`, t => {
  const f = fixture(t)
  if (loaded) f.load()
  assert.equal(f.loads(), 0)
  t.mock.timers.tick(30000)
  assert.deepEqual(f.failures, [loaded ? "handshake" : "load"])
  assert.equal(f.frame.removed, true)
  assert.equal(f.listeners.has("message"), false)
  f.ready()
  f.load()
  t.mock.timers.tick(30000)
  assert.equal(f.loads(), 0)
  assert.equal(f.messages.length, 0)
  assert.equal(f.failures.length, 1)
})

for (const readyFirst of [false, true]) test(`load and handshake complete once with readyFirst=${readyFirst}`, t => {
  const f = fixture(t)
  const first = readyFirst ? f.ready : f.load
  const second = readyFirst ? f.load : f.ready
  first()
  assert.equal(f.loads(), 0)
  second()
  f.ready()
  f.load()
  t.mock.timers.tick(30000)
  assert.equal(f.loads(), 1)
  assert.equal(f.messages.length, 1)
  assert.equal(f.messages[0][1], "https://game.example")
  assert.deepEqual(f.failures, [])
})

test("wrong window, origin and protocol cannot receive a credential or cancel timeout", t => {
  const f = fixture(t)
  f.load()
  f.ready({ source: {} })
  f.ready({ origin: "https://attacker.example" })
  f.ready({ origin: "null" })
  f.ready({ data: { type: "joy8-launch-ready-v1", protocol: "old" } })
  t.mock.timers.tick(30000)
  assert.equal(f.messages.length, 0)
  assert.deepEqual(f.failures, ["handshake"])
})

test("credential delivery does not cancel the document load deadline", t => {
  const f = fixture(t)
  f.ready()
  t.mock.timers.tick(10000)
  assert.deepEqual(f.failures, [])
  t.mock.timers.tick(20000)
  assert.deepEqual(f.failures, ["load"])
  assert.equal(f.loads(), 0)
})

test("slow document and client readiness share the full launch deadline", t => {
  const f = fixture(t)
  t.mock.timers.tick(20000)
  f.load()
  t.mock.timers.tick(9000)
  assert.deepEqual(f.failures, [])
  f.ready()
  assert.equal(f.loads(), 1)
  assert.equal(f.messages.length, 1)
  t.mock.timers.tick(30000)
  assert.deepEqual(f.failures, [])
})

test("late document load does not restart the handshake deadline", t => {
  const f = fixture(t)
  t.mock.timers.tick(29000)
  f.load()
  t.mock.timers.tick(1000)
  assert.deepEqual(f.failures, ["handshake"])
  assert.equal(f.frame.removed, true)
})

test("failed postMessage produces a terminal error without retaining the listener", t => {
  const f = fixture(t)
  f.frame.contentWindow.postMessage = () => { throw new Error("delivery failed") }
  f.ready()
  assert.deepEqual(f.failures, ["handshake"])
  assert.equal(f.listeners.has("message"), false)
  assert.equal(f.frame.removed, true)
})

test("opaque same-host frame accepts only its own null-origin readiness", t => {
  const f = fixture(t, { gameUrl: "/local-game/" })
  f.ready({ origin: "https://joy8.cc" })
  assert.equal(f.messages.length, 0)
  f.ready({ origin: "null" })
  f.load()
  assert.equal(f.messages[0][1], "*")
  assert.equal(f.loads(), 1)
})

test("branded entry waits for document and readiness, then delivers one deferred credential", t => {
  const f = fixture(t, { launch: null, deferredLaunch: true })
  f.load()
  assert.equal(f.loads(), 0)
  f.ready()
  t.mock.timers.tick(30000)
  assert.equal(f.loads(), 1)
  assert.equal(f.controller.sendLaunch({ joy8_launch_code: "later" }), true)
  assert.equal(f.controller.sendLaunch({ joy8_launch_code: "again" }), false)
  assert.equal(f.messages.length, 1)
  assert.equal(f.listeners.size, 1)
  f.controller.dispose()
  assert.equal(f.listeners.size, 0)
  assert.deepEqual(f.failures, [])
})

test("branded reauthorization accepts a fresh correlated request without replaying the prior launch", async t => {
  let release
  let entered = 0
  const requests = []
  const handle = createBrandedEntryRequests({
    canRequest: () => true,
    enter: async (_method, requestId) => {
      entered++
      await new Promise(resolve => { release = resolve })
      assert.equal(f.controller.sendLaunch({ joy8_launch_code: `fresh-${entered}` }, requestId), true)
    },
    onError: error => { throw error },
  })
  const f = fixture(t, { launch: null, deferredLaunch: true, onMessage: data => requests.push(handle(data)) })
  f.load()
  f.ready()
  f.controller.sendLaunch({ joy8_launch_code: "initial" })
  const request = { type: "joy8-entry-request-v1", method: "guest", requestId: "reauthorize-00001" }
  f.ready({ data: request, source: {} })
  f.ready({ data: request, origin: "https://attacker.example" })
  f.ready({ data: { ...request, requestId: "invalid" } })
  assert.equal(entered, 0)
  f.ready({ data: request })
  f.ready({ data: request })
  f.ready({ data: { ...request, requestId: "reauthorize-00002" } })
  assert.equal(entered, 1, "Only one authorization may be in flight")
  release()
  await Promise.all(requests)
  f.ready()
  f.ready({ data: request })
  assert.equal(f.messages.length, 2)
  assert.equal(f.messages[1][0].requestId, request.requestId)
  assert.equal(f.messages[1][0].launch.joy8_launch_code, "fresh-1")
  assert.equal(f.controller.sendLaunch({ joy8_launch_code: "replay" }, request.requestId), false)
  f.ready({ data: { ...request, requestId: "reauthorize-00002" } })
  release()
  await Promise.all(requests)
  assert.equal(f.messages.length, 3)
  assert.equal(f.messages[2][0].requestId, "reauthorize-00002")
  f.controller.dispose()
  assert.equal(f.listeners.size, 0)
})
