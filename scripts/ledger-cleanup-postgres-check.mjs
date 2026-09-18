import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks(["scripts/ledger-cleanup-check.mjs"])
