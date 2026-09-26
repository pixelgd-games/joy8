# Joy8

Joy8 is a lightweight H5 game platform. This repository contains the public Lobby, the Game Loader, the game administration pages, and the Joy8 Gateway Edge Function.

This file is the source of truth for the repository's current implementation and operation. Product decisions, integration contracts, operational risks, and analytics plans live in the documents listed in the [Documentation Map](#documentation-map).

## Current State

- Public Lobby browsing, Google/guest member entry, six-digit public player IDs,
  the shared POINT wallet and trusted settlement are deployed.
- Facebook sign-in is implemented but disabled. The sign-in decision is owned by
  [MEMBER_AUTH_PLAN.md](docs/platform/MEMBER_AUTH_PLAN.md#release-identity-scope).
- The in-app mailbox, administrator composer and claim-once POINT attachments
  are deployed. See [MAILBOX.md](docs/platform/MAILBOX.md) for operation and the
  remaining real-player acceptance boundary.
- The POINT rules in [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md#wallet-and-point-direction)
  are installed: enrollment grants and one-time Google top-up, per-game minimum
  bet, maximum bet (at most 10,000 POINT) and per-round payout limit for
  platform-funded games.
- Game sessions last 12 hours; launch codes last 2 minutes; balance tokens last
  at most 15 minutes and are renewed by the game backend.
- Monster Lab is published in the public catalog with a production Backend Key;
  its private entry is disabled. Mahjong remains hidden with its private entry
  paused. Monster Lab has verified hosted launch, bets, win/loss settlement and
  complete Free Spins rounds reconciled against Joy8 settlements; the remaining
  hosted acceptance cases are still open. Launch risks are tracked in
  [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

## Current Scope

Joy8 currently provides:

- A public mobile-first game Lobby.
- A database-backed game catalog exposed through `public_games_v1`.
- A Game Loader that creates a Joy8 session and embeds a selected game in an iframe.
- A reusable branded game-entry shell whose visible login is game artwork while
  Joy8 retains Auth, enrollment, session issuance, and callback ownership.
- A reusable Lobby dialog for Google and persistent guest entry, with explicit
  player enrollment. `/account/` is a narrow Auth return trampoline back to that
  dialog. The Facebook button is built but hidden.
- A stable six-digit public player ID displayed as `Player 123456`, separate
  from the internal player UUID used by trusted platform and product backends.
- Google OAuth for game administration, with server-side administrator verification.
- Catalog creation, editing, publishing and unpublishing; the UI preserves records instead of hard-deleting games.
- A Supabase Edge Function for trusted game backend authorization, the shared POINT wallet, atomic settlement and runtime rate limits.
- An installable Browser/Server SDK and third-party self-integration kit for the
  `server-v1` contract.
- Cloudflare Pages static deployment from the `main` branch.
- PWA metadata and install support for the Lobby.

Joy8 does not currently provide:

- Email/password sign-in or any outbound authentication email.
- Hosted Facebook sign-in.
- Hosted guest-to-provider linking or end-to-end public branded-entry acceptance.
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
never passed into games. The Gateway is the only public path to protected player,
game-session, and wallet RPCs. Separate browser storage does not grant
administrator or player eligibility.

Joy8 uses the Seamless Wallet model: every enrolled player has one POINT wallet
shared by all integrated games, and games never hold or change a balance. The
game-facing protocol is `server-v1`, defined in
[GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md).

### Browser Entries

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `index.html` | Public Lobby |
| `/account/` | `account/index.html` | Auth return trampoline that restores the Lobby member dialog or a validated branded entry |
| `/mailbox/` | `mailbox/index.html` | Member announcements, notifications and reward claims |
| `/admin/mail/` | `admin/mail/index.html` | Administrator compose, preview, send and recipient audit |
| `/game/` | `game/index.html` | Published-game Loader and iframe shell |
| `/entry/` | `entry/index.html` | Joy8-controlled, game-branded Google/guest entry and in-memory launch handoff |
| `/play-test/` | `play-test/index.html` | Hidden-game test entry using normal membership and the shared Loader; no player allowlist |
| `/admin/login/` | `admin/login/index.html` | Google OAuth entry |
| `/admin/games/` | `admin/games/index.html` | Game list |
| `/admin/games/new/` | `admin/games/new/index.html` | Create game |
| `/admin/games/edit/` | `admin/games/edit/index.html` | Edit game |

Vite declares these entries in `vite.config.js`.

### Source Map

| Path | Responsibility |
| --- | --- |
| `src/main.js` | Lobby bootstrap |
| `src/pages/lobby/` | Lobby data loading, rendering, and layout |
| `src/pages/game/` | Game lookup, session creation, and iframe handling |
| `src/pages/entry/` | Branded iframe entry, Google/guest orchestration and callback completion |
| `src/admin/` | Admin authentication and game CRUD |
| `src/admin/mail.js` | Administrator mailbox composer and delivery audit |
| `src/mailbox/` | Member inbox and shared mailbox presentation/service |
| `src/admin/login.js` | Explicit admin login-page bootstrap; shared auth imports have no page startup side effects |
| `src/lib/supabaseClient.js` | Shared browser Supabase client |
| `src/lib/memberClient.js` | Separate member Auth session and Gateway client |
| `src/member/` | H5 member UI and testable authentication flow |
| `src/lib/urls.js` | URL helpers |
| `src/ui/error-modal.js` | Shared error presentation |
| `src/styles/` | Shared tokens plus theme, Lobby, Loader and error-modal styles |
| `supabase/functions/joy8-gateway/index.ts` | Gateway Edge Function |
| `supabase/migrations/` | Incremental database migrations |
| `scripts/` | Local verification, operator tools and Supabase routing helpers |
| `scripts/sql/` | Read-only hosted status queries |
| `packages/joy8-game-sdk/` | Browser/Server SDK |
| `integrations/third-party/` | Provider integration kit |
| `public/games/<slug>/cover.webp` | Joy8-managed Lobby covers |

Unapproved SQL belongs in `supabase/drafts/`, which is excluded from migration discovery.

## Runtime Flows

`src/styles/tokens.css` owns the shared font and palette. Loader and error-modal
styles consume those tokens without applying the Lobby's page layout to Admin.
Lobby account/game entry shares one pending guard, including lazy dialog loading.

### Lobby

1. The Lobby reads published games from `public_games_v1`.
   Browsing does not require login. The top-bar account control shows `登入`
   when signed out and `Player 123456` for an enrolled player; the account-type
   label is only a temporary fallback while membership is resolving. The control
   opens the shared member dialog over the unchanged Lobby.
2. Cards are rendered from database metadata.
3. Selecting a game checks membership. Enrolled registered players and persistent
   guests continue to `/game/?slug=<slug>`. Other visitors see the member dialog
   with the chosen game named. Google or explicit guest entry preserves that
   destination; closing cancels it.
4. Missing cover images use the platform fallback behavior.

The responsive Lobby uses four columns on touch devices with a low-height landscape viewport. Desktop and mobile portrait layouts remain separate.

### Game Launch

1. The Loader reads `slug` from the URL. A direct link without member
   session/enrollment redirects to `/?play=<slug>`, where the Lobby validates the
   published game and opens the member dialog. Backend failures stop launch visibly.
2. It loads the matching published game from `public_games_v1`.
3. It normalizes `launch_url` as an HTTPS URL or a root-relative platform path. HTTP is accepted only between loopback hosts during local development.
4. It calls `joy8-gateway/create-session` with only the game slug.
5. It creates the iframe from the catalog URL without launch credentials.
6. The game announces its Joy8 Client from an approved parent origin, then the
   Loader delivers the session parameters once through an origin-checked in-memory message.

The launch payload fields, lifetimes and handshake rules are defined in
[GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md#loader-in-memory-handoff).
The Loader never passes a Supabase anonymous key, member JWT, or service-role key
into the iframe.

### Member Entry

Google uses PKCE and explicit callback exchange. The public member UI does not
offer Email/password signup, sign-in, verification, or recovery. Guest creation
uses Cloudflare Turnstile and Web Locks across tabs, and fails closed without the
required browser capability. Turnstile script loading is bounded to 15 seconds and
the complete token attempt to 45 seconds; failure permits an explicit retry, and
closing the dialog cancels the attempt. Logout is local to the selected Auth
session and does not create a replacement guest. Clearing storage can lose guest
access.

The Auth trampoline forwards the one-use OAuth code from `/account/` to the Lobby
callback query, and the Lobby removes that query before loading the member dialog.
This does not remove the initial request from infrastructure logs; do not collect
callback queries in analytics or access-log exports.

`POST /member` resolves existing enrollment; `POST /enroll-member` explicitly
enrolls the authenticated identity. Both take an empty JSON object, require an
allowed Origin and server-verified bearer token, and return
`{ "member": { "player_account_ref": "...", "public_id": "482731", "account_type": "guest|registered" } }`.
`player_account_ref` is the internal UUID used for authorization and backend
mapping. `public_id` is a presentation identifier, not a credential, launch field,
or settlement key. The read route may return `{ "member": null }` and never
writes. `enroll-member` creates the player's wallet and enrollment grant, and
applies the one-time top-up when a guest has linked Google.

### Administration

1. An administrator signs in with Google OAuth.
2. The browser calls `is_joy8_admin()`, which requires a verified active Google
   Auth identity listed in `admin_users`.
3. Authorized users can list, create, edit, publish, and unpublish catalog records.
4. Public users read only the safe fields exposed by `public_games_v1`.

Catalog forms stay disabled until administrator verification and, for edits,
successful record loading. Failed reads cannot enable saving; an in-flight save
blocks duplicate submissions and a rejected save permits an explicit retry.

The front end does not write player, wallet, match, settlement, or session tables directly.

## Gateway

The hosted `joy8-gateway` implements these POST routes:

- member, enroll-member, create-session, private-session, branded-entry, balance, health.
- server-exchange-v1, server-renew-v1, server-open-v1,
  server-settle-v1, server-status-v1, server-cancel-v1.

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

## Database

The Joy8 Supabase project is `Joy8`, ref `lsazydefvnuqglultqii`.

Platform tables: `games`, `admin_users`, `player_accounts`, `wallet_accounts`,
`wallet_transactions`, `game_sessions`, `gateway_rate_limits`,
`joy8_wallet_policies`, `joy8_game_policies`, `joy8_backend_keys`,
`joy8_private_entries`, `joy8_matches`, `joy8_match_participants`,
`joy8_settlements`, `joy8_settlement_entries`, `joy8_fee_accounts`,
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

The repository has no baseline migration. Existing migrations are incremental
and cannot reconstruct the full local database alone. Every migration file on
disk must match a hosted migration version (`migration list --linked`).

## Local Development

Requirements:

- Node.js 22, using the version in `.node-version`.
- A local `.env.local` containing:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TURNSTILE_SITE_KEY=...
```

Leave `VITE_FACEBOOK_AUTH_ENABLED` unset so Facebook entry stays hidden; see
[Deployment](#deployment).

Production builds reject missing variables, another Supabase project,
privileged keys and Turnstile test keys. Test keys are reserved for the mocked
smoke build; never use them with hosted Auth or production.

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
first failure. Chrome or Edge is required for smoke. It never applies SQL or
publishes code. Smoke assets use test Turnstile configuration and are written to
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
| `npm run test:member` / `test:captcha` / `test:iframe` | Member flow, Turnstile handling and Loader handshake with mocks |
| `npm run test:gateway` / `test:gateway-rate` | Gateway routes, error mapping, health and scoped rate limits |
| `npm run test:member-db` / `test:member-pg` | Enrollment, grants, promotion, launch and wallet concurrency |
| `npm run test:mailbox` | Mailbox audience snapshot, permissions, read/claim states, atomic credit and retries on the current schema; set `JOY8_TEST_ENGINE=postgres17` with `JOY8_TEST_PG_BIN` for competing connections |
| `npm run test:public-id` / `test:member-product-db` / `test:member-product-pg` | Public IDs and product-schema registration |
| `npm run test:platform-db` / `test:platform-pg` | Reservation, settlement, fees, frozen wallets and adapter isolation |
| `npm run test:continuous-db` / `test:continuous-pg` | Per-hand table settlement |
| `npm run test:seamless-wallet` | Bet/payout limits, table reservations and platform-funded settlement |
| `npm run test:session-scope` / `test:session-scope-pg` | Balance-token scope and session validity |
| `npm run test:product-ddl` / `test:hardening-pg` | Product DDL guard and combined native PostgreSQL hardening |
| `npm run test:release-safety` | Administrator identity, entry pause, operator recovery and cleanup |
| `npm run test:platform-bundle` | Migration classification and the exported platform fixture |
| `npm run test:sdk` / `test:backend-key` | SDK surface, provider kit and Backend Key operator |

These tests use synthetic data. They do not prove hosted Auth, real provider
linking, production capacity or backup restoration.

`npm run smoke:gateway` checks hosted health and rejection paths. It creates no
business data but changes rate counters; hosted execution requires
`ALLOW_PRODUCTION_GATEWAY_SMOKE=1` and approval.

For Markdown-only changes, validate document links, paths, language, and
architecture claims; a production build is not required.

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
- **Backend Keys.** Use `npm run key:backend`; the operator flow is in
  [integrations/third-party/README.md](integrations/third-party/README.md).

### Hosted Auth Configuration

- The public member UI uses Google and anonymous Auth only. Anonymous sign-in
  and manual identity linking are enabled.
- The Email provider is enabled: public Auth settings report `external.email=true`,
  `disable_signup=false` and `mailer_autoconfirm=false`, so Email API signup is
  possible and requires verification. Disabling it is a pending release step
  whose timing the user controls. When approved, run
  `scripts/supabase-joy8.cmd auth-config disable-email --apply`; it disables only
  the Email provider and keeps Google and anonymous signup. Never set the global
  `disable_signup` flag. The local Joy8 access token currently receives HTTP 403
  `Missing required permission(s): auth_config_read` and needs Auth configuration
  read/write permission first.
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
- Cloudflare Turnstile Managed protection is enabled for Auth on `joy8.cc` and
  its subdomains. The public site key is used by the member client; the secret
  exists only in Cloudflare and Supabase.

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
- Required production variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_TURNSTILE_SITE_KEY`.
- Set `VITE_FACEBOOK_AUTH_ENABLED=true` only after the hosted Facebook provider
  and its conflict-safe sign-in/linking flow pass acceptance. Omit it otherwise.
- `public/_headers` denies framing of Joy8 pages and supplies the production
  content-type and referrer protections copied into the Cloudflare Pages build.
- Git-triggered Pages builds deploy the production branch. If a provider build
  fails, an authorized operator can deploy a verified local `dist` with Wrangler.
  Never deploy `.smoke-dist.local`, which contains mocked test configuration.
- The `joy8-gateway` Edge Function is deployed separately through Supabase.

## Game and Asset Boundaries

- Joy8 owns the catalog, Loader, iframe shell, platform error states, and Lobby covers.
- A game owns its rendering, assets, CSP, `X-Frame-Options`, and sandbox compatibility.
- Game source changes must be made in the named game repository, not here.
- Lobby covers use `750 x 1000` WebP at `public/games/<slug>/cover.webp`.
- Read `D:\Studio\Project_Art\README.md` before creating, moving, or exporting any asset.

## Documentation Map

| Document | Owns |
| --- | --- |
| `AGENTS.md` | AI workflow, fixed rules, safety, and document routing |
| `CLAUDE.md` | Thin Claude Code entry that points back to `AGENTS.md` |
| `README.md` | Current repository implementation and operation |
| `docs/product/PRODUCT_SCOPE.md` | Product boundaries, approved direction, POINT rules and priorities |
| `docs/platform/GAME_PLATFORM_INTEGRATION.md` | Joy8-to-game runtime contract |
| `docs/platform/MEMBER_AUTH_PLAN.md` | Sign-in decision, member, persistent guest and branded-entry identity |
| `docs/platform/MAILBOX.md` | In-app mailbox, administrator workflow, claim accounting and activation procedure |
| `docs/platform/CRAZYGAMES_INTEGRATION.md` | CrazyGames build and submission requirements |
| `docs/platform/FLASH.md` | Stable cross-module Flash context |
| `docs/operations/KNOWN_ISSUES.md` | Active limitations, risks, and launch blockers |
| `docs/operations/ANALYTICS_MONITORING.md` | Analytics, KPI, logging, dashboards, and alerts |

Do not copy whole sections between these documents. Link to the owning document when another subject needs context.
