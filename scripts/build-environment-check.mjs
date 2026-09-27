import assert from "node:assert/strict"
import { test } from "node:test"
import { validateBuildEnvironment } from "./build-environment.mjs"

const env = { VITE_SUPABASE_URL: "https://lsazydefvnuqglultqii.supabase.co", VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture" }
test("production builds reject missing variables, foreign projects and privileged keys", () => {
  assert.doesNotThrow(() => validateBuildEnvironment(env))
  for (const name of Object.keys(env)) assert.throws(() => validateBuildEnvironment({ ...env, [name]: "" }), /build variable/)
  assert.throws(() => validateBuildEnvironment({ ...env, VITE_SUPABASE_URL: "https://other.supabase.co" }), /Joy8/)
  for (const key of ["sb_secret_fixture", `header.${Buffer.from('{"role":"service_role"}').toString("base64url")}.signature`]) {
    assert.throws(() => validateBuildEnvironment({ ...env, VITE_SUPABASE_ANON_KEY: key }), /public anon/)
  }
})
test("Google builds need no captcha key and smoke cannot deploy", () => {
  assert.doesNotThrow(() => validateBuildEnvironment(env))
  assert.throws(() => validateBuildEnvironment(env, { smoke: true, cloudflare: true }), /cannot be deployed/)
})
