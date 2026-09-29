const ICONS = {
  back: "M15 5l-7 7 7 7",
  enter: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  exit: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
}

const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`

export const gameBarMarkup = `
  <header class="game-bar">
    <a class="game-bar__btn game-bar__back" href="/" data-bar="home">${svg("back")}回到大廳</a>
    <span class="game-bar__brand">JOY<span>8</span></span>
    <button class="game-bar__btn game-bar__fullscreen" type="button" data-bar="fullscreen" aria-label="全螢幕">${svg("enter")}</button>
  </header>`

export const gameConfirmMarkup = `
  <dialog class="game-confirm" aria-labelledby="gameConfirmTitle">
    <form class="game-confirm__card" method="dialog">
      <h2 id="gameConfirmTitle">確定要離開遊戲嗎？</h2>
      <p>離開後會回到 Joy8 大廳。</p>
      <div class="game-confirm__actions">
        <button class="game-confirm__stay" value="stay">繼續遊戲</button>
        <button class="game-confirm__leave" value="leave">回到大廳</button>
      </div>
    </form>
  </dialog>`

export function setupGameBar() {
  const bar = document.querySelector(".game-bar")
  const confirm = document.querySelector(".game-confirm")
  const fullscreen = bar.querySelector("[data-bar=fullscreen]")

  const syncFullscreen = () => {
    const active = Boolean(document.fullscreenElement)
    fullscreen.innerHTML = svg(active ? "exit" : "enter")
    fullscreen.setAttribute("aria-label", active ? "離開全螢幕" : "全螢幕")
  }

  fullscreen.hidden = !document.fullscreenEnabled
  bar.addEventListener("click", (event) => {
    const action = event.target.closest("[data-bar]")?.dataset.bar
    if (action === "home") {
      event.preventDefault()
      confirm.returnValue = ""
      confirm.showModal()
    }
    if (action === "fullscreen") {
      void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})
    }
  })
  confirm.addEventListener("close", () => {
    if (confirm.returnValue === "leave") location.assign("/")
  })
  document.addEventListener("fullscreenchange", syncFullscreen)
}
