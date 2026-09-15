# Looty Member and Authentication Plan

這份文件記錄 Looty 的會員、登入、Guest 與帳號生命週期規劃。

遊戲啟動、Gateway、game session 與錢包呼叫契約仍以
`GAME_PLATFORM_INTEGRATION.md` 為準；目前 repo 的實作狀態以
`../../README.md` 為準。

最後更新：2026-09-15。

## 目標

- Mahjong Clash 可以在完整 Looty Lobby 公開以前先獨立營運。
- 玩家在麻將品牌的 H5、Android 或 iOS 大廳完成登入。
- 底層統一使用 Looty 的會員身份、`player_accounts`、平台錢包與 session。
- 未來玩家改從 Looty Lobby 進入時，仍是同一個玩家、同一個錢包，並保留麻將資料。
- 登入能力可以重用到其他 Looty 遊戲，不做成麻將專屬會員系統。

## 目前狀態

- Looty 已有 Supabase Auth 與平台資料表骨架。
- Admin 的 Google OAuth 已可使用，但它是管理員登入，不等於玩家登入。
- Gateway 沒有收到有效會員 token 時可以建立 Guest，但目前每次啟動可能建立新的 Guest、玩家與錢包。
- 公開 Looty Lobby 的玩家登入入口目前維持停用。
- 持久 Guest、玩家登入 UI、Guest 升級、Provider linking、App deep link 與帳號刪除尚未實作。

## 第一階段範圍

第一階段只做足以讓直接遊戲入口安全營運的最小會員核心：

- 快速登入，也就是可持續使用的 Guest。
- 首發核准的正式登入方式。
- Guest 升級正式帳號。
- 同一玩家身份與錢包的保存。
- 登入狀態、登出、必要的帳號復原與帳號刪除入口。
- H5、Android、iOS 的登入返回與 session 保存。
- 登入成功後建立 Looty game session 與一次性 launch code。

第一階段不做：

- 完整 Looty 會員中心。
- 社群、好友、邀請或好友房帳號功能。
- 讓遊戲保存密碼、Provider token 或 Supabase service role key。
- 讓前端直接修改玩家或錢包資料表。
- 跨兩個既有正式帳號的完整自動資料合併。

## 可行登入方式

下列方式技術上都可以整合，但不代表第一版全部啟用：

| 方式 | 用途 | 第一版注意事項 |
| --- | --- | --- |
| 快速登入 | 不註冊先玩 | 必須是持久 Guest，不能每次啟動都換玩家與錢包。 |
| Google | 常用正式登入 | H5 與 App 要分別設定核准的返回網址。 |
| LINE | 台灣玩家常用登入 | 透過 LINE OAuth / OIDC 串入 Looty 身份層。 |
| Apple | iOS 正式登入 | iOS 若提供其他第三方登入，需一併納入 App Store 規則評估。 |
| Email + 密碼 | 一般帳號 | 需要信箱驗證、忘記密碼與密碼安全流程。 |
| Email OTP | 免密碼信箱登入 | 可作為 Email + 密碼的替代方案，首發是否使用尚未決定。 |

## 身份資料原則

- Supabase Auth 管理登入憑證與 Provider identity。
- `player_accounts` 是 Looty 的正式玩家主鍵來源。
- Guest 與正式帳號都必須對應 `player_accounts`。
- `wallet_accounts` 必須綁定 Looty 玩家，不綁定遊戲內暱稱或裝置名稱。
- 麻將戰績與遊戲資料使用同一個 Looty player id 建立對應，不另建會員主檔。
- 顯示名稱、Email 或相似暱稱都不能當成自動合併帳號的依據。

```text
Supabase Auth identity
  -> Looty player_account
    -> Looty wallet_account
    -> Mahjong player mapping and game data
```

## Guest 規則

- 玩家選擇快速登入時，Looty 建立或恢復同一個 Guest 身份。
- 同一個有效安裝或瀏覽器 session 再次開啟遊戲時，應恢復原玩家與錢包。
- Guest 未升級前，不保證清除瀏覽器資料、移除 App 或更換裝置後仍可找回。
- 介面必須提醒 Guest 升級正式帳號，才能可靠跨裝置復原。
- Guest 保存期限與實際使用 Supabase anonymous sign-in 或過渡 token，施工前再決定。

## Guest 升級與身份連結

Guest 升級的核心規則是「換登入方式，不換玩家」。

- 保留同一筆 `player_accounts.id`。
- 保留原平台錢包與交易流水。
- 保留麻將戰績、對局資料與其他遊戲資料。
- 將核准的 Google、LINE、Apple 或 Email identity 連到原玩家。
- 升級流程必須由 Looty Auth / backend 處理，遊戲只能接收結果。

若 Provider identity 已屬於另一個玩家：

