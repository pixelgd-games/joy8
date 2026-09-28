export const memberCardMarkup = `
    <section class="account-card" aria-labelledby="account-title" aria-busy="true" tabindex="-1">
      <div id="account-cover" class="account-cover" hidden></div>
      <header class="account-heading">
        <h1 id="account-title">登入開始遊戲</h1>
        <p id="account-description" class="muted">登入後即可遊玩所有遊戲，新會員可獲得 1,000 POINT。</p>
      </header>
      <p id="account-status" role="status" aria-live="polite" tabindex="-1">正在確認登入狀態…</p>
      <div id="account-actions" hidden>
        <div id="identity-summary" hidden>
          <p id="identity-label"></p>
          <a id="continue-link" class="account-primary" href="/" hidden>繼續遊玩</a>
          <button id="enroll-button" type="button" hidden>啟用玩家身分</button>
          <button id="signout-button" type="button" class="account-text">登出此裝置</button>
        </div>
        <div id="signin-options">
          <div class="account-provider-group">
            <button id="google-button" type="button" class="account-primary">
              <span class="account-button-icon account-google-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#ea4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z"/></svg>
              </span>
              <span id="google-label">使用 Google 繼續</span>
            </button>
          </div>
          <p class="account-note">目前為白名單測試期間，僅開放受邀的 Google 帳號。</p>
        </div>
      </div>
    </section>
`
