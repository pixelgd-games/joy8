import { createClient } from "@supabase/supabase-js"
import { fetchWithTimeout } from "./request.js"

export const memberSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    global: { fetch: fetchWithTimeout },
    auth: {
      storageKey: "joy8-member-auth-v1",
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)
