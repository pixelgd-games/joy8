import { mailKinds } from "./service.js"

export function textElement(tag, text, className = "") {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}

export const formatPoints = value => `${Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 0 })} POINT`
export const formatDate = value => value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "—"

export function renderMailDetail(root, mail) {
  root.replaceChildren(
    textElement("p", `${mailKinds[mail.kind]} · ${mail.game_name || "Joy8 平台"}`, "mail-kicker"),
    textElement("h2", mail.title),
    textElement("p", formatDate(mail.sent_at || mail.created_at), "mail-muted"),
    textElement("div", mail.body, "mail-body"),
  )
  if (Number(mail.amount) > 0) root.append(textElement("p", formatPoints(mail.amount), "mail-reward"))
}
