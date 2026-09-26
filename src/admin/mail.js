import "../mailbox/style.css"
import { supabase } from "../lib/supabaseClient.js"
import { requireAdmin, signOut } from "./auth.js"
import { createMailboxService, formatDate, formatPoints, mailAudiences, mailKinds, mailStatuses, renderMailDetail, textElement } from "../mailbox/service.js"

const $ = selector => document.querySelector(selector)
const form = $("#compose")
const field = name => form.elements.namedItem(name)
const api = createMailboxService(supabase, true)
let pendingRequest = null
let busy = false
let authorized = false
let offset = 0
let adminId = null
let games = []
let recipientRevision = 0

function feedback(text) { $("#status").textContent = text }
function toggleFields() {
  const reward = ["reward", "compensation"].includes(field("kind").value)
  const player = field("audience").value === "player"
  $("#reward-fields").hidden = !reward
  field("amount").required = field("source_ref").required = reward
  field("public_id").required = player
  $("#player-field").hidden = !player
  field("game_id").required = field("audience").value === "game"
  pendingRequest = null
}
form.addEventListener("input", () => { pendingRequest = null })
field("kind").addEventListener("change", toggleFields)
field("audience").addEventListener("change", toggleFields)

function setBusy(value) {
  busy = value
  for (const button of document.querySelectorAll("button")) button.disabled = value || !authorized || button.dataset.unavailable === "true"
  $("#fields").disabled = value || !authorized
}

form.addEventListener("submit", async event => {
  event.preventDefault()
  if (!authorized || busy) return
  if (!pendingRequest) {
    pendingRequest = Object.fromEntries(new FormData(form))
    pendingRequest.id = crypto.randomUUID()
    if (pendingRequest.audience !== "player") pendingRequest.public_id = ""
    if (!["reward", "compensation"].includes(pendingRequest.kind)) { pendingRequest.amount = "0"; pendingRequest.source_ref = "" }
  }
  setBusy(true)
  feedback("正在保存預覽與收件名單，尚未發送…")
  try {
    const mail = await api("prepare", pendingRequest)
    if (!authorized) return
    mail.game_name = games.find(game => game.id === mail.game_id)?.name
    showPreview(mail)
    feedback("預覽已保存。請確認內容、收件人數與總金額後發送。")
    await loadHistory()
  } catch (error) { feedback(error.message) }
  finally { setBusy(false) }
})

function showPreview(mail) {
  const root = $("#preview")
  renderMailDetail(root, mail)
  root.append(textElement("p", `${mailStatuses[mail.status]} · ${mailAudiences[mail.audience]}${mail.audience === "player" ? ` Player ${mail.public_id}` : ""} · ${mail.recipient_count} 人`, "mail-notice"))
  if (Number(mail.amount)) root.append(textElement("p", `每人 ${formatPoints(mail.amount)}／總計 ${formatPoints(mail.total_amount)}；案件或活動：${mail.source_ref}`, "mail-notice"))
  const controls = textElement("div", "", "mail-actions")
  if (mail.status === "draft" && (!mail.created_by || mail.created_by === adminId)) {
    for (const [action, label] of [["send", "確認發送"], ["cancel", "取消這份草稿"]]) {
      const button = textElement("button", label, action === "send" ? "mail-primary" : "")
      button.addEventListener("click", async () => {
        if (busy || !authorized) return
        setBusy(true)
        try {
          const result = await api(action, { id: mail.id })
          if (!authorized) return
          showPreview({ ...mail, ...result })
          pendingRequest = null
          feedback(action === "send" ? "信件已發送，玩家可以在站內信箱查看。" : "草稿已取消，沒有寄給玩家。")
          await loadHistory()
        } catch (error) { feedback(error.message) }
        finally { setBusy(false) }
      })
      controls.append(button)
    }
  }
  const inspect = textElement("button", "查看收件與領取狀態")
  inspect.addEventListener("click", () => { if (!busy) void loadRecipients(mail.id, 0) })
  controls.append(inspect)
  root.append(controls)
  root.focus()
}

