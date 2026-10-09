import { mailKinds } from "../../mailbox/service.js"
import { icon } from "./icons.js"
import { formatPoint } from "../../lib/format.js"

const PAGE_SIZE = 20
const KIND_STYLE = {
  reward: { icon: "gift", tone: "gold" },
  compensation: { icon: "shield", tone: "green" },
  announcement: { icon: "megaphone", tone: "primary" },
  notification: { icon: "bell", tone: "muted" },
}

const formatDay = value => value ? new Date(value).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—"

export function createMailSheet({ api, toast, onUnread, onClaimed }) {
  const dialog = document.createElement("dialog")
  dialog.className = "sheet sheet--mail"
  dialog.setAttribute("aria-labelledby", "mailTitle")
  dialog.innerHTML = `
    <div class="sheet__panel" tabindex="-1">
      <header class="sheet__head">
        <button class="sheet__icon sheet__back" type="button" data-mail="back" aria-label="返回信件列表" hidden>${icon("chev")}</button>
        <h2 class="sheet__title" id="mailTitle" data-mail-heading>信箱</h2>
        <span class="sheet__sub" data-mail-sub role="status"></span>
        <button class="sheet__icon" type="button" data-mail="close" aria-label="關閉">${icon("close")}</button>
      </header>
      <div class="sheet__body">
        <ul class="mail-list" data-mail-list></ul>
        <button class="btn btn--ghost mail-more" type="button" data-mail="more" hidden>載入更多</button>
        <article class="mail-detail" data-mail-detail hidden></article>
      </div>
    </div>`
  document.body.append(dialog)

  const $ = selector => dialog.querySelector(selector)
  const list = $("[data-mail-list]")
  const detail = $("[data-mail-detail]")
  const more = $("[data-mail=more]")
  let mails = []
  let offset = 0
  let unread = 0
  let hasMore = false
  let revision = 0
  let busy = false
  let loading = false
  let firstPage = null
  let pendingPage = null

  function readFirstPage() {
    if (!pendingPage) {
      const request = api("list", { offset: 0 })
      pendingPage = request
      void request.finally(() => { if (pendingPage === request) pendingPage = null }).catch(() => {})
    }
    return pendingPage
  }

  const setUnread = (count) => {
    unread = Math.max(0, Number(count) || 0)
    $("[data-mail-sub]").textContent = unread ? `${unread} 封未讀` : "沒有未讀信件"
    onUnread(unread)
  }

  const kindStyle = mail => KIND_STYLE[mail.kind] || KIND_STYLE.notification
  const kindIcon = mail => {
    const node = element("span", `mail-item__icon tone-${kindStyle(mail).tone}`)
    node.innerHTML = icon(kindStyle(mail).icon)
    return node
  }
  const hasReward = mail => Number(mail.amount) > 0

  function itemNode(mail) {
    const button = element("button", `mail-item${mail.read_at ? "" : " is-unread"}`)
    button.type = "button"
    button.dataset.id = mail.id
    const top = element("span", "mail-item__top")
    top.append(element("span", "mail-item__tag", mailKinds[mail.kind] || "通知"), element("span", "mail-item__date", formatDay(mail.sent_at)))
    const main = element("span", "mail-item__main")
    main.append(top, element("span", "mail-item__title", mail.title), element("span", "mail-item__snippet", mail.body))
    button.append(kindIcon(mail), main)
    if (hasReward(mail)) {
      button.append(mail.claimed_at
        ? element("span", "mail-item__chip is-done", "已領取")
        : element("span", "mail-item__chip", `+${formatPoint(mail.amount)}`))
    }
    const item = document.createElement("li")
    item.append(button)
    return item
  }

  function showList() {
    list.replaceChildren(...mails.map(itemNode))
    if (!mails.length) list.append(stateNode("目前沒有信件。"))
    list.hidden = false
    more.hidden = !hasMore
    detail.hidden = true
    $(".sheet__back").hidden = true
    $("[data-mail-heading]").textContent = "信箱"
  }

  function stateNode(text) {
    return element("li", "mail-state", text)
  }

  async function load(append = false) {
    if (loading || busy) return
    loading = true
    const current = ++revision
    const nextOffset = append ? offset + PAGE_SIZE : 0
    if (!append) {
      offset = 0
      mails = []
      hasMore = false
      showList()
      list.replaceChildren(stateNode("正在讀取信箱…"))
    }
    more.hidden = true
    try {
      const result = append ? await api("list", { offset: nextOffset })
        : firstPage && Date.now() - firstPage.at < 30000 ? firstPage.result : await readFirstPage()
      if (current !== revision) return
      offset = nextOffset
      if (!append) firstPage = { result, at: Date.now() }
      const items = Array.isArray(result.items) ? result.items : []
      mails = mails.concat(items.slice(0, PAGE_SIZE))
      hasMore = items.length > PAGE_SIZE
      setUnread(result.unread)
      showList()
      more.textContent = "載入更多"
    } catch (error) {
      if (current !== revision) return
      showList()
      list.append(stateNode(error.message))
      more.textContent = "重試載入"
      more.hidden = false
    } finally {
      if (current === revision) loading = false
    }
  }

  function showMail(mail) {
    const current = revision
    const meta = element("div", "mail-detail__meta")
    meta.append(kindIcon(mail), element("span", "mail-item__tag", mailKinds[mail.kind] || "通知"), element("span", "mail-item__date", formatDay(mail.sent_at)))
    const note = element("p", "mail-reward__note")
    note.setAttribute("role", "status")
    detail.replaceChildren(meta, element("h3", "mail-detail__title", mail.title), element("p", "mail-detail__body", mail.body))
    if (mail.game_name) detail.append(element("p", "mail-detail__game", `相關遊戲：${mail.game_name}`))
    if (hasReward(mail)) {
      const reward = element("div", "mail-reward")
      const amount = element("span", "mail-reward__amount")
      amount.innerHTML = icon("coin")
      amount.append(formatPoint(mail.amount), element("small", "", "POINT"))
      const claim = element("button", mail.claimed_at ? "btn btn--done" : "btn btn--gold", mail.claimed_at ? "已領取" : "領取 POINT")
      claim.type = "button"
      claim.disabled = Boolean(mail.claimed_at)
      note.textContent = mail.claimed_at ? "POINT 已存入你的 Joy8 錢包" : "領取前請先結束進行中的遊戲牌局"
      claim.addEventListener("click", async () => {
        if (busy || mail.claimed_at) return
        busy = true
        claim.disabled = true
        try {
          const result = await api("claim", { id: mail.id })
          if (current !== revision) return
          mail.claimed_at = result.claimed_at
          firstPage = null
          if (!mail.read_at) setUnread(unread - 1)
          mail.read_at = mail.read_at || result.claimed_at
          claim.className = "btn btn--done"
          claim.textContent = "已領取"
          note.textContent = "POINT 已存入你的 Joy8 錢包"
          toast(`已領取 ${formatPoint(mail.amount)} POINT`)
          onClaimed()
        } catch (error) {
          if (current !== revision) return
          note.textContent = error.message
          claim.disabled = false
        } finally {
          if (current === revision) busy = false
        }
      })
      reward.append(amount, claim)
      detail.append(reward, note)
    } else {
      detail.append(note)
    }
    list.hidden = true
    more.hidden = true
    detail.hidden = false
    $(".sheet__back").hidden = false
    $("[data-mail-heading]").textContent = "信件內容"
    $(".sheet__panel").focus({ preventScroll: true })
    if (!mail.read_at) {
      api("read", { id: mail.id }).then((result) => {
        if (current !== revision || mail.read_at) return
        mail.read_at = result.read_at
        firstPage = null
        setUnread(unread - 1)
      }, (error) => {
        if (current === revision && !note.textContent) note.textContent = error.message
      })
    }
  }

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) return dialog.close()
    const control = event.target.closest("[data-mail]")
    const item = event.target.closest(".mail-item")
    if (control?.dataset.mail === "close") dialog.close()
    if (control?.dataset.mail === "back") showList()
    if (control?.dataset.mail === "more" && !busy) {
      void load(mails.length > 0)
    }
    if (item) {
      const mail = mails.find(entry => entry.id === item.dataset.id)
      if (mail) showMail(mail)
    }
  })

  return {
    open() {
      if (dialog.open) return
      dialog.showModal()
      $(".sheet__panel").focus({ preventScroll: true })
      void load()
    },
    close() {
      if (dialog.open) dialog.close()
    },
    prime(result) {
      if (!result || typeof result !== "object" || Array.isArray(result)) return
      firstPage = { result, at: Date.now() }
      setUnread(result.unread)
    },
    async refreshUnread() {
      const current = revision
      try {
        const result = await readFirstPage()
        if (current === revision) {
          firstPage = { result, at: Date.now() }
          setUnread(result.unread)
        }
      } catch {}
    },
    reset() {
      ++revision
      busy = false
      loading = false
      firstPage = null
      pendingPage = null
      mails = []
      hasMore = false
      if (dialog.open) dialog.close()
      list.replaceChildren()
      detail.replaceChildren()
      showList()
      setUnread(0)
    },
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
