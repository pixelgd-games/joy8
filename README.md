# Looty

Looty is a lightweight H5 game platform. This repository contains the public Lobby, the Game Loader, the game administration pages, and the Looty Gateway Edge Function.

This file is the source of truth for the repository's current implementation. Product decisions, integration contracts, operational risks, and analytics plans live in the specialized documents listed below.

Last implementation review: 2026-09-18.

The platform includes public Lobby browsing, Google/password/guest member entry,
persistent player enrollment and one server-authorized wallet/settlement flow.
The member migrations, four platform foundation migrations and session-scope
correction are applied; Gateway version 8 is active.
The matching front end is released through main. Product activation and real
Google/email/linking/recovery acceptance remain outstanding.

Wallet-ledger cleanup, continuous per-hand settlement and the Mahjong private
schema are installed in Supabase. Mahjong has 22 product tables and a hidden
catalog entry. The private-entry migrations and identity-only activation are
installed; the game-scoped wallet opens at 0 POINT. Runtime login and a seven-day
exchange/renew backend key are configured in the game's ignored local environment.
TLS certificate/hostname verification and restricted access passed against hosted
Supabase. No wallet, AI funding or public entry was created by installation.
The key cannot open or settle matches; funded-play configuration remains pending.
Looty's local `/play-test/` entry is available at `http://localhost:5173` and uses
normal member/guest authentication and backend entry configuration, with no
per-player test allowlist. Gateway version 8 is active with the private
session route and continuous-settlement error mapping. Hosted health, rejection
and identity-key scope checks passed. The test-entry page is part of the standard
Cloudflare front-end build, but Mahjong's backend entry remains bound to localhost;
publishing this page does not publish or enable the Mahjong game. See the
[identity connection review](supabase/drafts/MAHJONG_REVIEW.md#identity-only-connection).
The [integration contract](docs/platform/GAME_PLATFORM_INTEGRATION.md#continuous-settlement)
owns the protocol; [Mahjong activation](supabase/drafts/MAHJONG_REVIEW.md) owns
the remaining configuration gates.

## Current Scope

Looty currently provides:

- A public mobile-first game Lobby.
- A database-backed game catalog exposed through `public_games_v1`.
- A Game Loader that creates a Looty session and embeds a selected game in an iframe.
- A reusable `/account/` entry for Google, Email/password, and persistent guests,
  with verification, recovery, guest promotion, and explicit player enrollment.
  Google, email, linking and recovery still require real provider acceptance.
- Google OAuth for game administration, with server-side administrator verification.
- CRUD pages for the `games` catalog.
- A Supabase Edge Function for trusted game backend authorization, scoped wallets, atomic settlement and runtime rate limits.
- Cloudflare Pages static deployment from the `main` branch.
- PWA metadata and install support for the Lobby.

Looty does not currently provide:

- Fully provider-verified public member flows or branded cross-origin handoff.
- Production money movement.
- Full analytics, dashboards, or unattended alerting.
- A game runtime or game-specific business logic.
- CrazyGames integration inside this repository.

See [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md) for the H5 release,
both product models, operational POINT direction, and platform -> product ->
integration order. The member foundation starts the platform stage; scoped wallets,
trusted settlement and health are deployed. Mahjong has identity-only activation;
no product has completed hosted gameplay/settlement acceptance. Real product
integration and provider acceptance remain outstanding.

### Platform Foundation

The platform has one deployed server-authorized accounting flow. It removes browser exchange/bet/payout/
refund/close-round routes, their RPCs, automatic Demo credit and the obsolete
wallet-mode branch. Tests use isolated local data with the same protocol.
There is no runtime fallback for an unconfigured game.

It includes both wallet scopes, default 0 POINT provisioning, game-scoped backend
keys, one-time backend exchange, balance-only client tokens, renewal, reservations,
atomic settlement, cancellation/status and dependency health. Product policy and
keys are configured separately; Mahjong currently has an identity-only policy
and exchange/renew key. Financial activation requires product configuration and
acceptance. Game clients must adopt this contract; the Lobby and member UI remain
available independently.

The approved reset removed test wallets, ledger, sessions and old rounds. Auth
identities, player records, catalog and administrator records matched their
pre-deployment count/hash snapshots. No test balance was carried forward.
The four platform foundation migrations and the incremental session-scope
correction are in supabase/migrations/.
Protocol details belong in [GAME_PLATFORM_INTEGRATION.md](docs/platform/GAME_PLATFORM_INTEGRATION.md#operational-protocol-v1).

## Architecture

```text
Browser
  ├─ Lobby ─────────────── public_games_v1
  ├─ Member entry ──────── Supabase Auth + Gateway member/enroll-member
  ├─ Admin pages ───────── games + is_looty_admin()
  └─ Game Loader
       ├─ published entry: public_games_v1 + Gateway create-session
       ├─ test entry: Gateway private-session + backend entry configuration
       └─ game iframe
            ├─ Gateway balance (in-memory balance token, if supplied)
            └─ game backend (one-use launch exchange and financial requests)
                 └─ Gateway server-*-v1
                      └─ service-role database RPCs
```

The front end is a Vite multi-page application written in vanilla JavaScript and
CSS. Admin/catalog use the existing Supabase client. Member entry and launch use
a separate PKCE client with storage key `looty-member-auth-v1`; Auth session
storage is platform-owned and never passed into games. The Gateway is the only
public path to protected player, game-session, and wallet RPCs. Separate browser
storage does not grant administrator or player eligibility.

### Browser Entries

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `index.html` | Public Lobby |
| `/account/` | `account/index.html` | Member entry, Auth callback, guest upgrade and recovery |
| `/game/` | `game/index.html` | Published-game Loader and iframe shell |
| `/play-test/` | `play-test/index.html` | Local test entry using normal membership and the shared Loader; no player allowlist |
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
| `src/admin/` | Admin authentication and game CRUD |
| `src/admin/login.js` | Explicit admin login-page bootstrap; shared auth imports have no page startup side effects |
| `src/lib/supabaseClient.js` | Shared browser Supabase client |
| `src/lib/memberClient.js` | Separate member Auth session and Gateway client |
| `src/member/` | H5 member UI and testable authentication flow |
| `src/lib/urls.js` | URL helpers |
| `src/ui/error-modal.js` | Shared error presentation |
| `src/styles/` | Shared tokens plus theme, Lobby, Loader and error-modal styles |
| `supabase/functions/looty-gateway/index.ts` | Gateway Edge Function |
| `supabase/migrations/` | Incremental database migrations |
| `supabase/drafts/` | Unapproved SQL excluded from automatic migration discovery |
| `scripts/` | Local verification and Supabase routing helpers |
| `public/games/<slug>/cover.webp` | Looty-managed Lobby covers |

## Runtime Flows

`src/styles/tokens.css` owns the shared font and palette. Loader and error-modal
styles consume those tokens without applying the Lobby's page layout to Admin.
Lobby account/game entry shares one pending guard, including lazy dialog loading.

### Lobby

1. The Lobby reads published games from `public_games_v1`.
   The platform entry is `/`: browsing the Lobby does not require login or open
   an authentication page. The top-bar account control shows `登入` when signed
   out, `訪客帳號` for an Auth guest, and `我的帳號` for a registered Auth user.
   It follows Auth session changes; the label does not grant player eligibility.
   The control opens the shared member UI
   in a dismissible dialog; the Lobby remains visible and its URL is unchanged.
   `/account/` remains available for Auth callbacks and recovery.
2. Cards are rendered from database metadata.
3. Selecting a game checks membership. Enrolled registered players and persistent
   guests continue to `/game/?slug=<slug>`. Other visitors see the member dialog
   over the Lobby, with the chosen game named in the dialog. Google/password or
   explicit guest entry preserves that game destination. Closing cancels it;
   another game or the top-bar login starts a new selection.
4. Missing cover images use the platform fallback behavior.

The responsive Lobby uses four columns on touch devices with a low-height landscape viewport. Desktop and mobile portrait layouts remain separate.

### Game Launch

1. The Loader reads `slug` from the URL.
   A direct link with missing member session/enrollment redirects to `/?play=<slug>`.
   The Lobby validates that the game is published, clears the temporary query,
   and opens the member dialog. Backend failures stop launch visibly.
2. It loads the matching published game from `public_games_v1`.
3. It normalizes `launch_url` as an HTTPS URL or a root-relative platform path. HTTP is accepted only between loopback hosts during local development.
4. It calls `looty-gateway/create-session`.
5. It appends the returned session parameters to the game URL.
6. It creates the iframe with the Looty sandbox, permissions, referrer policy, and load timeout.

The iframe receives:

- `looty_session_id`
- `looty_launch_code`
- `looty_game_id`
- `looty_currency`
- `looty_protocol` (`server-v1`)
- `looty_gateway_url`

The launch code is single-use and valid for two minutes. The trusted game backend exchanges it for an in-memory, balance-only token valid for at most 15 minutes and no later than session expiry. The Loader never passes a Supabase anonymous key, member JWT, or service-role key into the iframe.

The full game-facing contract is in `docs/platform/GAME_PLATFORM_INTEGRATION.md`.

### Member Entry

Google uses PKCE and explicit callback exchange. Email signup requires
verification; recovery and guest email promotion return to password setup.
Guest Google promotion links a provider to the existing Auth user. Guest email
promotion verifies the email before assigning a password. Callbacks check the
original identity and never merge players or wallets. Email callbacks must open
in the browser holding the PKCE verifier; a missing verifier requires restarting
the flow. Guest creation uses Web Locks across tabs and fails closed without
that browser capability. Logout is local to the selected Auth session and does
not create a replacement guest. Clearing storage can lose guest access.

`POST /member` resolves existing enrollment; `POST /enroll-member` explicitly
enrolls the authenticated identity. Both take an empty JSON object, require an
allowed Origin and server-verified bearer token, and return
`{ "member": { "player_account_ref": "...", "account_type": "guest|registered" } }`.
The read route may return `{ "member": null }`. The member migrations preserve player
IDs, derive guest status from Auth, reject inactive accounts, and grant RPC
execution only to the service role. Neither member route provisions a wallet.

### Administration

1. An administrator signs in with Google OAuth.
2. The browser calls `is_looty_admin()`.
3. Authorized users can list, create, edit, publish, and unpublish catalog records.
4. Public users read only the safe fields exposed by `public_games_v1`.

The front end does not write player, wallet, round, or session tables directly.

## Gateway

Hosted Gateway version 8 implements these POST routes:

- member, enroll-member, create-session, private-session, balance, health.
- server-exchange-v1, server-renew-v1, server-open-v1,
  server-settle-v1, server-status-v1, server-cancel-v1.

The public base URL is:

```text
https://lsazydefvnuqglultqii.supabase.co/functions/v1/looty-gateway
```

Current safeguards include:

- Route and HTTP method validation.
- Origin and CORS validation.
- A 16 KiB streamed request-body limit.
- Launch-code and Gateway-token hashing.
- Token scope and session validation.
- Database-backed runtime rate limits.
- A 5-second authentication timeout and an 8-second RPC timeout.
- POINT validation and trusted per-game wallet policy.
- Idempotent atomic match settlement.
- Game-scoped backend keys and reservation/participant isolation.

The Gateway uses `verify_jwt=false` because it performs its own launch-code, token, origin, scope, session, and rate-limit checks. Its protected database RPCs are granted only to `service_role`.

## Database

The Looty Supabase project is `Looty`, ref `lsazydefvnuqglultqii`.

The replacement retains games, admin_users, public_games_v1, player_accounts,
wallet_accounts, wallet_transactions, game_sessions and gateway_rate_limits.
It introduces trusted policies/backend keys, matches, participants, settlements,
settlement entries and fee accounts. The old game_rounds table has been removed.

The deployed ledger uses `wallet_transactions.match_ref`; the unused `metadata`
column is removed. The incremental cleanup preserves ledger values and grants.
Continuous settlement retains occupancy between hands and releases on final/cancel.
Historical single-posting fixtures remain useful for migration regression tests.

Protected tables use RLS and service-only RPCs. Products receive no project-wide
service-role key. A wallet belongs to one trusted platform/game policy and remains
unique even if frozen or closed. POINT starts at 0 pending a later grant decision.
There is no conversion, purchase or withdrawal API. Product gameplay data and any
AI accounting adapter remain in a permission-separated product schema.

The reset left wallet/session/transaction/match/settlement tables empty. Mahjong has an identity-only policy and expiring exchange/renew key. Before funded product activation, review its
scope, limits, key and adapter against the integration contract.

The repository has no baseline migration. Existing migrations are incremental
and cannot reconstruct the full local database alone. Three incomplete Mahjong
drafts are in `supabase/drafts/mahjong-clash/` and remain superseded and unapplied.
Do not promote them alongside the installed schema; see the
[installation review](supabase/drafts/MAHJONG_REVIEW.md).
All 35 local and hosted migration records match, including the eight Mahjong
installation migrations, two private-entry/identity-activation migrations and
the removal of the empty test-player allowlist. Installation checks verified unchanged Auth/player IDs,
existing catalog records and administrator count, with no wallets, sessions,
transactions or matches created. The hidden Mahjong catalog entry is the only
catalog addition. Its private schema and effective permissions passed hosted
postflight; live game/provider acceptance is still pending.
Review blockers are tracked in [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

## Local Development

Requirements:

- Node.js 22, using the version in `.node-version`.
- A local `.env.local` containing:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Do not commit or quote real credentials. A local Vite server still uses the
database configured in `.env.local`; localhost alone does not isolate data.
The full local Supabase stack is not yet reproducible from this repository.
The member SQL checks below use a small isolated fixture and synthetic data.
See the environment direction in [PRODUCT_SCOPE.md](docs/product/PRODUCT_SCOPE.md)
and the recovery limitation in [KNOWN_ISSUES.md](docs/operations/KNOWN_ISSUES.md).

Install and run:

```powershell
npm install
npm run dev
```

Production build and local preview:

```powershell
npm run build
npm run preview
```

## Verification

Use the checks that match the change:

```powershell
npm audit
npm run build
npm run smoke
npm run test:gateway
npm run test:member
npm run test:member-db
npm run test:session-scope
npm run test:ledger-cleanup
npm run test:platform-db
npm run test:continuous-db
node --test scripts/private-entry-check.mjs
```

`test:member-db` loads the member migrations, four platform foundation migrations
and deployed session-scope correction in an in-memory PGlite database with pgcrypto
and a minimal Auth/catalog fixture. It never reads environment credentials or connects to Supabase.
Its 17 checks cover enrollment without wallet creation, zero-POINT launch without
automatic grants, shared and independent wallets, guest promotion preserving both
wallet scopes and actual reservations/ledger, inactive accounts, browser-role denial,
secret hashing/expiry, uniqueness, transaction rollback and disabled/missing policies.
It asserts that the obsolete round table, wallet mode and Demo-credit function are absent.
PGlite 0.5.8 uses PostgreSQL 18.3 and one connection; this is not validation of
hosted PostgreSQL 17 concurrency, Supabase Auth internals, or provider behavior.
The fixture is test-only, not a baseline migration or hosted deployment script.

`test:platform-db` uses the same deployed platform schema with its accounting fixtures.
Its 20 SQL cases cover both wallet models, zero credit, one-time provisioning,
server authority, renewal, reservation and available balance, exactly-once
settlement, draws, fees, frozen wallets, immutable accounting, adapter permissions,
and injected product failure with rollback of player/product/fee/commit records.
They also verify reset boundaries, removed legacy RPCs and missing-policy rejection. The simulated product adapter is test-only, not a Mahjong implementation.

The same command runs three cutover guard checks: non-test sessions, outstanding
reservations and external cascading foreign keys must abort the reset while
retaining the original data and schema (23 PGlite cases in total).

With `LOOTY_TEST_PG_BIN` set as below, `npm run test:platform-pg` runs those cases
plus eight actual competing-connection cases on native PostgreSQL 17.6 (28 cases).
They observe database lock waits for launch, occupancy, duplicate/changed
settlement, both freeze orderings, key revocation, and rollback/retry. These
checks do not constitute hosted integration, full Supabase bootstrap, load
testing, or backup restoration. Gateway mock tests cover the six server routes,
browser rejection, body bounds, safe error mapping and dependency health.

`test:ledger-cleanup` has seven isolated checks for metadata/open-match rejection,
migration ordering, data/balance/permission preservation, actual service-role settlement,
exact retries and immutable ledger protections. `test:ledger-cleanup-pg` runs the
same checks on PostgreSQL 17. The cleanup function differs from the deployed
settlement body only in its ledger column name; the test compares the definitions.

`test:continuous-db` explicitly loads the installed ledger cleanup and extension into the isolated
PGlite fixture. Its 18 cases cover per-hand posting, final release, rolling human
and AI reservations, replay/order rejection, zero-reserve occupancy, expired
sessions, backend rotation, cancellation, frozen wallets, permissions, rollback,
immutable records and the open-table application guard. With `LOOTY_TEST_PG_BIN`
set as below, `npm run test:continuous-pg` runs the same cases and seven observed
lock-contention cases on PostgreSQL 17.6 (25 cases total). These tests neither apply
hosted SQL nor implement Mahjong's durable adapter; the foundational single-posting
contract remains separately exercised by `test:platform-db`.

`test:member-pg` runs the same 17 checks plus 14 competing-connection checks
against a fresh native PostgreSQL 17 cluster. It has passed on PostgreSQL 17.6.
The race tests observe actual blocked database connections before releasing the
held transaction. They cover simultaneous enrollment, launch/promotion/freeze
orderings separately for both wallet scopes, mixed shared/independent game launches,
enrollment rollback and independent identities. These are deterministic fixture
cases, not a load test or proof of hosted Auth behavior. Historical migrations
remain necessary to construct the fixture and verify cutover; they are not the
schema used for current member acceptance. Nonzero policy grants exist only in
isolated preservation/accounting cases and do not authorize operational credit.

`test:session-scope` uses the deployed platform fixture, including
`supabase/migrations/20260917100000_active_session_scope.sql`, and reapplies that
correction to verify unchanged data and permissions.
Its 12 checks cover the corrected balance default, null/unsupported scopes,
token scope, invalid/expired credentials, revoked sessions, inactive players/wallets,
unchanged stored data and internal-helper permissions. It uses PGlite by default;
with `LOOTY_TEST_PG_BIN` configured, run `npm run test:session-scope-pg`
to run the same checks on native PostgreSQL 17.6. Both engines
pass. The same correction is loaded by member/platform acceptance tests.
The internal helper defaults to `balance`; explicit null or other scopes still
return no session. The existing balance caller and internal-only permissions are
unchanged. Hosted definition, grants and before/after record counts were verified
through `scripts/sql/session-scope-verification.sql`. This is not a hosted gameplay
test. Gateway publication was not required for the database-only correction.

Set `LOOTY_TEST_PG_BIN` to an absolute directory containing PostgreSQL 17's
`postgres`, `initdb`, and `pg_ctl` executables, then run the relevant `test:*-pg` command.
All PostgreSQL entry scripts use the same runner and set
`LOOTY_TEST_ENGINE=postgres17`; no separate member/platform engine setting is used.
The shared database factory accepts only `pglite` or `postgres17` and defaults to
PGlite. Historical cutover guard tests explicitly use PGlite.
The helper creates an isolated temporary cluster, binds only to `127.0.0.1` on
an available port, generates a temporary password, and stops/removes its cluster
after the tests. It takes no database URL and never reads `.env` credentials.
It does not install a Windows service or require Docker. On Windows, the tested
portable runtime can be prepared outside the repository with:

```powershell
$lootyPgTools = Join-Path $env:TEMP 'looty-pg17-tools'
npm install --prefix $lootyPgTools --ignore-scripts --no-audit --no-fund --save-exact '@embedded-postgres/windows-x64@17.6.0-beta.15'
$env:LOOTY_TEST_PG_BIN = Join-Path $lootyPgTools 'node_modules\@embedded-postgres\windows-x64\native\bin'
npm run test:member-pg
npm run test:session-scope-pg
npm run test:ledger-cleanup-pg
npm run test:platform-pg
npm run test:continuous-pg
```

Member unit checks use mocked Auth/Gateway services; browser smoke checks cover
the shared member dialog, cancellation/reselection, provider return destinations,
safe direct-link entry, recovery form states, simulated guest controls, and
320/390/1280 px layouts. They do not verify hosted OAuth, email delivery, actual
database concurrency, grants, wallet preservation, or end-to-end recovery.
Private-entry verification additionally covers explicit start, denied access,
retry and the shared Loader credential boundary. Its eleven isolated SQL tests
pass on PGlite and PostgreSQL 17; the latter verifies an actual restricted
password login. Hosted postflight confirms hidden Mahjong, enabled zero-credit policy, restricted
LOGIN and an exchange/renew-only expiring key. Test entry accepts active enrolled
guests and registered members without individual approval. The runtime
TLS/readiness check passed without creating sessions or funding. Credentials
expire on 2026-09-25 at 15:25 Asia/Taipei; renewal requires reviewed provisioning.
`supabase/config.toml` enables anonymous Auth, manual linking, confirmation and a
10-character minimum password for future local testing; it does not change the
hosted project. Production provider and abuse settings remain a release gate.

Hosted acceptance verifies dependency health, browser/server authorization
rejection, removed legacy routes and database grants. Identity/catalog snapshots
matched across cutover; postflight and reconciliation counts passed. Earlier
member acceptance verified real guest enrollment and repeated entry. After the
accounting reset, game play requires an activated product backend; no product
match has been accepted against hosted settlement yet. Google/email, promotion,
recovery and mobile continuity remain unverified.

`npm run smoke:gateway` tests the replacement health and rejection paths only. It creates no business data but changes runtime rate counters. Hosted execution requires `ALLOW_PRODUCTION_GATEWAY_SMOKE=1` and approval. The deployed Gateway health/rejection check passed.

For Markdown-only changes, validate document links, paths, language, and architecture claims; a production build is not required unless implementation files also changed.

## Supabase Operations

Looty uses a project-specific wrapper:

```powershell
.\scripts\supabase-looty.cmd projects list
```

The result must show:

```text
Looty / lsazydefvnuqglultqii / linked: true
```

Do not continue if the active CLI state points only to Aura or another project. Database changes require a small user-reviewed migration before application. See `AGENTS.md` for the complete safety rules.

### Hosted Auth Configuration

Verified in the Looty dashboard on 2026-09-17 using the user-authorized Chrome
session for `pixelgd.games@gmail.com`, organization Pixel GD, project
`lsazydefvnuqglultqii`:

- Google and Email providers, new-user signup and email confirmation are enabled.
- Anonymous sign-in and manual identity linking are enabled and saved.
- Site URL is `https://looty-git.pages.dev`.
- Member redirect allowlist entries are `https://looty-git.pages.dev/account/*`,
  `http://127.0.0.1:5173/account/*`, `http://localhost:5173/account/*`,
  `http://127.0.0.1:4173/account/*`, and `http://localhost:4173/account/*`.
  The suffix accommodates the encoded `next` and `flow` query parameters while
  keeping the host and member route fixed. The three existing admin callback
  entries remain unchanged, for eight entries total.
- Email delivery still uses Supabase's built-in testing service. Custom SMTP is
  not configured. CAPTCHA is off. Hosted password policy and real provider,
  linking, verification and recovery behavior remain to be validated.

The CLI wrapper still supports project/migration listing and database reads;
its combined `config diff` read was denied. The authorized dashboard inspection
resolved the member-settings visibility gap without replacing the local token.
It does not establish that the CLI now has configuration read/write access.

## Deployment

- Hosting: Cloudflare Pages.
- Production branch: `main`.
- Production hostname: `looty-git.pages.dev`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Required production variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

A push to `main` triggers production deployment. Do not push documentation or code changes unless the user explicitly requests it.

Looty remains on Cloudflare Pages. Mahjong H5 is planned for separate static
hosting on Cloudflare, but its upload is deferred until asset/readiness work is
complete. Godot remains local during development; GCP/VPS selection and payment
are deferred until external multiplayer testing requires an always-on server.
SMTP belongs to Looty/Supabase Auth and does not depend on that server host.

The Supabase Edge Function is deployed separately from Cloudflare Pages.

## Game and Asset Boundaries

- Looty owns the catalog, Loader, iframe shell, platform error states, and Lobby covers.
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
| `docs/product/PRODUCT_SCOPE.md` | Product boundaries, approved direction, and priorities |
| `docs/platform/GAME_PLATFORM_INTEGRATION.md` | Looty-to-game runtime contract |
| `docs/platform/MEMBER_AUTH_PLAN.md` | Platform-wide member, persistent guest, game-wallet relationship, and branded-entry plan |
| `docs/platform/CRAZYGAMES_INTEGRATION.md` | CrazyGames build and submission requirements |
| `docs/platform/FLASH.md` | Stable cross-module Flash context |
| `docs/operations/KNOWN_ISSUES.md` | Active limitations, risks, and launch blockers |
| `docs/operations/ANALYTICS_MONITORING.md` | Analytics, KPI, logging, dashboards, and alerts |

Do not copy whole sections between these documents. Link to the owning document when another subject needs context.
