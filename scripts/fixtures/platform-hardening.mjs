import { readFile } from "node:fs/promises"

const sources = {
  ddl: "../../supabase/migrations/20260920120000_product_ddl_guard.sql",
  allocation: "../../supabase/migrations/20260920121000_public_id_collision_locks.sql",
  validation: "../../supabase/migrations/20260920122000_product_adapter_validation.sql",
}

export const hardeningSql = key => readFile(new URL(sources[key], import.meta.url), "utf8")

export async function loadPlatformHardening(db, platform = true) {
  for (const key of platform ? ["ddl", "allocation", "validation"] : ["allocation"]) {
    await db.exec(await hardeningSql(key))
  }
}
