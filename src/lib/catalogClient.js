import { createClient } from "@supabase/supabase-js"
import { fetchWithTimeout } from "./request.js"

export const catalogSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: fetchWithTimeout }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "joy8-public-catalog" } },
)
