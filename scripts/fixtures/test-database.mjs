import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { createLocalPostgres } from "./local-postgres.mjs"

export async function createTestDatabase(engine = process.env.LOOTY_TEST_ENGINE ?? "pglite") {
  if (engine === "postgres17") return createLocalPostgres()
  if (engine === "pglite") return new PGlite({ extensions: { pgcrypto } })
  throw new Error(`Unsupported LOOTY_TEST_ENGINE: ${engine}`)
}
