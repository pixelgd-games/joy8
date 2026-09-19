import { runPostgresChecks } from "./fixtures/postgres-check-runner.mjs"

runPostgresChecks([
  "scripts/public-id-allocation-check.mjs",
  "scripts/public-id-concurrency-check.mjs",
  "scripts/product-registration-check.mjs",
])
