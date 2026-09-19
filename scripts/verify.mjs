import { spawnSync } from "node:child_process"
import { readFile, readdir, access } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const files = await readdir(path.join(root, "scripts"), { recursive: true })
for (const file of files.filter(file => file.endsWith(".mjs"))) {
  const source = await readFile(path.join(root, "scripts", file), "utf8")
  for (const [reference] of source.matchAll(/supabase\/(?:migrations|drafts)\/[\w/-]+\.sql/g)) {
    await access(path.join(root, reference)).catch(() => { throw new Error(`${file}: missing SQL dependency ${reference}`) })
  }
}

const checks = [
  ["--test", ...[
    "member-unit-check", "captcha-check", "iframe-check", "member-database-check",
    "public-player-id-check", "public-id-allocation-check", "product-registration-check",
    "platform-database-check", "platform-cutover-check", "continuous-settlement-check",
    "private-entry-check", "session-scope-check", "ledger-cleanup-check", "product-ddl-check", "player-cleanup-check", "platform-bundle-check",
  ].map(name => `scripts/${name}.mjs`)],
  ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", "scripts/gateway-unit-check.mjs"],
  ["scripts/smoke-check.mjs"],
]
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true,
    env: { ...process.env, JOY8_TEST_ENGINE: "pglite" } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log("Verification passed: SQL dependencies, deployed-schema tests, Gateway, production build and browser smoke.")
