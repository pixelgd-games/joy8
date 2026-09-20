import { loadMemberDatabase, memberSql } from "./member-database.mjs"
import { applyJoy8Rebrand } from "./joy8-rebrand.mjs"
import { loadPlatformHardening } from "./platform-hardening.mjs"

export async function loadPlatformDatabase(db, beforeDrafts = async () => {}, rebrand = true) {
  await loadMemberDatabase(db, async () => {}, false)
  await db.exec(await memberSql("../../supabase/migrations/20260710143000_add_gateway_runtime_limits.sql"))
  await beforeDrafts()
  for (const name of [
    "20260917090000_scoped_wallets.sql",
    "20260917091000_trusted_sessions.sql",
    "20260917092000_atomic_match_settlement.sql",
    "20260917093000_platform_health.sql",
    "20260917100000_active_session_scope.sql",
  ]) await db.exec(await memberSql(`../../supabase/migrations/${name}`))
  if (rebrand) {
    await applyJoy8Rebrand(db)
    for (const name of [
      "20260919130000_read_only_member_lookup.sql",
      "20260919131000_cross_product_adapter_isolation.sql",
      "20260920100000_public_player_ids.sql",
      "20260920110000_public_id_allocation.sql",
      "20260920111000_product_schema_registration.sql",
    ]) await db.exec(await memberSql(`../../supabase/migrations/${name}`))
    await loadPlatformHardening(db)
  }
}
