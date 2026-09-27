import assert from "node:assert/strict"
import { test } from "node:test"
import { forwardCallback, readEntryParams } from "../src/member/callback.js"

test("OAuth trampoline forwards the code only in the fragment and clears it before use", () => {
  for (const path of ["/?member=callback&next=%2F", "/entry/?slug=test-game"]) {
    const target = forwardCallback(new URLSearchParams("code=one-use&flow=signin&provider=google"), new URL(path, "https://joy8.cc"))
    assert.equal(target.searchParams.has("code"), false)
    const replacements = []
    const params = readEntryParams(target, { replaceState: (...args) => replacements.push(args[2]) })
    assert.equal(params.get("code"), "one-use")
    assert.equal(params.get("provider"), "google")
    assert.equal(replacements.length, 1)
    assert.ok(!replacements[0].includes("one-use"))
  }
})
