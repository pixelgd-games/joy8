import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks(["scripts/platform-database-check.mjs", "scripts/platform-concurrency-check.mjs"])
