import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import { test } from "node:test"

test("Hook rollout verifies SQL, preserves every provider setting and refuses unsafe activation", async () => {
  const saved = { fetch: globalThis.fetch, argv: process.argv, exitCode: process.exitCode,
    spawn: childProcess.spawnSync, log: console.log, error: console.error,
    ref: process.env.SUPABASE_PROJECT_ID, token: process.env.SUPABASE_ACCESS_TOKEN }
  try {
    process.env.SUPABASE_PROJECT_ID = "lsazydefvnuqglultqii"
    process.env.SUPABASE_ACCESS_TOKEN = "fixture-token"
    for (const scenario of ["success", "no-apply", "sql-denied", "other-hook", "api-denied"]) {
      const calls = []
      const errors = []
      let config = { external_google_enabled: true, external_email_enabled: true,
        external_anonymous_users_enabled: true, disable_signup: false, mailer_autoconfirm: false,
        hook_before_user_created_enabled: scenario === "other-hook",
        hook_before_user_created_uri: scenario === "other-hook" ? "https://existing.example/hook" : null }
      process.argv = ["node", "script", "enable-whitelist", ...(scenario === "no-apply" ? [] : ["--apply"])]
      process.exitCode = undefined
      console.log = () => {}
      console.error = message => errors.push(message)
      childProcess.spawnSync = (_command, args) => {
        calls.push("SQL")
        assert.ok(args.includes("scripts/sql/email-allowlist-status.sql"))
        return { status: 0, stdout: JSON.stringify({ rows: [{ allowlist_status: { hook_installed: true, admins_covered: scenario !== "sql-denied" } }] }) }
      }
      syncBuiltinESMExports()
      globalThis.fetch = async (_url, options) => {
        calls.push(options.method)
        if (scenario === "api-denied") return Response.json({ message: "Missing required permission(s): auth_config_read" }, { status: 403 })
        if (options.method === "PATCH") {
          const patch = JSON.parse(options.body)
          assert.deepEqual(patch, { hook_before_user_created_enabled: true,
            hook_before_user_created_uri: "pg-functions://postgres/public/joy8_before_user_created" })
          config = { ...config, ...patch }
        }
        return Response.json(config)
      }
      await import(`./auth-config-joy8.mjs?scenario=${scenario}`)
      if (scenario === "success") {
        assert.deepEqual(calls, ["GET", "SQL", "PATCH", "GET"])
        assert.deepEqual(errors, [])
        assert.equal(config.external_google_enabled, true)
        assert.equal(config.external_anonymous_users_enabled, true)
        assert.equal(config.external_email_enabled, true)
        assert.equal(config.disable_signup, false)
      } else {
        assert.equal(calls.includes("PATCH"), false)
        assert.equal(process.exitCode, 1)
        assert.equal(errors.length, 1)
      }
    }
  } finally {
    globalThis.fetch = saved.fetch
    process.argv = saved.argv
    process.exitCode = saved.exitCode
    childProcess.spawnSync = saved.spawn
    syncBuiltinESMExports()
    console.log = saved.log
    console.error = saved.error
    for (const [key, value] of [["SUPABASE_PROJECT_ID", saved.ref], ["SUPABASE_ACCESS_TOKEN", saved.token]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
