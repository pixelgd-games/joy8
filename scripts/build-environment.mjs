export function validateBuildEnvironment(env, { smoke = false, cloudflare = false } = {}) {
  for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_TURNSTILE_SITE_KEY"]) {
    if (!env[name]?.trim() || env[name] !== env[name].trim()) throw new Error(`Missing or invalid build variable: ${name}`)
  }
  if (env.VITE_SUPABASE_URL.replace(/\/$/, "") !== "https://lsazydefvnuqglultqii.supabase.co") throw new Error("Build must target the Joy8 Supabase project")
  const key = env.VITE_SUPABASE_ANON_KEY
  let publicKey = key.startsWith("sb_publishable_")
  try { publicKey ||= JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon" } catch {}
  if (!publicKey) throw new Error("VITE_SUPABASE_ANON_KEY must be a public anon/publishable key")
  if (smoke && cloudflare) throw new Error("Smoke builds cannot be deployed through Cloudflare Pages")
  if (!smoke && /^[123]x0{10,}/.test(env.VITE_TURNSTILE_SITE_KEY)) throw new Error("Production builds cannot use a Turnstile test key")
}
