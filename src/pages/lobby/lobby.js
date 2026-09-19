export function renderLobby() {
  return `
    <div class="shell">
      <main class="lobby-page">
        <header class="site-header">
          <a class="brand-link" href="/" aria-label="Joy8 lobby">
            <span class="brand-mark">Joy8</span>
          </a>
          <div class="header-actions">
            <a class="member-login-link" href="/account/" aria-haspopup="dialog" aria-controls="member-dialog">登入</a>
            <button class="install-button" id="installAppButton" type="button" aria-expanded="false" aria-controls="installHelp" hidden>
              加入桌面
            </button>
            <div class="install-help" id="installHelp" role="status" hidden>
              <div class="install-help-title">加入手機桌面</div>
              <div class="install-help-copy">Chrome 請用右上角選單，Safari 請用分享按鈕，再選加入主畫面。</div>
            </div>
          </div>
        </header>

        <section class="hero" aria-labelledby="joy8HeroTitle">
          <img class="hero-image" src="/hero/joy8-hero-main.webp" alt="" loading="eager" decoding="async">
          <div class="hero-copy">
            <p class="hero-kicker">PLAY · DISCOVER · REPEAT</p>
            <h1 class="hero-title" id="joy8HeroTitle">Play more with Joy8.</h1>
            <p class="hero-description">Instant browser games, all in one place.</p>
            <a class="hero-action" href="#gamesSection">開始遊玩</a>
          </div>
        </section>

        <section class="content" id="gamesSection">
          <div class="section-head">
            <div>
              <p class="section-kicker">GAME LIST</p>
              <h2 class="section-title">Featured Games</h2>
            </div>
          </div>
          <div class="grid" id="gameGrid"></div>
        </section>
      </main>
    </div>
  `
}
