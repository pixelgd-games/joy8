import { spawn } from "node:child_process"

export function runPostgresChecks(files) {
  const child = spawn(process.execPath, ["--test", ...files], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, LOOTY_TEST_ENGINE: "postgres17" },
  })
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1 })
  child.once("exit", (code) => { process.exitCode = code ?? 1 })
}
