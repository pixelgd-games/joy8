import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks(["scripts/member-database-check.mjs", "scripts/member-concurrency-check.mjs"])
