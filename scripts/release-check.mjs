import assert from "node:assert/strict"
import path from "node:path"
import { spawnSync } from "node:child_process"

assert.ok(process.env.JOY8_TEST_PG_BIN && path.isAbsolute(process.env.JOY8_TEST_PG_BIN), "Release requires JOY8_TEST_PG_BIN pointing to PostgreSQL 17")
for (const [script, engine] of [["verify.mjs", "pglite"], ["hardening-postgres-check.mjs", "postgres17"]]) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: "inherit", windowsHide: true,
    env: { ...process.env, JOY8_TEST_ENGINE: engine } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const result = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { stdio: "inherit", windowsHide: true })
if (result.error) throw result.error
process.exit(result.status ?? 1)
