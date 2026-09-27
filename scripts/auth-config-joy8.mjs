import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ref = "lsazydefvnuqglultqii"
const command = process.argv[2]
const allowed = ["external_email_enabled", "external_google_enabled", "external_anonymous_users_enabled", "disable_signup", "mailer_autoconfirm", "hook_before_user_created_enabled", "hook_before_user_created_uri"]
const hookUri = "pg-functions://postgres/public/joy8_before_user_created"

function verifyAllowlist() {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("supabase-joy8.ps1", import.meta.url)), "db", "query", "--linked", "--file", "scripts/sql/email-allowlist-status.sql"],
  { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true })
  if (result.status !== 0) throw new Error("Allowlist SQL preflight failed; apply the approved migration first")
  const status = JSON.parse(result.stdout).rows?.[0]?.allowlist_status
  if (!status || Object.values(status).some(value => value !== true)) throw new Error("Allowlist or administrator preflight failed")
}

async function request(method = "GET", body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method, headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    const body = await response.text()
    const category = /permission|scope|privilege/i.test(body) ? "insufficient permission" : /cloudflare|html|forbidden/i.test(body) ? "request blocked" : "API rejection"
    let reason = "No structured API reason"
    try {
      const error = JSON.parse(body)
      if (typeof error.message === "string") reason = error.message
    } catch {}
    reason = reason.replaceAll(process.env.SUPABASE_ACCESS_TOKEN, "[redacted]")
      .replace(/(?:Bearer\s+\S+|sbp_[\w-]+|sb_secret_[\w-]+|eyJ[\w.-]+|[^\s@]+@[^\s@]+)/gi, "[redacted]")
      .replace(/[\r\n]/g, " ").slice(0, 400)
    throw new Error(response.status === 401 ? "Unauthorized: refresh the local Joy8 access token" : `Auth configuration request failed (${response.status}; ${category}): ${reason}`)
  }
  return response.json()
}

try {
  if (process.env.SUPABASE_PROJECT_ID !== ref || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error("Run through scripts/supabase-joy8.cmd")
  if (!["status", "disable-email", "enable-whitelist"].includes(command)) throw new Error("Use auth-config status, disable-email --apply or enable-whitelist --apply")
  const before = await request()
  if (command === "enable-whitelist") {
    if (process.argv[3] !== "--apply") throw new Error("Whitelist activation requires approved SQL and --apply")
    if (before.external_google_enabled !== true || before.disable_signup !== false) throw new Error("Google signup configuration changed; stop for review")
    if (before.hook_before_user_created_enabled && before.hook_before_user_created_uri !== hookUri) throw new Error("An existing signup hook needs review before replacement")
    verifyAllowlist()
    const patch = { hook_before_user_created_enabled: true, hook_before_user_created_uri: hookUri }
    await request("PATCH", patch)
    const after = await request()
    if (allowed.some(key => after[key] !== (Object.hasOwn(patch, key) ? patch[key] : before[key]))) throw new Error("Auth postflight mismatch; inspect provider settings")
    console.log(JSON.stringify(Object.fromEntries(allowed.map(key => [key, after[key]]))))
  } else if (command === "disable-email") {
    if (process.argv[3] !== "--apply") throw new Error("Email provider changes require approval and --apply")
    if (before.external_google_enabled !== true || before.disable_signup !== false) throw new Error("Google configuration changed; stop for review")
    await request("PATCH", { external_email_enabled: false })
    const after = await request()
    if (after.external_email_enabled !== false || allowed.filter(key => key !== "external_email_enabled").some(key => after[key] !== before[key])) throw new Error("Auth postflight mismatch; inspect provider settings")
    console.log(JSON.stringify(Object.fromEntries(allowed.map(key => [key, after[key]]))))
  } else console.log(JSON.stringify(Object.fromEntries(allowed.map(key => [key, before[key]]))))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
