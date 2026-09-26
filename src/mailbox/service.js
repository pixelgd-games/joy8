export const mailKinds = { announcement: "公告", notification: "個人通知", reward: "活動獎勵", compensation: "異常補償" }
export const mailStatuses = { draft: "待發送", sent: "已發送", cancelled: "已取消" }
export const mailAudiences = { all: "全體現有玩家", game: "曾啟動指定遊戲的玩家", player: "指定玩家" }

const errors = {
  JOY8_MAIL_FORBIDDEN: "請先登入並確認玩家或管理員身分。",
  JOY8_MAIL_NOT_FOUND: "找不到這封信，請重新整理。",
  JOY8_MAIL_NO_REWARD: "這封信沒有可領取的 POINT。",
  JOY8_MAIL_NO_RECIPIENTS: "沒有符合條件的玩家，請確認收件對象。",
  JOY8_MAIL_AUDIENCE_LIMIT: "本次超過 5,000 位收件人，已停止建立，沒有寄出任何信件。",
  JOY8_MAIL_STATE_CONFLICT: "這封信的狀態已變更，請重新整理紀錄。",
  JOY8_IDEMPOTENCY_CONFLICT: "這筆操作的內容已變更，請重新整理後確認紀錄。",
  JOY8_WALLET_INACTIVE: "目前錢包無法領取，請聯絡客服。",
  JOY8_WALLET_OCCUPIED: "請先完成目前的牌局再領取，獎勵會繼續保留。",
  JOY8_INVALID_REQUEST: "資料格式不正確，請檢查填寫內容。",
  "User session is required": "請先登入再開啟信箱。",
  "User session is not valid": "登入已失效，請重新登入。",
  "Too many requests": "操作太頻繁，請稍後再試。",
}

export function createMailboxService(client, admin = false) {
  return async (action, request = {}) => {
    const { data, error } = await client.functions.invoke(`joy8-gateway/${admin ? "admin-mailbox" : "mailbox"}`, { body: { action, request } })
    if (error) {
      let code
      try { code = (await error.context?.json())?.error } catch {}
      throw new Error(errors[code] || "目前無法確認操作結果，請重新整理紀錄或重試；同一筆操作重試不會重複發送或入帳。")
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("回應不完整，請重新整理後再試。")
    return data
  }
}

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
