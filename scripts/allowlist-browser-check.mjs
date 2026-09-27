import { readFile } from "node:fs/promises"

export async function expectAllowlistAdmin(client, appPort) {
  const evaluate = async expression => {
    const result = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression })
    if (result.exceptionDetails) throw new Error(`Allowlist browser check: ${JSON.stringify(result.exceptionDetails)}`)
    return result.result.value
  }
  const html = await readFile(new URL("../admin/access/index.html", import.meta.url), "utf8")
  for (const scenario of ["allowed", "read-failed", "denied"]) {
    await client.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/canonical-host.js?allowlist=${scenario}` })
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`location.search === '?allowlist=${scenario}' && document.readyState === 'complete'`)) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    await evaluate(`document.body.innerHTML = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html').body.innerHTML`)
    await evaluate(`(${async function (scenario) {
      const { supabase } = await import("/src/lib/supabaseClient.js")
      const tick = () => new Promise(resolve => setTimeout(resolve, 0))
      const check = (value, message) => { if (!value) throw new Error(message) }
      const rows = [{ email: "admin@example.test" }]
      const writes = []
      let reads = 0
      supabase.auth.getSession = async () => ({ data: { session: { user: { id: "admin" } } } })
      supabase.rpc = async () => ({ data: scenario !== "denied" })
      supabase.from = name => {
        check(name === "joy8_email_allowlist", "Wrong admin table")
        return {
          select: () => ({ order: async () => { reads++; return scenario === "read-failed" ? { error: { message: "offline" } } : { data: rows } } }),
          insert: row => ({ select: async () => { writes.push(row.email); await tick(); rows.push(row); return { data: [row] } } }),
          delete: () => ({ eq: (_column, email) => ({ select: async () => {
            if (email === "admin@example.test") return { error: { message: "JOY8_ADMIN_EMAIL_REQUIRED" } }
            rows.splice(rows.findIndex(row => row.email === email), 1)
            return { data: [{ email }] }
          } }) }),
        }
      }
      window.confirm = () => true
      await import("/src/admin/access.js")
      for (let i = 0; i < 10; i++) await tick()
      const email = document.getElementById("email")
      const form = document.getElementById("access-form")
      if (scenario !== "allowed") {
        check(email.disabled && document.getElementById("add").disabled, "Unverified or unloaded controls enabled")
        check(writes.length === 0 && (scenario !== "denied" || reads === 0), "Denied admin accessed data")
        return
      }
      check(!email.disabled, "Verified admin controls disabled")
      email.value = " Tester@Example.Test "
      form.dispatchEvent(new Event("submit", { cancelable: true }))
      form.dispatchEvent(new Event("submit", { cancelable: true }))
      for (let i = 0; i < 10; i++) await tick()
      check(writes.length === 1 && writes[0] === "tester@example.test", "Duplicate or unnormalized add")
      document.querySelectorAll("#emails button")[0].click()
      for (let i = 0; i < 5; i++) await tick()
      check(document.getElementById("status").textContent.includes("管理員 email 必須保留"), "Protected admin error missing")
      document.querySelectorAll("#emails button")[1].click()
      for (let i = 0; i < 5; i++) await tick()
      check(rows.length === 1 && !email.disabled, "Removal or retry controls failed")
    }} )(${JSON.stringify(scenario)})`)
  }
  console.log("OK Allowlist admin normalization, duplicate guard, protected admin, removal and denied/read-failed controls")
}
