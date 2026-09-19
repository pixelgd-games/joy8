import { readFile } from "node:fs/promises"
import { applyJoy8Rebrand } from "./joy8-rebrand.mjs"
import { loadPlatformHardening } from "./platform-hardening.mjs"

export const memberSql = (path) => readFile(new URL(path, import.meta.url), "utf8")

export async function loadMemberDatabase(db, beforeMemberMigrations = async () => {}, rebrand = true) {
  await db.exec(await memberSql("./member-database.sql"))
  for (const migration of [
    "20260709170000_create_platform_account_wallet_core.sql",
    "20260710141000_create_gateway_v1_session_auth.sql",
    "20260710142000_bind_rounds_to_game_sessions.sql",
    "20260710210000_grant_demo_wallet_initial_credit.sql",
  ]) {
    await db.exec(await memberSql(`../../supabase/migrations/${migration}`))
  }
  await beforeMemberMigrations()
  for (const migration of ["20260916100000_member_enrollment.sql", "20260916101000_require_member_game_session.sql"]) {
    await db.exec(await memberSql(`../../supabase/migrations/${migration}`))
  }
  if (rebrand) {
    await applyJoy8Rebrand(db)
    await db.exec(await memberSql("../../supabase/migrations/20260919130000_read_only_member_lookup.sql"))
    await db.exec(await memberSql("../../supabase/migrations/20260920100000_public_player_ids.sql"))
    await db.exec(await memberSql("../../supabase/migrations/20260920110000_public_id_allocation.sql"))
    await loadPlatformHardening(db, false)
  }
}
