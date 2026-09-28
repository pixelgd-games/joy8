import { icon } from "./icons.js"

export function maskEmail(email) {
  const [name, domain] = String(email || "").split("@")
  if (!name || !domain) return "—"
  return `${name.slice(0, 1)}***@${domain}`
}

export function createMemberMenu(root, { onAction }) {
  const trigger = root.querySelector(".account")
  const profile = document.createElement("div")
  profile.className = "profile"
  profile.id = "memberProfile"
  profile.setAttribute("role", "dialog")
  profile.setAttribute("aria-label", "會員資料")
  profile.hidden = true
  profile.innerHTML = `
    <div class="profile__head">
      <span class="profile__avatar">P</span>
      <div>
        <div class="profile__name" data-player-name></div>
        <div class="profile__type">${icon("google")}Google 會員</div>
      </div>
    </div>
    <div class="profile__balance">
      <span>POINT 餘額</span>
      <strong>${icon("coin")}<span data-wallet>—</span></strong>
    </div>
    <dl class="profile__rows">
      <div><dt>玩家 ID</dt><dd><span data-profile="id"></span><button class="profile__copy" type="button" data-action="copy-id">複製</button></dd></div>
      <div><dt>登入方式</dt><dd>Google</dd></div>
      <div><dt>Google 帳號</dt><dd data-profile="email"></dd></div>
      <div><dt>加入日期</dt><dd data-profile="joined"></dd></div>
    </dl>
    <div class="profile__actions">
      <button class="btn btn--ghost" type="button" data-action="mail">${icon("mail")}信箱<span data-unread-text></span></button>
      <button class="btn btn--ghost" type="button" data-action="logout">${icon("logout")}登出</button>
    </div>`
  trigger.parentElement.append(profile)

  const setOpen = (open) => {
    profile.hidden = !open
    trigger.setAttribute("aria-expanded", String(open))
  }

  document.addEventListener("click", (event) => {
    if (!profile.hidden && !event.target.closest(".account-wrap")) setOpen(false)
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !profile.hidden) {
      setOpen(false)
      trigger.focus()
    }
  })
  profile.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action
    if (!action) return
    event.stopPropagation()
    if (action !== "copy-id") setOpen(false)
    onAction(action, event.target.closest("[data-action]"))
  })

  return {
    toggle: () => setOpen(profile.hidden),
    close: () => setOpen(false),
    render({ publicId, email, joinedAt }) {
      profile.querySelector("[data-profile=id]").textContent = publicId
      profile.querySelector("[data-profile=email]").textContent = maskEmail(email)
      profile.querySelector("[data-profile=joined]").textContent = joinedAt
        ? new Date(joinedAt).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" })
        : "—"
    },
  }
}
