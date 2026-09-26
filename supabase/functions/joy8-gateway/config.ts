export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

export const AUTH_REQUEST_TIMEOUT_MS = 5000
export const RPC_REQUEST_TIMEOUT_MS = 8000

export const INGRESS_LIMIT = { limit: 10000, windowSeconds: 60 }
