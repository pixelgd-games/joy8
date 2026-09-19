import { memberCardMarkup } from "./template.js"
import { initMemberPanel } from "./page.js"

let dialog
let panel
let returnFocus

export async function openMemberModal(trigger, { next = "/", gameName = "", params } = {}) {
  if (!dialog) {
    dialog = document.createElement("dialog")
    dialog.id = "member-dialog"
    dialog.className = "member-dialog"
    dialog.setAttribute("aria-labelledby", "account-title")
    dialog.innerHTML = `<button class="member-dialog-close" type="button" aria-label="關閉登入視窗"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button><div class="member-dialog-content"></div>`
    document.body.append(dialog)
    dialog.querySelector(".member-dialog-close").addEventListener("click", closeModal)
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault()
      closeModal()
    })
    dialog.addEventListener("click", (event) => {
      const rect = dialog.getBoundingClientRect()
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeModal()
    })
  }
  if (dialog.open) return
  returnFocus = trigger
  const content = dialog.querySelector(".member-dialog-content")
  content.innerHTML = memberCardMarkup
  if (gameName) content.querySelector("#account-description").textContent = `遊玩「${gameName}」`
  document.body.classList.add("member-dialog-open")
  dialog.showModal()
  content.querySelector(".account-card").focus({ preventScroll: true })
  panel = initMemberPanel(content, {
    params: params ?? new URLSearchParams({ next }),
    onContinue: (path) => {
      closeModal()
      if (path !== "/") location.assign(path)
    },
  })
  await panel.ready
}

function closeModal() {
  panel?.dispose()
  panel = null
  dialog.close()
  document.body.classList.remove("member-dialog-open")
  returnFocus?.focus({ preventScroll: true })
}
