import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks(["scripts/session-scope-check.mjs"])
