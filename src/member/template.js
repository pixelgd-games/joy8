export const memberCardMarkup = `
    <section class="account-card" aria-labelledby="account-title" aria-busy="true">
      <h1 id="account-title">登入</h1>
      <p id="account-description" class="muted" hidden></p>
      <p id="account-status" role="status" aria-live="polite" tabindex="-1">正在確認登入狀態…</p>
      <div id="account-actions" hidden>
        <div id="identity-summary" hidden>
          <p id="identity-label"></p>
          <a id="continue-link" class="account-primary" href="/" hidden>繼續遊玩</a>
          <button id="enroll-button" type="button" hidden>啟用玩家身分</button>
          <button id="signout-button" type="button" class="account-text">登出此裝置</button>
        </div>
        <div id="signin-options">
          <button id="google-button" type="button" class="account-primary">使用 Google 登入</button>
          <div id="member-captcha" class="account-captcha" aria-label="安全驗證"></div>
          <button id="guest-button" type="button" class="account-secondary">先以訪客遊玩</button>
          <p id="guest-notice" class="account-note">訪客進度保留在目前瀏覽器。清除資料或換裝置後可能無法找回，建議稍後綁定 Google。</p>
        </div>
      </div>
    </section>
`
