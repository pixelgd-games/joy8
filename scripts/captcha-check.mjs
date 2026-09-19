import assert from "node:assert/strict"
import test from "node:test"

let instance = 0
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

async function fixture(t, loaded = true) {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const scripts = []
  const widgets = []
  const removed = []
  const api = {
    render: (_, options) => { widgets.push(options); return widgets.length - 1 },
    execute() {},
    remove: (id) => removed.push(id),
  }
  const priorWindow = globalThis.window
  const priorDocument = globalThis.document
  globalThis.window = loaded ? { turnstile: api } : {}
  globalThis.document = {
    head: { append: (script) => scripts.push(script) },
    createElement: () => {
      const handlers = new Map()
      return {
        dataset: {}, removed: false,
        addEventListener: (event, fn) => handlers.set(event, fn),
        removeEventListener: (event) => handlers.delete(event),
        emit: (event) => handlers.get(event)?.(),
        remove() { this.removed = true },
      }
    },
  }
  t.after(() => { globalThis.window = priorWindow; globalThis.document = priorDocument })
  const { createMemberCaptcha } = await import(`../src/member/captcha.js?test=${instance++}`)
  const create = () => {
    const captcha = createMemberCaptcha({ querySelector: () => ({}) })
    t.after(() => captcha.dispose())
    return captcha
  }
  return { api, scripts, widgets, removed, create, captcha: create() }
}

test("silent challenge times out, releases the attempt and ignores its late callback", async (t) => {
  const f = await fixture(t)
  const first = f.captcha.token()
  assert.equal(f.captcha.token(), first)
  const rejected = assert.rejects(first, { code: "captcha_timeout" })
  await flush()
  t.mock.timers.tick(45000)
  await rejected
  assert.deepEqual(f.removed, [0])
  const retry = f.captcha.token()
  await flush()
  f.widgets[0].callback("stale")
  f.widgets[1].callback("fresh")
  assert.equal(await retry, "fresh")
})

test("script timeout releases shared waiters and a new panel can reload", async (t) => {
  const f = await fixture(t, false)
  const other = f.create()
  const failures = [f.captcha, other].map(captcha => assert.rejects(captcha.token(), { code: "captcha_timeout" }))
  assert.equal(f.scripts.length, 1)
  t.mock.timers.tick(15000)
  await Promise.all(failures)
  assert.equal(f.scripts[0].removed, true)
  const retry = f.create().token()
  assert.equal(f.scripts.length, 2)
  window.turnstile = f.api
  f.scripts[1].emit("load")
  await flush()
  f.widgets[0].callback("recovered")
  assert.equal(await retry, "recovered")
})

test("failed script loads and missing APIs are retried in the same panel", async (t) => {
  const f = await fixture(t, false)
  for (const event of ["error", "load"]) {
    const failed = assert.rejects(f.captcha.token(), { code: "captcha_unavailable" })
    f.scripts.at(-1).emit(event)
    await failed
    assert.equal(f.scripts.at(-1).removed, true)
  }
  const retry = f.captcha.token()
  assert.equal(f.scripts.length, 3)
  window.turnstile = f.api
  f.scripts.at(-1).emit("load")
  await flush()
  f.widgets[0].callback("recovered")
  assert.equal(await retry, "recovered")
})

test("closing during script load cancels promptly and cannot mount a late widget", async (t) => {
  const f = await fixture(t, false)
  const rejected = assert.rejects(f.captcha.token(), { code: "captcha_unavailable" })
  f.captcha.dispose()
  await rejected
  window.turnstile = f.api
  f.scripts[0].emit("load")
  await flush()
  assert.equal(f.widgets.length, 0)
  await assert.rejects(f.captcha.token(), { code: "captcha_unavailable" })
})

test("challenge errors, expiration and interactive timeout all allow a fresh attempt", async (t) => {
  const f = await fixture(t)
  for (const [callback, code] of [["error-callback", "captcha_failed"], ["expired-callback", "captcha_failed"], ["timeout-callback", "captcha_timeout"]]) {
    const rejected = assert.rejects(f.captcha.token(), { code })
    await flush()
    f.widgets.at(-1)[callback]()
    await rejected
  }
  const success = f.captcha.token()
  await flush()
  f.widgets.at(-1).callback("new-token")
  assert.equal(await success, "new-token")
  assert.equal(f.removed.length, 4)
})

test("render and execute exceptions do not poison retries", async (t) => {
  const f = await fixture(t)
  const render = f.api.render
  f.api.render = () => { throw new Error("Render unavailable") }
  await assert.rejects(f.captcha.token(), { code: "captcha_unavailable" })
  f.api.render = render
  f.api.execute = () => { throw new Error("Execute unavailable") }
  await assert.rejects(f.captcha.token(), { code: "captcha_unavailable" })
  f.api.execute = () => {}
  const retry = f.captcha.token()
  await flush()
  f.widgets.at(-1).callback("retry")
  assert.equal(await retry, "retry")
})

test("reset cancels a challenge without disabling the next attempt", async (t) => {
  const f = await fixture(t)
  const rejected = assert.rejects(f.captcha.token(), { code: "captcha_unavailable" })
  await flush()
  f.captcha.reset()
  await rejected
  const retry = f.captcha.token()
  await flush()
  f.widgets.at(-1).callback("retry")
  assert.equal(await retry, "retry")
})
