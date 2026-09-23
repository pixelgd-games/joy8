import { catalogSupabase as supabase } from "../../lib/catalogClient.js"

const PUBLIC_GAME_FIELDS = "slug, name, type, thumbnail"

export async function fetchPublicGames() {
  const { data, error } = await supabase
    .from("public_games_v1")
    .select(PUBLIC_GAME_FIELDS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })

  if (error) {
    throw error
  }

  return data || []
}
