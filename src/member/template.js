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
          <form id="email-form">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required />
            <div id="password-field">
              <label id="password-label" for="password">密碼</label>
              <input id="password" name="password" type="password" autocomplete="current-password" maxlength="128" required />
            </div>
            <div id="confirm-password-field" hidden>
              <label for="register-confirm-password">確認密碼</label>
              <input id="register-confirm-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" />
            </div>
            <p id="password-hint" class="account-note" hidden>請使用至少 10 個字元。</p>
            <div id="member-captcha" class="account-captcha" aria-label="安全驗證"></div>
            <button id="email-submit" class="account-primary" type="submit">登入</button>
          </form>
          <div id="provider-options">
            <div class="account-divider"><span>或</span></div>
            <button id="google-button" type="button" class="account-secondary">使用 Google 登入</button>
          </div>
          <button id="guest-button" type="button" class="account-secondary">先以訪客遊玩</button>
          <p id="guest-notice" class="account-note">訪客進度保留在目前瀏覽器。清除資料或換裝置後可能無法找回，建議稍後綁定帳號。</p>
          <div id="account-switch" class="account-switch">
            <span id="account-switch-prompt" hidden></span>
            <button id="register-button" type="button" class="account-text">建立帳號</button>
            <span id="account-switch-separator" aria-hidden="true">·</span>
            <button id="reset-button" type="button" class="account-text">忘記密碼</button>
          </div>
        </div>
        <div id="completion-panel" class="account-completion" tabindex="-1" hidden>
          <p id="completion-message"></p>
          <button id="completion-action" type="button" class="account-primary">返回登入</button>
        </div>
        <form id="new-password-form" hidden>
          <label for="new-password">設定密碼</label>
          <input id="new-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required />
          <label for="confirm-password">再次輸入密碼</label>
          <input id="confirm-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required />
          <p class="account-note">請使用至少 10 個字元。</p>
          <button type="submit" class="account-primary">儲存密碼</button>
        </form>
      </div>
    </section>
`
