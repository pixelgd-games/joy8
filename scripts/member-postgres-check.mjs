import { spawn } from "node:child_process"

const child = spawn(process.execPath, ["--test", "scripts/member-database-check.mjs", "scripts/member-concurrency-check.mjs"], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, LOOTY_MEMBER_TEST_ENGINE: "postgres17" },
})
child.once("error", (error) => { console.error(error.message); process.exitCode = 1 })
child.once("exit", (code) => { process.exitCode = code ?? 1 })
