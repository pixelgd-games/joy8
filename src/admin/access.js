import "../styles/admin.css"
import { supabase } from "../lib/supabaseClient.js"
import { requireAdmin, signOut } from "./auth.js"

const form = document.getElementById("access-form")
const email = document.getElementById("email")
const status = document.getElementById("status")
const list = document.getElementById("emails")
let busy = true
let loaded = false

function controls(disabled) {
  for (const control of document.querySelectorAll("input,button")) control.disabled = disabled
}

async function refresh() {
  const { data, error } = await supabase.from("joy8_email_allowlist").select("email,created_at").order("email")
  if (error) throw error
  list.replaceChildren()
  for (const row of data) {
    const item = document.createElement("li")
    const remove = document.createElement("button")
    remove.type = "button"
    remove.textContent = "移除"
    remove.setAttribute("aria-label", `移除 ${row.email}`)
    remove.addEventListener("click", () => {
      if (busy || !confirm(`移除 ${row.email}？此帳號將無法再開啟遊戲。`)) return
      void run(async () => {
        const result = await supabase.from("joy8_email_allowlist").delete().eq("email", row.email).select("email")
        if (result.error) throw result.error
        if (result.data.length !== 1) throw new Error("Access changed")
        await refresh()
      })
    })
    const label = document.createElement("span")
    label.textContent = row.email
    item.append(label, remove)
    list.append(item)
  }
  loaded = true
  status.textContent = `共 ${data.length} 個 email`
}

async function run(action) {
  if (busy) return
  busy = true
  controls(true)
  try { await action() }
  catch (error) {
    status.textContent = error?.message === "JOY8_ADMIN_EMAIL_REQUIRED" ? "管理員 email 必須保留在白名單內。"
      : error?.code === "23505" ? "這個 email 已在白名單內。" : "操作未完成，請重新整理後再試。"
  } finally { busy = false; controls(!loaded) }
}

form.addEventListener("submit", event => {
  event.preventDefault()
  void run(async () => {
    const result = await supabase.from("joy8_email_allowlist").insert({ email: email.value.trim().toLowerCase() }).select("email")
    if (result.error) throw result.error
    if (result.data.length !== 1) throw new Error("Access changed")
    email.value = ""
    await refresh()
  })
})
document.getElementById("logout").addEventListener("click", signOut)
async function main() {
  controls(true)
  if (!await requireAdmin()) return
  busy = false
  await run(refresh)
}
void main()
