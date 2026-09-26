import "./style.css"
import { memberSupabase } from "../lib/memberClient.js"
import { createMailboxService, formatDate, mailKinds, renderMailDetail, textElement } from "./service.js"

const api = createMailboxService(memberSupabase)
const $ = selector => document.querySelector(selector)
let offset = 0
let revision = 0
let selected = null
let busy = false
let userId = null

function clearDetail() {
  selected = null
  $("#detail").replaceChildren(textElement("p", "選擇一封信，查看內容與獎勵。", "mail-muted"))
}

async function load() {
  const current = ++revision
  clearDetail()
  $("#status").textContent = "正在讀取信箱…"
  $("#previous").disabled = $("#next").disabled = true
  try {
    const { data, error } = await memberSupabase.auth.getSession()
    if (current !== revision) return
    if (error || !data.session) {
      $("#mail-list").replaceChildren()
      $("#login").hidden = false
      $("#status").textContent = "請先登入 Joy8，再查看你的信件。"
      return
    }
    userId = data.session.user.id
    const result = await api("list", { offset })
    if (current !== revision) return
    $("#login").hidden = true
    $("#status").textContent = result.unread ? `你有 ${result.unread} 封未讀信件。` : "所有信件都已讀取。"
    $("#mail-list").replaceChildren()
    if (!result.items.length) $("#mail-list").append(textElement("p", "目前沒有信件。", "mail-empty"))
    for (const mail of result.items.slice(0, 20)) {
      const button = textElement("button", "", "mail-list-item")
      button.type = "button"
      button.append(textElement("span", `${mail.read_at ? "" : "● 未讀 · "}${mailKinds[mail.kind]}`, "mail-kicker"), textElement("strong", mail.title),
        textElement("span", `${formatDate(mail.sent_at)}${Number(mail.amount) ? mail.claimed_at ? " · 已領取" : " · 待領取" : ""}`, "mail-muted"))
      button.addEventListener("click", () => { if (!busy) void openMail(mail, button) })
      $("#mail-list").append(button)
    }
    $("#page-number").textContent = String(offset / 20 + 1)
    $("#previous").disabled = offset === 0
    $("#next").disabled = result.items.length <= 20
  } catch (error) {
    if (current === revision) {
      $("#mail-list").replaceChildren()
      $("#status").textContent = error.message
      $("#login").hidden = false
    }
  }
}

async function openMail(mail, button) {
  const current = revision
  selected = mail.id
  renderMailDetail($("#detail"), mail)
  $("#detail").focus()
  const message = textElement("p", "", "mail-muted")
  message.setAttribute("role", "status")
  $("#detail").append(message)
  if (Number(mail.amount) > 0) {
    const claim = textElement("button", mail.claimed_at ? "已領取" : "領取 POINT", "mail-primary")
    claim.disabled = Boolean(mail.claimed_at)
    claim.addEventListener("click", async () => {
      if (busy) return
      busy = true
      claim.disabled = true
      try {
        const result = await api("claim", { id: mail.id })
        if (current !== revision || selected !== mail.id) return
        mail.claimed_at = result.claimed_at
        claim.textContent = "已領取"
        message.textContent = "POINT 已加入你的 Joy8 共享錢包。"
        button.lastChild.textContent = `${formatDate(mail.sent_at)} · 已領取`
      } catch (error) {
        if (current === revision && selected === mail.id) { message.textContent = error.message; claim.disabled = false }
      } finally { busy = false }
    })
    $("#detail").append(claim)
  }
  try {
    const result = await api("read", { id: mail.id })
    if (current !== revision) return
    const wasUnread = !mail.read_at
    mail.read_at = result.read_at
    button.firstChild.textContent = mailKinds[mail.kind]
    if (wasUnread) $("#status").textContent = "信件已讀取。"
  } catch (error) {
    if (current === revision && selected === mail.id) message.textContent = error.message
  }
}

$("#refresh").addEventListener("click", () => { if (!busy) { offset = 0; void load() } })
$("#previous").addEventListener("click", () => { if (!busy) { offset = Math.max(0, offset - 20); void load() } })
$("#next").addEventListener("click", () => { if (!busy) { offset += 20; void load() } })
memberSupabase.auth.onAuthStateChange((_event, session) => {
  const nextId = session?.user?.id ?? null
  if (nextId !== userId) {
    userId = nextId
    ++revision
    $("#mail-list").replaceChildren()
    clearDetail()
    offset = 0
    setTimeout(() => void load(), 0)
  }
})
void load()