async function loadHistory() {
  const result = await api("list", { offset })
  if (!authorized) return
  $("#history").replaceChildren()
  if (!result.items.length) $("#history").append(textElement("p", "尚無信件紀錄。", "mail-empty"))
  for (const mail of result.items.slice(0, 20)) {
    const button = textElement("button", "", "mail-list-item")
    button.append(textElement("span", `${mailStatuses[mail.status]} · ${mailKinds[mail.kind]} · ${formatDate(mail.created_at)}`, "mail-kicker"),
      textElement("strong", mail.title), textElement("span", `${mail.recipient_count} 人 · 已讀 ${mail.read_count} · 已領 ${mail.claim_count} · 總額 ${formatPoints(mail.total_amount)}`, "mail-muted"))
    button.addEventListener("click", () => { if (!busy) showPreview(mail) })
    $("#history").append(button)
  }
  $("#previous").disabled = offset === 0
  $("#next").disabled = result.items.length <= 20
  $("#previous").dataset.unavailable = String(offset === 0)
  $("#next").dataset.unavailable = String(result.items.length <= 20)
  $("#page-number").textContent = String(offset / 20 + 1)
}

async function loadRecipients(id, recipientOffset) {
  const current = ++recipientRevision
  try {
    const result = await api("recipients", { id, offset: recipientOffset })
    if (current !== recipientRevision || !authorized) return
    const root = $("#recipients")
    root.hidden = false
    root.replaceChildren(textElement("h2", "收件與領取狀態"))
    const table = document.createElement("table")
    const head = document.createElement("tr")
    for (const text of ["玩家", "已讀時間", "領取時間", "入帳編號"]) head.append(textElement("th", text))
    table.append(head)
    for (const row of result.items.slice(0, 20)) {
      const tr = document.createElement("tr")
      for (const text of [`Player ${row.public_id}`, formatDate(row.read_at), formatDate(row.claimed_at), row.transaction_id || "—"]) tr.append(textElement("td", text))
      table.append(tr)
    }
    const scroll = textElement("div", "", "mail-table-scroll")
    scroll.append(table)
    root.append(scroll)
    const nav = textElement("nav", "", "mail-pager")
    for (const [label, nextOffset, disabled] of [["上一頁", recipientOffset - 20, recipientOffset === 0], ["下一頁", recipientOffset + 20, result.items.length <= 20]]) {
      const button = textElement("button", label)
      button.disabled = disabled
      button.dataset.unavailable = String(disabled)
      button.addEventListener("click", () => { if (!busy) void loadRecipients(id, nextOffset) })
      nav.append(button)
    }
    root.append(nav)
  } catch (error) { if (current === recipientRevision) feedback(error.message) }
}

async function refreshHistory(nextOffset = 0) {
  if (!authorized || busy) return
  setBusy(true)
  offset = nextOffset
  try { await loadHistory(); feedback("紀錄已更新。") } catch (error) { feedback(error.message) }
  finally { setBusy(false) }
}
$("#previous").addEventListener("click", () => void refreshHistory(Math.max(0, offset - 20)))
$("#next").addEventListener("click", () => void refreshHistory(offset + 20))
$("#refresh").addEventListener("click", () => void refreshHistory())
$("#logout").addEventListener("click", signOut)

async function main() {
  const admin = await requireAdmin()
  if (!admin) return
  adminId = admin.user.id
  let invalidated = false
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id !== adminId) {
      invalidated = true
      authorized = false
      ++recipientRevision
      setBusy(false)
      $("#history").replaceChildren()
      $("#preview").replaceChildren()
      $("#recipients").replaceChildren()
      feedback("管理員登入已變更，請重新載入並驗證身分。")
    }
  })
  const { data, error } = await supabase.from("games").select("id,name,slug").order("name")
  if (invalidated) return
  if (error) { feedback("無法讀取遊戲清單，請重新載入頁面。表單尚未啟用。"); return }
  games = data || []
  for (const game of games) {
    const option = textElement("option", `${game.name} (${game.slug})`)
    option.value = game.id
    field("game_id").append(option)
  }
  authorized = true
  toggleFields()
  await refreshHistory()
}
void main().catch(error => feedback(error.message))