- 不可只憑 Email、名稱或前端參數自動合併。
- 停止升級，要求玩家先驗證既有帳號。
- 第一版只做必要的衝突提示與安全返回；完整帳號合併另行規劃。

## 帳號生命週期

### 登出

- 登出只清除目前裝置的登入 session，不刪除玩家、錢包或遊戲資料。
- 登出後不得自動把正式帳號變成新的 Guest；玩家要再次選擇登入方式。

### 帳號復原

- Email + 密碼需要忘記密碼與重設流程。
- Google、LINE、Apple 使用各 Provider 的復原流程。
- Guest 沒有正式身份時，只能依仍有效的本機登入狀態恢復。

### 帳號刪除

- Android、iOS 與 H5 都要能找到刪除帳號入口；iOS 上架前要確認符合當期 App Store 規則。
- 刪除必須由 Looty backend 執行，不讓遊戲直接刪除 Auth、玩家或錢包資料。
- Auth identity、個人資料、錢包紀錄、麻將資料與依法或查帳需要保留的紀錄要分開定義。
- 真正的刪除範圍、等待期、復原期與保留期限，正式施工前確認。

## H5、Android 與 iOS

三種入口共用同一套 Looty 身份與後端流程，只調整返回方式：

- H5：使用核准的 HTTPS return URL。
- Android：使用核准的 App link 或 deep link，並驗證返回來源與 state。
- iOS：使用核准的 Universal Link 或 callback，並驗證返回來源與 state。
- App 重新啟動後，應能恢復仍有效的 Looty 登入 session。
- Provider token、密碼、launch code 與 gateway token 不寫入網址紀錄、Analytics 或一般 log。
- 一次性 launch code 與短效 gateway token 仍依 `GAME_PLATFORM_INTEGRATION.md` 管理。

## 麻將品牌登入畫面

玩家可以在麻將品牌大廳看到：

- 快速登入按鈕。
- 首發核准的正式登入按鈕。
- 登入中、登入失敗與返回遊戲的狀態。
- 玩家顯示名稱與基本登入狀態。
- 升級帳號、登出與刪除帳號入口。

這個畫面是 Looty 可重用的會員入口元件套上麻將品牌，不是麻將自己擁有會員資料。麻將 gameplay runtime 與 Game Server 不處理第三方登入憑證。

## 登入後進入遊戲

```text
Mahjong-branded lobby
  -> Looty login or persistent Guest restore
  -> resolve the same player_account and wallet_account
  -> Looty create-session
  -> one-time launch code
  -> Mahjong client exchanges for a short-lived gateway token
  -> Mahjong authoritative server and game data
```

未來從 Looty Lobby 啟動時，從 `create-session` 開始重用同一條流程，不搬移會員、錢包或麻將資料。

## 建議施工順序

1. 決定第一版登入方式。
2. 決定 Guest 保存期限與升級／衝突規則。
3. 決定登出、帳號復原、刪除與資料保留規則。
4. 定義 H5、Android、iOS 的 return URL / deep link。
5. 設計可重用的 Looty 登入元件與平台 API。
6. 用小步 migration 補齊 Auth、`player_accounts` 與錢包的關係；遠端執行前先讓使用者確認。
7. 調整 Gateway，讓同一玩家可恢復同一錢包並建立 game session。
8. 實作登入、Guest 恢復、升級、登出與刪除流程。
9. 驗證 H5、Android 與 iOS 的返回及 session 保存。
10. 完成身份與錢包測試後，再切到 Mahjong Clash 專案做遊戲端串接。

## 驗收條件

- Guest 關閉再開後仍是同一玩家與錢包。
- Guest 升級正式帳號後，玩家 id、錢包與麻將資料不變。
- 同一正式帳號可在 H5、Android 與 iOS 解析到同一玩家。
- 重複登入、回呼重送或網路重試不會重複建立玩家、錢包或發放初始點數。
- 帳號衝突不會被靜默合併。
- 遊戲端拿不到密碼、Provider token、service role key 或可直接改錢包的權限。
- 登入成功後可以建立 Looty session，並使用一次性 launch code 進入遊戲。
- 未公開完整 Looty Lobby 時，麻將直接入口仍可獨立運作。

## 尚未定案

- 第一版實際啟用快速登入、Google、LINE、Apple、Email 中的哪些組合。
- Guest 採用 Supabase anonymous sign-in 或過渡 token。
- Guest 的保存期限與清理規則。
- Email 使用密碼、OTP 或兩者並存。
- Provider identity 衝突時的玩家操作流程。
- Android / iOS 的正式 bundle id、return URL、deep link 與安全儲存方案。
- 帳號刪除的等待期、資料保留與麻將資料匿名化規則。
- Demo POINT 與未來正式 POINT 的帳號資格和保存規則。
