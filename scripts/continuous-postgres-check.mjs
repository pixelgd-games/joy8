import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks(["scripts/continuous-settlement-check.mjs"])
