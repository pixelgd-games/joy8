import assert from "node:assert/strict"
import test from "node:test"
import { prepareGameEntry, trackGameVisit } from "../src/member/game-visit.js"

const key = "joy8-game-visit-v1"

function fixture() {
  const browser = new EventTarget()
  browser.document = new EventTarget()
  browser.document.hidden = false
  let time = 1000000
  const values = new Map(), timers = new Set(), redirects = []
  browser.Date = { now: () => time }
  browser.sessionStorage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) }
  browser.location = { origin: "https://joy8.example", replace: path => redirects.push(path) }
  browser.setInterval = callback => { timers.add(callback); return callback }
  browser.clearInterval = callback => timers.delete(callback)
  return { browser, values, redirects,
    advance(ms) { time += ms },
    pulse() { for (const callback of timers) callback() },
    hide() { browser.document.hidden = true; browser.document.dispatchEvent(new Event("visibilitychange")) },
    show() { browser.document.hidden = false; browser.document.dispatchEvent(new Event("visibilitychange")) },
    depart() { browser.dispatchEvent(new Event("pagehide")) },
    restore() { browser.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })) },
    enter(slug = "monster-lab") { prepareGameEntry(`/game/?slug=${slug}`, browser); return trackGameVisit(slug, browser) },
  }
}

test("game URLs need a recent matching per-tab visit and store only slug/time", () => {
  const f = fixture()
  assert.equal(trackGameVisit("monster-lab", f.browser), null)
  prepareGameEntry("/game/?slug=monster-lab", f.browser)
  assert.deepEqual(JSON.parse(f.values.get(key)), { slug: "monster-lab", at: 1000000 })
  assert.equal(trackGameVisit("other-game", f.browser), null)
  f.advance(119999)
  assert.equal(typeof trackGameVisit("monster-lab", f.browser), "function")
  assert.equal(trackGameVisit("monster-lab", fixture().browser), null)
})

test("recreated pages return at two minutes; explicit game selection starts a new visit", () => {
  const f = fixture()
  const dispose = f.enter()
  f.hide()
  f.advance(120000)
  assert.equal(trackGameVisit("monster-lab", f.browser), null)
  dispose()
  assert.equal(typeof f.enter(), "function")
})

test("foreground pages remain refreshable after long play without parent-frame input", () => {
  const f = fixture()
  f.enter()
  f.advance(3600000)
  f.pulse()
  f.depart()
  assert.equal(typeof trackGameVisit("monster-lab", f.browser), "function")
})

test("tab switches preserve the same page even after two minutes and renew its visit on return", () => {
  const f = fixture()
  f.enter()
  f.hide()
  f.advance(3600000)
  f.pulse()
  assert.equal(JSON.parse(f.values.get(key)).at, 1000000)
  f.show()
  assert.deepEqual(f.redirects, [])
  assert.equal(JSON.parse(f.values.get(key)).at, 4600000)
  assert.equal(typeof trackGameVisit("monster-lab", f.browser), "function")
})

test("unloading an old hidden page must not make its restored visit look recent", () => {
  const f = fixture()
  f.enter()
  f.hide()
  f.advance(120000)
  f.depart()
  assert.equal(JSON.parse(f.values.get(key)).at, 1000000)
  assert.equal(trackGameVisit("monster-lab", f.browser), null)
})

test("history restoration checks the old visit before visibility events can renew it", () => {
  const f = fixture()
  f.enter()
  f.hide()
  f.depart()
  f.advance(120000)
  f.show()
  f.restore()
  assert.deepEqual(f.redirects, ["/"])
})

test("recent history restoration resumes tracking without starting another game session", () => {
  const f = fixture()
  f.enter()
  f.hide()
  f.depart()
  f.advance(119999)
  f.show()
  f.restore()
  assert.deepEqual(f.redirects, [])
  f.advance(300000)
  f.pulse()
  assert.equal(typeof trackGameVisit("monster-lab", f.browser), "function")
})

test("history cannot restore a different game after a new game was selected", () => {
  const f = fixture()
  f.enter()
  f.depart()
  prepareGameEntry("/game/?slug=other-game", f.browser)
  f.restore()
  assert.deepEqual(f.redirects, ["/"])
})

test("malformed, future and unavailable visit storage cannot auto-launch", () => {
  const f = fixture()
  for (const value of ["invalid", "null", '{}', '{"slug":"monster-lab","at":"1000000"}', '{"slug":"monster-lab","at":1000001}']) {
    f.values.set(key, value)
    assert.equal(trackGameVisit("monster-lab", f.browser), null)
  }
  f.browser.sessionStorage = { getItem() { throw new Error("Unavailable") }, setItem() { throw new Error("Unavailable") } }
  assert.doesNotThrow(() => prepareGameEntry("/game/?slug=monster-lab", f.browser))
  assert.equal(trackGameVisit("monster-lab", f.browser), null)
})

test("other entry routes and untrusted destinations do not authorize public Loader entry", () => {
  const f = fixture()
  for (const path of ["/", "/entry/?slug=monster-lab", "/play-test/?slug=monster-lab", "https://other.example/game/?slug=monster-lab"]) {
    prepareGameEntry(path, f.browser)
    assert.equal(f.values.size, 0)
  }
})
