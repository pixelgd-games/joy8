import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks([
  "scripts/member-database-check.mjs",
  "scripts/member-concurrency-check.mjs",
  "scripts/platform-database-check.mjs",
  "scripts/platform-concurrency-check.mjs",
  "scripts/continuous-settlement-check.mjs",
  "scripts/private-entry-check.mjs",
  "scripts/product-registration-check.mjs",
  "scripts/public-id-concurrency-check.mjs",
  "scripts/product-ddl-check.mjs",
  "scripts/public-id-lock-check.mjs",
])
