import { loadMemberDatabase, memberSql } from "./member-database.mjs"
import { applyJoy8Rebrand } from "./joy8-rebrand.mjs"

export async function loadPlatformDatabase(db, beforeDrafts = async () => {}, rebrand = true) {
  await loadMemberDatabase(db, async () => {}, false)
  await beforeDrafts()
  for (const name of [
    "20260917090000_scoped_wallets.sql",
    "20260917091000_trusted_sessions.sql",
    "20260917092000_atomic_match_settlement.sql",
    "20260917093000_platform_health.sql",
    "20260917100000_active_session_scope.sql",
  ]) await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  if (rebrand) await applyJoy8Rebrand(db)
}
