import { ICON_SPRITE, icon } from "./icons.js"
import { NOTICES, PROMO, SOCIAL } from "./content.js"

const brand = `<a class="brand" href="/" data-action="home" aria-label="Joy8 大廳">JOY<span>8</span></a>`
const loginButton = `<button class="btn btn--primary guest-only member-login-link" type="button" data-action="login" aria-haspopup="dialog" aria-controls="member-dialog">登入</button>`
const mailButton = `<button class="icon-btn" type="button" data-action="mail" aria-label="信箱">${icon("mail")}<span class="badge" data-unread hidden></span></button>`
const settingsButton = `<button class="icon-btn" type="button" data-action="settings" aria-label="設定">${icon("gear")}</button>`
const heroTrack = `<div class="hero__track" data-hero-track></div><div class="hero__dots" data-hero-dots></div>`
const noticeItems = NOTICES.map(notice => `<li>${noticeMarkup(notice)}</li>`).join("")
const socialLinks = SOCIAL.map(item => `<a class="social__link" href="#" data-action="social" aria-label="${item.label}">${icon(item.icon)}</a>`).join("")
const pointNote = "POINT 僅供平台內遊戲娛樂使用，不可提領、轉讓或兌換現金。"
const footLinks = `<a href="#" data-action="link">服務條款</a><a href="#" data-action="link">隱私權政策</a><a href="#" data-action="link">聯絡我們</a>`
const footerCopy = `
  <p>${pointNote}</p>
  <p class="site-foot__links">${footLinks}</p>
  <p>© Joy8</p>`
const shelf = `
  <section class="shelf" id="gamesSection" aria-labelledby="gamesTitle">
    <header class="shelf__head">
      <h2 class="shelf__title" id="gamesTitle">全部遊戲</h2>
      <span class="shelf__count" data-grid-count></span>
    </header>
    <div class="grid" id="gameGrid" aria-busy="true"></div>
  </section>`

export function noticeMarkup(notice) {
  return `<span class="notice__tag${notice.fresh ? " notice__tag--new" : ""}">${notice.tag}</span><span>${notice.text}</span>`
}

export function renderLobby(layout) {
  return ICON_SPRITE + (layout === "mobile" ? mobileMarkup() : pcMarkup())
}

function pcMarkup() {
  return `
    <header class="topbar">
      <div class="topbar__inner">
        <div class="topbar__left">
          ${brand}
          <button class="reward" type="button" data-action="daily">
            <span class="reward__icon">${icon("gift")}</span>
            <span class="reward__label">每日獎勵</span>
          </button>
        </div>
        <div class="topbar__right">
          <div class="account-wrap member-only">
            <button class="account" type="button" data-action="profile" aria-haspopup="dialog" aria-expanded="false" aria-controls="memberProfile">
              <span class="account__avatar">P</span>
              <span class="account__name" data-player-name></span>
            </button>
          </div>
          <div class="wallet member-only" aria-label="POINT 餘額">
            ${icon("coin").replace("<svg", '<svg class="wallet__coin"')}
            <span class="wallet__amount" data-wallet>—</span>
            <span class="wallet__unit">POINT</span>
          </div>
          ${loginButton}
          <button class="store" type="button" data-action="store">${icon("bag")}商城</button>
          ${mailButton}
          ${settingsButton}
        </div>
      </div>
    </header>
    <aside class="side" aria-label="活動與公告">
      <a class="promo" href="#" data-action="promo"><img src="${PROMO.src}" alt="${PROMO.alt}" width="540" height="960" decoding="async"></a>
      <section class="notice" aria-labelledby="noticeTitle">
        <h2 class="notice__title" id="noticeTitle">最新公告</h2>
        <ul class="notice__list">${noticeItems}</ul>
      </section>
    </aside>
    <main class="stage">
      <section class="wrap">
        <div class="hero" aria-roledescription="carousel" aria-label="主視覺">
          ${heroTrack}
          <button class="hero__arrow hero__arrow--prev" type="button" data-hero="prev" aria-label="上一張">${icon("chev")}</button>
          <button class="hero__arrow hero__arrow--next" type="button" data-hero="next" aria-label="下一張">${icon("chev")}</button>
        </div>
      </section>
      <div class="wrap lobby">${shelf}</div>
    </main>
    <footer class="site-bar">
      <p class="site-bar__links"><span>© Joy8</span>${footLinks}</p>
      <p class="site-bar__note">${pointNote}</p>
      <div class="social__links" aria-label="社群平台">${socialLinks}</div>
    </footer>
    <div class="toast" role="status" aria-live="polite" data-toast></div>`
}

function mobileMarkup() {
  return `
    <header class="topbar">
      ${brand}
      <div class="account-wrap member-only">
        <button class="account" type="button" data-action="profile" aria-haspopup="dialog" aria-expanded="false" aria-controls="memberProfile" aria-label="會員資料">
          <span class="account__avatar">P</span>
        </button>
      </div>
      <button class="wallet member-only" type="button" data-action="store" aria-label="POINT 餘額，前往商城">
        ${icon("coin").replace("<svg", '<svg class="wallet__coin"')}
        <span class="wallet__amount" data-wallet>—</span>
        <span class="wallet__plus">${icon("plus")}</span>
      </button>
      ${loginButton}
      <button class="icon-btn guest-only" type="button" data-action="store" aria-label="商城">${icon("bag")}</button>
      ${mailButton}
      ${settingsButton}
    </header>
    <button class="float-reward" type="button" data-action="daily" aria-label="每日獎勵">
      <span class="float-reward__icon">${icon("gift")}</span>
    </button>
    <main>
      <div class="hero" aria-roledescription="carousel" aria-label="主視覺">${heroTrack}</div>
      <details class="ticker">
        <summary class="ticker__bar">
          <span class="ticker__text" data-ticker></span>
          ${icon("chev").replace("<svg", '<svg class="ticker__chev"')}
        </summary>
        <ul class="ticker__list">${noticeItems}</ul>
      </details>
      ${shelf}
      <footer class="site-foot">
        <div class="social" aria-label="社群平台">
          <span class="social__label">關注 Joy8</span>
          <div class="social__links">${socialLinks}</div>
        </div>
        ${footerCopy}
      </footer>
    </main>
    <div class="toast" role="status" aria-live="polite" data-toast></div>`
}
