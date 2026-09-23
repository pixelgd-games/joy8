const ref = "lsazydefvnuqglultqii"
const command = process.argv[2]
const allowed = ["external_email_enabled", "external_google_enabled", "external_anonymous_users_enabled", "disable_signup", "mailer_autoconfirm"]

async function request(method = "GET", body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method, headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    const body = await response.text()
    const category = /permission|scope|privilege/i.test(body) ? "insufficient permission" : /cloudflare|html|forbidden/i.test(body) ? "request blocked" : "API rejection"
    throw new Error(response.status === 401 ? "Unauthorized: refresh the local Joy8 access token" : `Auth configuration request failed (${response.status}; ${category})`)
  }
  return response.json()
}

try {
  if (process.env.SUPABASE_PROJECT_ID !== ref || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error("Run through scripts/supabase-joy8.cmd")
  if (!["status", "disable-email"].includes(command)) throw new Error("Use auth-config status or auth-config disable-email --apply")
  const before = await request()
  if (command === "disable-email") {
    if (process.argv[3] !== "--apply") throw new Error("Email provider changes require approval and --apply")
    if (before.external_google_enabled !== true || before.external_anonymous_users_enabled !== true || before.disable_signup !== false) throw new Error("Google/guest configuration changed; stop for review")
    await request("PATCH", { external_email_enabled: false })
    const after = await request()
    if (after.external_email_enabled !== false || allowed.filter(key => key !== "external_email_enabled").some(key => after[key] !== before[key])) throw new Error("Auth postflight mismatch; inspect provider settings")
    console.log(JSON.stringify(Object.fromEntries(allowed.map(key => [key, after[key]]))))
  } else console.log(JSON.stringify(Object.fromEntries(allowed.map(key => [key, before[key]]))))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
