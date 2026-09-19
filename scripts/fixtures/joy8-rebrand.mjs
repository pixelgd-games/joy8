import { readFile } from "node:fs/promises"

export const joy8RebrandSql = () => readFile(
  new URL("../../supabase/migrations/20260919100000_joy8_rebrand.sql", import.meta.url),
  "utf8",
)

export async function applyJoy8Rebrand(db) {
  await db.exec(await joy8RebrandSql())
}
