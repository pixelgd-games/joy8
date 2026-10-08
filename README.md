# Joy8

Joy8 is a lightweight H5 game platform. This repository contains the public Lobby, the Game Loader, the game administration pages, and the Joy8 Gateway Edge Function.

This file is the source of truth for the repository's current implementation and operation. Product decisions, integration contracts, operational risks, and analytics plans live in the documents listed in the [Documentation Map](#documentation-map).

## Current State

The approved whitelist SQL, reviewed test-player cleanup and Mahjong reserve
release are installed. The Before User Created Hook is enabled in Dashboard;
other Auth settings were preserved. The admin allowlist page, Gateway checks
and guest-button removal are deployed. The requested Johnny Google account is
allowlisted and its verified Google signup is recorded in hosted Auth. A fresh
outside-list Google signup still needs real-provider acceptance.
See [WHITELIST_RELEASE.md](docs/operations/WHITELIST_RELEASE.md).

- Public Lobby browsing, Google member entry, six-digit public player IDs,
  the shared POINT wallet and trusted settlement are deployed.
- Google is the only supported member provider. The sign-in decision is owned by
  [MEMBER_AUTH_PLAN.md](docs/platform/MEMBER_AUTH_PLAN.md#release-identity-scope).
- The in-app mailbox, administrator composer and claim-once POINT attachments
  are deployed. See [MAILBOX.md](docs/platform/MAILBOX.md) for operation and the
  remaining real-player acceptance boundary.
- The POINT rules in [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md#wallet-and-point-direction)
  are installed: one-time Google enrollment grants, per-game minimum
  bet, maximum bet (at most 10,000 POINT) and per-round payout limit for
  platform-funded games.
- Game sessions last 12 hours; launch codes last 2 minutes; balance tokens last
  at most 15 minutes and are renewed by the game backend.
- Monster Lab is published in the public catalog with a production Backend Key;
  its private entry is disabled. Mahjong is published at its production Pages URL
  with its localhost private entry disabled; its policy uses capped reservations
  of each human's maximum one-hand loss (300 to 10,000 POINT). Monster Lab has verified hosted launch, bets, win/loss settlement and
  complete Free Spins rounds reconciled against Joy8 settlements; the remaining
  hosted acceptance cases are still open. Launch risks are tracked in
  [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).
- [Reserve increases](docs/platform/GAME_PLATFORM_INTEGRATION.md#reserve-increase)
  are installed (`20261007100000_match_reserve_increase.sql`) and the Gateway
  routes are deployed. Only Baccarat enables them: its raise table
  (`20261008100000_baccarat_bet_raises.sql`), policy flag and `reserve` key scope
  (`20261008100100_baccarat_reserve_increase.sql`) are applied and the Baccarat
  backend enables raises. One hosted raise and its settlement reconcile with
  Joy8; the remaining hosted cases are in
  [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md#test-gaps).
- The Lobby shows the member's POINT balance through the deployed Gateway
  `wallet` route and the applied `joy8_member_wallet_v1` migration
  (`supabase/migrations/20260929100000_member_wallet_balance.sql`). A real
  member's balance display still needs hosted player acceptance.
- Hosted catalog administration and Lobby-to-Mahjong launch have scoped manual
  coverage. Hosted acceptance remains open for successful enabled independent
  entry, production capacity and managed recovery. A real Mahjong hand has
  settled through the capped reservation.
  See [verification boundaries](docs/operations/KNOWN_ISSUES.md#test-gaps).

## Current Scope

Joy8 currently provides:

- A public game Lobby on one URL with separate PC and mobile layouts, selected
  from the device when the page opens.
- An in-Lobby member card, POINT balance and mailbox drawer.
- A database-backed game catalog exposed through `public_games_v1`.
- A Game Loader that creates a Joy8 session and embeds a selected game in an iframe.
- A reusable branded game-entry shell with Joy8-controlled Google entry before
  protected game metadata and artwork; Joy8 retains enrollment and session authority.
- A reusable Lobby dialog for Google entry, with explicit
  player enrollment. `/account/` is a narrow Auth return trampoline back to that
  dialog.
- A stable six-digit public player ID displayed as `Player 123456`, separate
  from the internal player UUID used by trusted platform and product backends.
- Google OAuth for game administration, with server-side administrator verification.
- Catalog creation, editing, publishing and unpublishing; the UI preserves records instead of hard-deleting games.
- A Supabase Edge Function for trusted game backend authorization, the shared POINT wallet, atomic settlement and runtime rate limits.
- An installable Browser/Server SDK and third-party self-integration kit for the
  `server-v1` contract.
- Cloudflare Pages static deployment from the `main` branch.
- PWA metadata for the Lobby.

Joy8 does not currently provide:

- Email/password sign-in or any outbound authentication email.
- Other member providers or guest accounts.
- End-to-end public branded-entry acceptance.
- POINT purchase, withdrawal, transfer or cash conversion.
- Full analytics, dashboards, or unattended alerting.
- A game runtime or game-specific business logic.
- CrazyGames integration inside this repository.
- A published SDK registry release or a completed independent third-party SDK acceptance.

## Architecture

```text
Browser
  ├─ Lobby ─────────────── public_games_v1
  ├─ Member entry ──────── Supabase Auth + Gateway member/enroll-member
  ├─ Admin pages ───────── games + is_joy8_admin()
  └─ Game Loader
       ├─ published entry: public_games_v1 + Gateway create-session
       ├─ test entry: Gateway private-session + backend entry configuration
       ├─ branded entry: Gateway branded-entry/private-session + backend entry configuration
       └─ game iframe
            ├─ Gateway balance (in-memory balance token, if supplied)
            └─ game backend (one-use launch exchange and financial requests)
                 └─ Gateway server-*-v1
                      └─ service-role database RPCs
```

The front end is a Vite multi-page application written in vanilla JavaScript and
CSS. Admin uses its Auth client; public catalog reads use a non-persistent client
with no administrator session. Member entry and launch use a separate PKCE client
with storage key `joy8-member-auth-v1`; Auth session storage is platform-owned and
never passed into games. Database insert guards check current Google email access
when creating players or game sessions; the Gateway checks branded-entry directly
because that route creates neither. The Gateway is the only public path to protected player,
game-session, and wallet RPCs. Separate browser storage does not grant
administrator or player eligibility.

Joy8 uses the Seamless Wallet model: every enrolled player has one POINT wallet
shared by all integrated games, and games never hold or change a balance. The
game-facing protocol is `server-v1`, defined in
[GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md).

### Browser Entries

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `index.html` | Public Lobby, member card, POINT balance and mailbox drawer |
| `/account/` | `account/index.html` | Auth return trampoline that restores the Lobby member dialog or a validated branded entry |
| `/admin/access/` | `admin/access/index.html` | Google email allowlist management |
| `/admin/mail/` | `admin/mail/index.html` | Administrator compose, preview, send and recipient audit |
| `/game/` | `game/index.html` | Published-game Loader and iframe shell |
| `/entry/` | `entry/index.html` | Joy8-controlled Google entry and branded game shell and in-memory launch handoff |
| `/play-test/` | `play-test/index.html` | Explicitly enabled independent entry using the shared Loader and email access gate |
| `/admin/login/` | `admin/login/index.html` | Google OAuth entry |
| `/admin/games/` | `admin/games/index.html` | Game list |
| `/admin/games/new/` | `admin/games/new/index.html` | Create game |
| `/admin/games/edit/` | `admin/games/edit/index.html` | Edit game |

Vite declares these entries in `vite.config.js`.

### Source Map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Lobby bootstrap |
| `src/pages/lobby/` | Layout selection, catalog grid, hero carousel, member card, mailbox drawer and settings sheet |
| `src/pages/lobby/content.js` | Fixed hero slides, notices, social links and placeholder messages |
| `src/pages/game/` | Game lookup, session creation, iframe handling and the game top bar |
| `src/pages/entry/` | Branded iframe entry, Google orchestration and callback completion |
| `src/admin/` | Admin authentication and game CRUD |
| `src/admin/access.js` | Verified-admin email allowlist management |
| `src/admin/mail.js` | Administrator mailbox composer and delivery audit |
| `src/mailbox/` | Shared mailbox service and mail detail rendering |
| `src/admin/login.js` | Explicit admin login-page bootstrap; shared auth imports have no page startup side effects |
| `src/lib/supabaseClient.js` | Shared browser Supabase client |
| `src/lib/memberClient.js` | Separate member Auth session and Gateway client |
| `src/member/` | H5 member UI and testable authentication flow |
| `src/member/state.js` | Member identity transitions, duplicate-event suppression and stale-response isolation |
| `src/member/game-visit.js` | Per-tab game-entry recency and return-to-Lobby handling |
| `src/lib/request.js` | Browser API deadline covering connection and response-body reads |
| `src/lib/urls.js` | URL helpers |
| `src/ui/error-modal.js` | Shared error presentation |
| `src/styles/` | Shared tokens plus theme, Lobby (`lobby.css`, `lobby-pc.css`, `lobby-mobile.css`), Loader, error-modal and the plain light Admin stylesheet (`admin.css`) shared by every admin page |
| `supabase/functions/joy8-gateway/` | Gateway entry, HTTP/auth/RPC policies and route modules |
| `supabase/migrations/` | Incremental database migrations |
| `scripts/` | Local verification, operator tools and Supabase routing helpers |
| `scripts/sql/` | Read-only hosted status queries |
| `packages/joy8-game-sdk/` | Browser/Server SDK |
| `integrations/third-party/` | Provider integration kit |
| `public/games/<slug>/cover.webp` | Joy8-managed Lobby covers |
| `public/lobby/` | Lobby hero and promotion banners |
| `public/fonts/` | Self-hosted Lilita One logo font |

Unapproved SQL belongs in `supabase/drafts/`, which is excluded from migration discovery.

## Runtime Flows

`src/styles/tokens.css` owns the shared font and palette. Loader and error-modal
styles consume those tokens without applying the Lobby's page layout to Admin.
Lobby account/game entry shares one pending guard, including lazy dialog loading.

### Lobby

1. `index.html` is the only Lobby page. When it opens, `src/pages/lobby/layout.js`
   reads the browser's mobile hint (User-Agent Client Hints, else the
   User-Agent) and selects either the PC or the mobile layout on the same URL; it
   never redirects, so `/?play=` and the `/account/` return keep working.
   PC: fixed top bar, left promotion/notice column, 1600 x 480 hero carousel,
   one 「全部遊戲」 grid and a fixed bottom bar with the footer links, the POINT
   notice and social links. Mobile: one-row top bar,
   full-width 2:1 hero carousel, notice ticker, three-column grid, floating
   daily-reward button and footer social links.
   Both layouts' scoped CSS ships with the initial stylesheet. The Lobby shell
   and first hero image render independently of the member/catalog client;
   the build preloads that module's static dependencies in parallel. Controls
   become interactive once the client event handlers are installed.
   Later hero images load on navigation or after the current image has loaded;
   catalog completion preserves the existing first image.
2. The Lobby reads published games from `public_games_v1`. Browsing does not
   require login. Cards and hero game slides come from that catalog; a hero game
   slide is shown only while its game is published. Missing covers show the game
   name on the platform fallback.
3. Signed-out visitors see `登入`. An enrolled player sees the avatar,
   `Player 123456`, the POINT balance, the unread count and a member card with
   the player ID, masked Google email and join date. The balance comes from the
   Gateway `wallet` route and refreshes after a mailbox claim.
4. Selecting a game checks membership. Enrolled registered players continue to
   `/game/?slug=<slug>`. Other visitors see the member dialog with the chosen
   game named and its cover. Google entry preserves that destination; closing
   cancels it.
5. 信箱 opens a right-side drawer on PC and a bottom sheet on mobile. It uses the
   `mailbox` Gateway route: opening a mail marks it read, and 「領取 POINT」 is a
   separate explicit claim. Visitors are sent to the member dialog instead.
   Sign-out clears the displayed mail and balance.
   Identity changes immediately clear the previous player's mail and balance;
   late responses cannot restore them. Repeated same-user sign-in events do not
   reload membership, wallet and mailbox. Token refresh and user updates still
   revalidate membership. Opening mail can reuse the first page fetched for the
   unread badge for up to 30 seconds; reading, claiming and identity changes
   invalidate that cache. A failed next-page read retains existing rows and
   retries the same offset.
6. The gear opens 設定, a right-side drawer on PC and a bottom sheet on mobile.
   The sound switches and the language choice are display-only: switches reset
   on reload and English only shows a notice. The account section is visible
   to members only and its 登出 works. 服務條款, 隱私權政策 and 聯絡客服 only show
   a notice. On the mobile layout outside an installed app, 其他 also lists
   加入桌面: it opens the browser install prompt when the browser offers one,
   otherwise it shows Chrome/Safari add-to-home-screen steps
   (`src/pages/lobby/install.js`).
7. 每日獎勵, 商城, the promotion banner, social links and footer links are
   placeholders that only show a short notice. Hero slides, notices and social
   links are fixed in `src/pages/lobby/content.js`; changing them needs a deploy.

### Game Launch

1. The Loader reads `slug` from the URL and requires a matching recent entry or
   visit in that tab. A missing or two-minute-old record returns to `/` before
   catalog/member reads, session creation or iframe loading. Lobby selection and
   successful member continuation establish a fresh entry. See the
   [return policy](docs/platform/MEMBER_AUTH_PLAN.md#game-page-return-policy).
   A recent entry without member session/enrollment redirects to `/?play=<slug>`;
   backend failures stop launch visibly.
2. It loads the matching published game from `public_games_v1`.
3. It normalizes `launch_url` as an HTTPS URL or a root-relative platform path. HTTP is accepted only between loopback hosts during local development.
4. It calls `joy8-gateway/create-session` with only the game slug.
5. It creates the iframe from the catalog URL without launch credentials.
6. The game announces its Joy8 Client from an approved parent origin, then the
   Loader delivers the session parameters once through an origin-checked in-memory message.
7. The game iframe has a black background, which shows while a game repaints
   after a resize or orientation change.
8. The Loader shell shows a top bar above the iframe: 回到大廳 (with a leave
   confirmation), the JOY8 logo and a fullscreen toggle for the whole page. The
   toggle is hidden where the browser has no Fullscreen API, such as iPhone
   Safari. Phones in landscape keep the same bar at a lower 36px height. Games
   need no change.

The launch payload fields, lifetimes and handshake rules are defined in
[GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md#loader-in-memory-handoff).
The Loader never passes a Supabase anonymous key, member JWT, or service-role key
into the iframe.

### Member Entry

Google uses PKCE and explicit callback exchange. The public member UI does not
offer Email/password signup, sign-in, verification, or recovery. Guest creation
is disabled in the prepared frontend; the reviewed signup hook and anonymous
Auth setting enforce this server-side at rollout. Logout is local to the selected Auth
session and does not create a replacement guest. Guest creation and provider linking are not implemented.

The Auth trampoline forwards the one-use OAuth code from `/account/` in a URL
fragment, not another query. The Lobby or branded entry removes that fragment
before using the callback.
This does not remove the initial request from infrastructure logs; do not collect
callback queries in analytics or access-log exports.

`POST /member` resolves existing enrollment; `POST /enroll-member` explicitly
enrolls the authenticated identity. Both take an empty JSON object, require an
allowed Origin and server-verified bearer token, and return
`{ "member": { "player_account_ref": "...", "public_id": "482731", "account_type": "registered" } }`.
`player_account_ref` is the internal UUID used for authorization and backend
mapping. `public_id` is a presentation identifier, not a credential, launch field,
or settlement key. The read route may return `{ "member": null }` and never
writes. `enroll-member` creates the player's wallet and enrollment grant, and
never creates a guest or a promotion grant.

### Administration

1. An administrator signs in with Google OAuth. The reviewed whitelist SQL
   seeds every current administrator email and prevents its removal.
2. The browser calls `is_joy8_admin()`, which requires a verified active Google
   Auth identity listed in `admin_users`.
3. Authorized users can list, create, edit, publish, and unpublish catalog records.
4. Public users read only the safe fields exposed by `public_games_v1`.

Published catalog writes through authenticated PostgREST must pass the database
`joy8_game_readiness` policy: HTTPS URL, matching cover path, enabled game and
POINT policies, an active key with all six runtime scopes, and a valid configured
adapter. Save a new game as an unpublished draft before provisioning it. Admin
forms show missing prerequisites; direct writes cannot bypass RLS. These checks
do not certify real gameplay acceptance or prevent later operator revocation.

Catalog forms stay disabled until administrator verification and, for edits,
successful record loading. Failed reads cannot enable saving; an in-flight save
blocks duplicate submissions and a rejected save permits an explicit retry.

The front end does not write player, wallet, match, settlement, or session tables directly.
Catalog edits and unpublish operations require one returned row before reporting
success. Browser API fetches have a 15-second deadline through body completion;
the deadline does not imply that a timed-out write was rolled back. Explicit
mail retries retain the original message/request identity.

## Gateway

`supabase/functions/joy8-gateway/index.ts` only registers the request handler.
`handler.ts` owns dispatch, request correlation and logging; `http.ts` owns CORS,
bounded JSON parsing and response helpers. `auth.ts` verifies member identity,
`rpc.ts` owns timed upstream transport and public error mapping, and
`rate-limit.ts` handles ingress and subject admission. Environment configuration
lives in `config.ts`. Route behavior is grouped in `member-routes.ts`,
`mailbox-routes.ts` and `server-routes.ts`.

Server routes keep admission and financial operations inside one
`joy8_server_request_v1` database call. Member mailbox RPCs use the service role
with the verified user ID; admin mailbox RPCs preserve the requesting user's JWT
and anonymous API key, so database admin authorization remains authoritative.
Tests exercise the actual handler and import HTTP/auth/RPC helpers directly.

The hosted `joy8-gateway` implements these POST routes:

- member, enroll-member, wallet, create-session, private-session, branded-entry, balance, health.
- server-exchange-v1, server-renew-v1, server-open-v1,
  server-settle-v1, server-status-v1, server-cancel-v1, server-reserve-v1,
  server-reserve-cancel-v1, server-reserve-status-v1.

The public base URL is:

```text
https://lsazydefvnuqglultqii.supabase.co/functions/v1/joy8-gateway
```

Safeguards and rate limits are defined in
[GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md#security-and-failure-behavior).
The Gateway uses `verify_jwt=false` because it performs its own launch-code,
token, origin, scope, session, and rate-limit checks. Its protected database RPCs
are granted only to `service_role`. It is deployed separately from Cloudflare
Pages; a Git push does not deploy it.
Browser preflight responses include `Access-Control-Max-Age: 7200`. Responses
expose `Retry-After` and `X-Joy8-Request-Id` to cross-origin browser clients. Successful
server open and settlement replies include the player's available POINT;
`server-open-v1` can include settlement 1 for a one-request paid spin.

Member routes default to `https://joy8.cc` and `https://www.joy8.cc` only.
Local development requires explicitly adding the exact origin to
`JOY8_ALLOWED_ORIGINS`; arbitrary localhost ports are rejected. The hosted secret
contains only the two production origins. Session creation relies on its SQL
issuer for membership and insert access checks; runtime cleanup stays in pg_cron.

## Database

The Joy8 Supabase project is `Joy8`, ref `lsazydefvnuqglultqii`.

Platform tables: `games`, `admin_users`, `player_accounts`, `wallet_accounts`,
`wallet_transactions`, `game_sessions`, `gateway_rate_limits`,
`joy8_wallet_policies`, `joy8_game_policies`, `joy8_backend_keys`,
`joy8_private_entries`, `joy8_matches`, `joy8_match_participants`,
`joy8_settlements`, `joy8_settlement_entries`, `joy8_fee_accounts`,
`joy8_reserve_operations`,
`joy8_match_recoveries` and `joy8_product_schemas`. The public catalog is the
`public_games_v1` view.

Protected tables use RLS and service-only RPCs. Products receive no project-wide
service-role key. Every player/currency pair has one wallet that remains unique
even if frozen or closed. Games never select or mutate it directly. Gameplay
transactions record their source game; enrollment grants record none. Product
gameplay data and any accounting adapter live in a permission-separated product
schema registered in `joy8_product_schemas`. pg_cron runs
`joy8_cleanup_gateway_runtime()` every ten minutes; it expires credentials and
rate-limit rows without releasing reservations or deleting financial history.

New projects use `supabase/bootstrap/platform.sql`, a current platform schema
with the POINT policy and no user, financial, catalog or credential data. Existing
projects continue using incremental migrations. Applied historical migrations
remain immutable deployment history; do not replay them into a fresh project.

## Local Development

Requirements:

- Node.js 22, using the version in `.node-version`.
- A local `.env.local` containing:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Production builds reject missing variables, another Supabase project,
privileged keys. Google OAuth does not use a client CAPTCHA token; Turnstile
is not a frontend build dependency. Hosted Auth protection is configured separately.

Do not commit or quote real credentials. A local Vite server still uses the
database configured in `.env.local`; localhost alone does not isolate data.
`supabase/config.toml` contains local Auth-stack settings only and does not
change the hosted project.

```powershell
npm install
npm run dev
npm run build
npm run preview
```

## Verification

`npm run verify` is the combined local acceptance command. It checks literal SQL
dependency paths, runs the unit and database suites on PGlite, checks the
Gateway, builds optimized smoke assets and runs browser smoke. It stops at the
first failure. Chrome or Edge is required for smoke. Browser smoke supplies fixed mock API
settings and intercepts Supabase requests, so it does not need local credentials
or a reachable hosted catalog. It never applies SQL or
publishes code. Smoke assets are written to
`.smoke-dist.local`, never the production `dist`; run `npm run build` separately
to validate production configuration.

Every database suite loads the same current platform schema: all platform
migrations in deployment order from `scripts/fixtures/platform-sources.json`.
Database suites run against isolated in-memory PGlite by default. The `test:*-pg`
commands run the same suites plus competing-connection cases on a temporary
native PostgreSQL 17 cluster bound to `127.0.0.1`; they take no database URL and
never read `.env` credentials. Set `JOY8_TEST_PG_BIN` to an absolute PostgreSQL 17
bin directory. On Windows a portable runtime can be prepared outside the repository:

```powershell
$joy8PgTools = Join-Path $env:TEMP 'joy8-pg17-tools'
npm install --prefix $joy8PgTools --ignore-scripts --no-audit --no-fund --save-exact '@embedded-postgres/windows-x64@17.6.0-beta.15'
$env:JOY8_TEST_PG_BIN = Join-Path $joy8PgTools 'node_modules\@embedded-postgres\windows-x64\native\bin'
```

| Command | Covers |
| --- | --- |
| `node --test scripts/email-allowlist-check.mjs scripts/reviewed-cleanup-check.mjs scripts/mahjong-release-policy-check.mjs` | Applied whitelist, cleanup, reserve, payout and key-scope migrations; isolated fixtures only |
| `npm run test:member` / `test:iframe` | Member flow and Loader handshake with mocks |
| `npm run test:gateway` / `test:gateway-rate` | Gateway routes, error mapping, health and scoped rate limits |
| `npm run test:member-db` / `test:member-pg` | Enrollment, one-time grants, launch and wallet concurrency |
| `npm run test:member-wallet` | Member wallet read permissions, reserved/available POINT and the `wallet` Gateway route |
| `npm run test:mailbox` | Mailbox audience snapshot, permissions, read/claim states, atomic credit and retries on the current schema; set `JOY8_TEST_ENGINE=postgres17` with `JOY8_TEST_PG_BIN` for competing connections |
| `npm run test:public-id` / `test:member-product-db` / `test:member-product-pg` | Public IDs and product-schema registration |
| `npm run test:platform-db` / `test:platform-pg` | Reservation, settlement, fees, frozen wallets and adapter isolation |
| `npm run test:continuous-db` / `test:continuous-pg` | Per-hand table settlement |
| `npm run test:seamless-wallet` | Bet/payout limits, table reservations and platform-funded settlement |
| `npm run test:reserve-increase` / `test:reserve-increase-pg` | Reserve increase limits, retries, single cancel, match cancel, scopes and budgets; native PostgreSQL adds competing connections |
| `npm run test:session-scope` / `test:session-scope-pg` | Balance-token scope and session validity |
| `npm run test:product-ddl` / `test:hardening-pg` | Product DDL guard and combined native PostgreSQL hardening |
| `npm run test:release-safety` | Administrator identity, entry pause, operator recovery and cleanup |
| `npm run test:platform-bundle` | Migration classification and the exported platform fixture |
| `npm run test:sdk` / `test:backend-key` | SDK surface, provider kit and Backend Key operator |

These tests use synthetic data. They do not prove hosted Auth, real provider
interaction, production capacity or backup restoration.

Frontend lifecycle checks cover switched identities, stale responses, duplicate
member reads, request cancellation and game-page return timing. Browser smoke
additionally covers mailbox pagination recovery. Most component fixtures run on
Vite; the optimized build also exercises lazy sign-in, member read/claim/wallet refresh and Loader handoff
under production CSP with isolated API and game fixtures, including recent game
reloads and stale/missing visits returning without creating another game session.

`npm run smoke:gateway` checks hosted health and rejection paths. It creates no
business data but changes rate counters; hosted execution requires
`ALLOW_PRODUCTION_GATEWAY_SMOKE=1` and approval.

For Markdown-only changes, validate document links, paths, language, and
architecture claims; a production build is not required.

### Release gate

Run `npm run verify:release` before deployment. It requires `JOY8_TEST_PG_BIN`,
runs normal verification, native PostgreSQL 17 financial/identity/DDL/concurrency
and mailbox suites, bootstrap/restore regression, then a production build.
Missing native PostgreSQL is a failure, never an automatic PGlite fallback.

### Fresh database and recovery

`supabase/bootstrap/platform.sql` installs the current Joy8 platform on an empty
Supabase database with its vendor Auth schema and roles already present. It
refuses an existing Joy8 catalog. It is deliberately outside automatic migration
discovery. Regenerate it with `npm run db:bootstrap:export` after runtime SQL changes.
`npm run test:recovery` installs it from scratch, creates a synthetic Google
member, dumps schema/data, restores a second native PostgreSQL 17 database and
checks identity, balances, ledger, permissions and grant idempotency.

Both commands require `JOY8_TEST_PG_BIN`; `JOY8_PG_CLIENT_BIN` may specify a
separate PostgreSQL 17 directory containing `pg_dump`. Release verification also
runs the bootstrap/restore check. CI runs normal verification, native PostgreSQL
and recovery on every main push and pull request. Cloudflare's Git deployment is
independent of CI; the operator must pass `verify:release` before pushing.

For a real read-only hosted snapshot, run the project check and
`scripts/supabase-joy8.cmd recovery-snapshot`. The wrapper verifies the Joy8 project;
the tool uses a consistent PostgreSQL snapshot, verifies TLS and saves Auth,
platform and registered product schemas/data plus permission metadata under
`.recovery.local/`. It immediately restores to an isolated local PostgreSQL 17
process and checks row counts, product permissions, DDL guards and financial
reconciliation. `node scripts/restore-snapshot.mjs <snapshot-directory>` repeats
only the local restore. Snapshot files contain sensitive data: they remain
ignored, local and outside source control. This does not test Supabase's managed
backup/PITR service or re-create its infrastructure.

Snapshots preserve Auth/public/product object ownership and extension schema
permissions required by definer functions. Restore re-enables row security after
loading the dump. Snapshots lacking this metadata must be generated again.
`test:recovery` includes a distinct-owner/RLS/extension-access regression.

`node scripts/mahjong-capacity-check.mjs <snapshot-directory>` restores only to
local PostgreSQL and exercises the captured Mahjong functions with 25 synthetic
members and 75 synthetic AI accounts. It tests 1/5/25 simultaneous tables, mixed
win/draw settlements, retries, lock waits and reconciliation. It never connects
to hosted gameplay or measures hosted capacity. Results stay with the ignored
snapshot as `capacity-result.json`.

On Windows, set `ALLOW_PRODUCTION_GATEWAY_SMOKE=1` and run
`node scripts/gateway-ingress-check.mjs` to send ten bounded health requests and
use the Joy8 wrapper for read-only counter inspection. Results stay under
`.acceptance.local/`; no raw client IP is recorded. This probes direct ingress,
not every proxy path or Worker subrequest.

A fresh hosted project still needs separately provisioned administrator and
allowlist entries, catalog/policies, game-owned schemas, Backend Keys, Auth
provider/Hook settings, Gateway secrets, Edge deployment and DNS/redirect settings.
Use the owning product's current schema; never replay old activation, credential
or player-cleanup migrations. Enable the runtime cleanup job with the reviewed
pg_cron schedule only after platform installation. Never reset the live database
to simplify its history.

The migration owner creates new functions without implicit PUBLIC, anon,
authenticated or service-role execution in `public`; each exposed function must
grant its intended callers explicitly. Supabase-managed roles retain their own
vendor defaults. Read-only release inspection uses
`scripts/sql/review-readiness-status.sql`.

## Supabase Operations

Joy8 uses a project-specific wrapper. Before every hosted operation run:

```powershell
.\scripts\supabase-joy8.cmd projects list
```

The result must show `Joy8 / lsazydefvnuqglultqii / linked: true`. Do not continue
if the active CLI state points only to Aura or another project. See `AGENTS.md`
for the complete safety rules.

- **Migrations.** Each database change is a small, transactional, timestamped
  migration applied with `db push --linked` after user approval. A migration must
  stop on a failed precondition; never force it with CASCADE, a data reset or by
  erasing a pending settlement. Never edit an applied migration; rollback is a new
  forward migration.
- **Read-only checks.** `db query --linked` runs as a restricted Management API
  role that cannot execute internal health, admin or validator functions; do not
  broaden production grants to make a check pass. The queries in `scripts/sql/`
  are read-only status checks: `platform-reconciliation.sql` (wallet, reservation
  and fee consistency), `point-rules-status.sql` (POINT policy, grants and game
  limits), `release-safety-status.sql` (entry pause, administrator identity,
  recovery grants and cleanup job; needs the password-authenticated connection)
  and `mahjong-readiness.sql` (Mahjong runtime contract).
- **Operator recovery.** To void an open match the product confirms is void,
  inspect the match and product state, then run a reviewed single transaction
  calling `public.joy8_operator_cancel_match(game_uuid, match_ref,
  expected_settlement_count, reason, evidence_reference)` through the wrapper.
  It is not granted to anon, authenticated, service_role or game runtimes. Never
  put the project administrator password or player credentials in command
  arguments or chat.
- **Whitelist rollout and reviewed cleanup.** Follow
  [WHITELIST_RELEASE.md](docs/operations/WHITELIST_RELEASE.md); drafts are not
  installed until individually approved. The enabled Before User Created Hook
  rejects guests and nonlisted/non-Google signup. Provider settings are unchanged.
- **Backend Keys.** Use `npm run key:backend`; the operator flow is in
  [integrations/third-party/README.md](integrations/third-party/README.md).

### Hosted Auth Configuration

- The enabled `public.joy8_before_user_created` Postgres Hook accepts only
  allowlisted Google signup and rejects anonymous account creation. The provider
  switches and manual identity linking settings were left unchanged. The local
  member UI and hosted Pages build remove guest entry.
- The Email provider is enabled: public Auth settings report `external.email=true`,
  `disable_signup=false` and `mailer_autoconfirm=false`. The Hook rejects new
  Email-provider accounts. Disabling the provider is a separate release step
  whose timing the user controls. When approved, run
  `scripts/supabase-joy8.cmd auth-config disable-email --apply`; it disables only
  the Email provider and preserves Google and the current anonymous setting. Never set the global
  `disable_signup` flag. The local Joy8 access token currently receives HTTP 403
  `Missing required permission(s): auth_config_read`. Hook activation used the
  signed-in Dashboard without updating, creating or displaying a token.
- Facebook is disabled. The Joy8 Meta app (`1385504273217738`) is unpublished
  with no business portfolio, and no Meta App Secret is stored in this
  repository or hosted Auth.
- Site URL is `https://joy8.cc`.
- Admin redirect allowlist entries are `https://joy8.pages.dev/admin/login/`,
  `https://joy8.cc/admin/login/`, `https://www.joy8.cc/admin/login/`, and
  `http://localhost:5173/admin/login/`.
- Member redirect allowlist entries are `https://joy8.pages.dev/account/*`,
  `https://joy8.cc/account/*`, `https://www.joy8.cc/account/*`,
  `http://127.0.0.1:5173/account/*`, `http://localhost:5173/account/*`,
  `http://127.0.0.1:4173/account/*`, and `http://localhost:4173/account/*`.
  The suffix accommodates the encoded `next` and `flow` query parameters while
  keeping the host and member route fixed.
- No outbound email is configured: Cloudflare Email Sending is disabled and no
  SMTP credential exists.
- Cloudflare Turnstile configuration remains hosted. The Google-only frontend
  does not load Turnstile or request its token; reopening guest Auth requires
  a new protection and acceptance review.

## Deployment

- Hosting: Cloudflare Pages.
- Production branch: `main`. A push to `main` triggers production deployment; do
  not push unless the user explicitly requests it.
- Production hostnames: `joy8.cc` and `www.joy8.cc`. The Pages deployment URL
  `joy8.pages.dev` redirects to the canonical `https://joy8.cc` host while
  preserving the path, query, and fragment.
- Cloudflare Redirect Rule `Redirect www.joy8.cc to joy8.cc` sends a 301 to the
  apex host, preserving path and query string.
- Build command: `npm run build`.
- Output directory: `dist`.
- Required production variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `public/_headers` denies framing, limits scripts to this origin and API
  connections to Joy8 Supabase, disables objects/base overrides, and sends no
  referrer. Game frames allow HTTPS because approved games use separate hosts.
  Inline styles remain permitted for existing UI styles; inline scripts do not.
- Git-triggered Pages builds deploy the production branch. If a provider build
  fails, an authorized operator can deploy a verified local `dist` with Wrangler.
  Never deploy `.smoke-dist.local`, which contains mocked test configuration.
- The `joy8-gateway` Edge Function is deployed separately through Supabase.

## Game and Asset Boundaries

- Joy8 owns the catalog, Loader, iframe shell, platform error states, and Lobby covers.
- A game owns its rendering, assets, CSP, `X-Frame-Options`, and sandbox compatibility.
- Game source changes must be made in the named game repository, not here.
- Lobby covers use `750 x 1000` WebP at `public/games/<slug>/cover.webp`.
- Lobby banners (`public/lobby/`) and the logo font (`public/fonts/`) are
  copied from `D:\Studio\Project_Art\Joy8_assets\`. PC hero banners are
  `1600 x 480`, mobile banners `1080 x 540` and the PC promotion `540 x 960`.
- Read `D:\Studio\Project_Art\README.md` before creating, moving, or exporting any asset.

## Documentation Map

| Document | Owns |
| --- | --- |
| `AGENTS.md` | AI workflow, fixed rules, safety, and document routing |
| `CLAUDE.md` | Thin Claude Code entry that points back to `AGENTS.md` |
| `README.md` | Current repository implementation and operation |
| `docs/product/PRODUCT_SCOPE.md` | Product boundaries, approved direction, POINT rules and priorities |
| `docs/platform/GAME_PLATFORM_INTEGRATION.md` | Joy8-to-game runtime contract |
| `docs/platform/MEMBER_AUTH_PLAN.md` | Google sign-in, member and branded-entry identity |
| `docs/platform/MAILBOX.md` | In-app mailbox, administrator workflow, claim accounting and activation procedure |
| `docs/platform/CRAZYGAMES_INTEGRATION.md` | CrazyGames build and submission requirements |
| `docs/platform/FLASH.md` | Stable cross-module Flash context |
| `docs/operations/WHITELIST_RELEASE.md` | Pending whitelist rollout, exact cleanup review and activation gates |
| `docs/operations/KNOWN_ISSUES.md` | Active limitations, risks, and launch blockers |
| `docs/operations/ANALYTICS_MONITORING.md` | Analytics, KPI, logging, dashboards, and alerts |

Do not copy whole sections between these documents. Link to the owning document when another subject needs context.
