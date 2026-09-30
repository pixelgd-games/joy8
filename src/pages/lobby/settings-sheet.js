import { icon } from "./icons.js"
import { canOfferInstall, promptInstall } from "./install.js"

export function createSettingsSheet({ toast, onAction }) {
  const dialog = document.createElement("dialog")
  dialog.className = "sheet sheet--settings"
  dialog.setAttribute("aria-labelledby", "settingsTitle")
  dialog.innerHTML = `
    <div class="sheet__panel" tabindex="-1">
      <header class="sheet__head">
        <h2 class="sheet__title" id="settingsTitle">設定</h2>
        <span class="sheet__sub"></span>
        <button class="sheet__icon" type="button" data-setting="close" aria-label="關閉">${icon("close")}</button>
      </header>
      <div class="sheet__body">
        <section class="setting-group">
          <h3 class="setting-group__title">聲音</h3>
          <div class="setting-row"><span>音效</span><button class="switch" type="button" role="switch" aria-checked="true" data-setting="toggle" aria-label="音效"></button></div>
          <div class="setting-row"><span>背景音樂</span><button class="switch" type="button" role="switch" aria-checked="true" data-setting="toggle" aria-label="背景音樂"></button></div>
        </section>
        <section class="setting-group">
          <h3 class="setting-group__title">語言</h3>
          <div class="segmented" role="radiogroup" aria-label="語言">
            <button class="segmented__item is-active" type="button" role="radio" aria-checked="true" data-setting="language">繁體中文</button>
            <button class="segmented__item" type="button" role="radio" aria-checked="false" data-setting="language">English</button>
          </div>
        </section>
        <section class="setting-group member-only">
          <h3 class="setting-group__title">帳號</h3>
          <div class="setting-account">
            <span class="account__avatar">P</span>
            <span class="setting-account__meta"><strong data-player-name></strong><span data-settings-id></span></span>
            <button class="btn btn--ghost" type="button" data-setting="logout">${icon("logout")}登出</button>
          </div>
        </section>
        <section class="setting-group">
          <h3 class="setting-group__title">其他</h3>
          <a class="setting-link" href="#" data-setting="link">服務條款${icon("chev")}</a>
          <a class="setting-link" href="#" data-setting="link">隱私權政策${icon("chev")}</a>
          <a class="setting-link" href="#" data-setting="link">聯絡客服${icon("chev")}</a>
          ${canOfferInstall() ? `<button class="setting-link" type="button" data-setting="install" aria-expanded="false" aria-controls="installHelp">加入桌面${icon("chev")}</button>
          <p class="setting-help" id="installHelp" hidden>Chrome 請用右上角選單，Safari 請用下方分享按鈕，再選「加入主畫面」。</p>` : ""}
        </section>
      </div>
    </div>`
  document.body.append(dialog)

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) return dialog.close()
    const control = event.target.closest("[data-setting]")
    if (!control) return
    if (control.tagName === "A") event.preventDefault()
    const action = control.dataset.setting
    if (action === "close") dialog.close()
    if (action === "toggle") control.setAttribute("aria-checked", String(control.getAttribute("aria-checked") !== "true"))
    if (action === "language" && !control.classList.contains("is-active")) toast("English 版本即將開放，敬請期待")
    if (action === "logout") {
      dialog.close()
      onAction("logout", control)
    }
    if (action === "link") onAction("link", control)
    if (action === "install") void install(control)
  })

  async function install(control) {
    const help = dialog.querySelector("#installHelp")
    control.disabled = true
    try {
      const accepted = await promptInstall()
      if (accepted) {
        control.remove()
        help.remove()
      } else if (accepted === null) {
        help.hidden = !help.hidden
        control.setAttribute("aria-expanded", String(!help.hidden))
      }
    } finally {
      control.disabled = false
    }
  }

  return {
    open() {
      if (dialog.open) return
      dialog.showModal()
      dialog.querySelector(".sheet__panel").focus({ preventScroll: true })
    },
    render({ publicId }) {
      dialog.querySelector("[data-settings-id]").textContent = `Google 會員 · ID ${publicId}`
    },
  }
}
